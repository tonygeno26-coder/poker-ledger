require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');

const PORT = Number(process.env.PORT) || 3000;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const TRIAL_DAYS = 7;

// Stripe mode: "live" uses STRIPE_LIVE_* vars when set; otherwise falls back to test vars.
const STRIPE_MODE = String(process.env.STRIPE_MODE || 'test').toLowerCase() === 'live' ? 'live' : 'test';
const stripeKey =
  STRIPE_MODE === 'live'
    ? process.env.STRIPE_LIVE_SECRET_KEY || process.env.STRIPE_SECRET_KEY
    : process.env.STRIPE_SECRET_KEY;
const stripePriceId =
  STRIPE_MODE === 'live'
    ? process.env.STRIPE_LIVE_PRICE_ID || process.env.STRIPE_PRICE_ID
    : process.env.STRIPE_PRICE_ID;
const stripeWebhookSecret =
  STRIPE_MODE === 'live'
    ? process.env.STRIPE_LIVE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET
    : process.env.STRIPE_WEBHOOK_SECRET;

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.warn('[warn] SUPABASE_URL / SUPABASE_SERVICE_KEY not set — auth routes will fail until configured');
}
if (!stripeKey) {
  console.warn(
    `[warn] Stripe secret not set for mode=${STRIPE_MODE} — checkout/webhook will fail until configured`
  );
}

const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null;

const stripe = stripeKey ? new Stripe(stripeKey) : null;

const app = express();
app.use(cors());

// Stripe webhook MUST receive the raw body for signature verification
app.post(
  '/webhook/stripe',
  express.raw({ type: 'application/json' }),
  async function (req, res) {
    if (!stripe) return res.status(503).send('Stripe not configured');
    const sig = req.headers['stripe-signature'];
    const secret = stripeWebhookSecret;
    if (!secret) {
      return res
        .status(503)
        .send(
          STRIPE_MODE === 'live'
            ? 'STRIPE_LIVE_WEBHOOK_SECRET (or STRIPE_WEBHOOK_SECRET) not set'
            : 'STRIPE_WEBHOOK_SECRET not set'
        );
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, secret);
    } catch (err) {
      console.error('[stripe webhook] signature error:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      await handleStripeEvent(event);
      res.json({ received: true });
    } catch (err) {
      console.error('[stripe webhook] handler error:', err);
      res.status(500).json({ error: 'Webhook handler failed' });
    }
  }
);

app.use(express.json());

// Universal Links — AASA must be served before static with application/json
app.get('/.well-known/apple-app-site-association', function (_req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.sendFile(
    path.join(__dirname, 'public', '.well-known', 'apple-app-site-association')
  );
});

// Magic-link bridge: HTTPS callback → custom scheme (query server-side; hash via HTML)
const AUTH_CALLBACK_BRIDGE_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Signing in…</title></head>
<body>
<p>Opening Pocketbooks Poker…</p>
<script>
(function () {
  function paramsFrom(str) {
    var out = {};
    String(str || '').replace(/^[#?]/, '').split('&').forEach(function (pair) {
      if (!pair) return;
      var i = pair.indexOf('=');
      var k = decodeURIComponent((i >= 0 ? pair.slice(0, i) : pair).replace(/\\+/g, ' '));
      var v = decodeURIComponent((i >= 0 ? pair.slice(i + 1) : '').replace(/\\+/g, ' '));
      if (k) out[k] = v;
    });
    return out;
  }
  var q = paramsFrom(location.search);
  var h = paramsFrom(location.hash);
  var token = q.token_hash || q.token || h.token_hash || h.token || '';
  var access = q.access_token || h.access_token || '';
  var type = q.type || h.type || 'email';
  var refresh = q.refresh_token || h.refresh_token || '';
  var parts = [];
  if (access) parts.push('access_token=' + encodeURIComponent(access));
  if (token) {
    parts.push('token=' + encodeURIComponent(token));
    parts.push('token_hash=' + encodeURIComponent(token));
  }
  if (type) parts.push('type=' + encodeURIComponent(type));
  if (refresh) parts.push('refresh_token=' + encodeURIComponent(refresh));
  var dest = 'pocketbookspoker://auth/callback' + (parts.length ? ('?' + parts.join('&')) : '');
  location.replace(dest);
})();
</script>
</body></html>`;

app.get('/auth/callback', function (req, res) {
  var q = req.query || {};
  var token = q.token_hash || q.token || '';
  var access = q.access_token || '';
  if (token || access) {
    var parts = [];
    if (access) parts.push('access_token=' + encodeURIComponent(String(access)));
    if (token) {
      parts.push('token=' + encodeURIComponent(String(token)));
      parts.push('token_hash=' + encodeURIComponent(String(token)));
    }
    if (q.type) parts.push('type=' + encodeURIComponent(String(q.type)));
    if (q.refresh_token) {
      parts.push('refresh_token=' + encodeURIComponent(String(q.refresh_token)));
    }
    return res.redirect(302, 'pocketbookspoker://auth/callback?' + parts.join('&'));
  }
  // Hash fragments never reach the server — HTML extracts them client-side
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(AUTH_CALLBACK_BRIDGE_HTML);
});

app.use(express.static(path.join(__dirname, 'public')));

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function isSubscriptionActive(user) {
  if (!user) return false;
  const status = user.subscription_status;
  const end = user.subscription_end ? new Date(user.subscription_end) : null;
  const notExpired = !end || end.getTime() > Date.now();
  if (status === 'active' || status === 'promo') return notExpired;
  if (status === 'trial') return notExpired;
  return false;
}

function requireSupabase() {
  if (!supabase) {
    const err = new Error('Supabase not configured');
    err.status = 503;
    throw err;
  }
  return supabase;
}

async function getUserByEmail(email) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', email)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function ensureUser(email) {
  let user = await getUserByEmail(email);
  if (user) return user;

  const trialEnd = addDays(new Date(), TRIAL_DAYS).toISOString();
  const { data, error } = await supabase
    .from('users')
    .insert({
      email,
      subscription_status: 'trial',
      subscription_end: trialEnd
    })
    .select('*')
    .single();

  if (error) {
    // Race: another request created the row
    if (error.code === '23505') {
      return getUserByEmail(email);
    }
    throw error;
  }
  return data;
}

async function ensureStripeCustomer(user) {
  if (!stripe) throw new Error('Stripe not configured');
  if (user.stripe_customer_id) {
    return user.stripe_customer_id;
  }
  const customer = await stripe.customers.create({
    email: user.email,
    metadata: { pocketbooks_user_id: user.id }
  });
  const { error } = await supabase
    .from('users')
    .update({ stripe_customer_id: customer.id })
    .eq('id', user.id);
  if (error) throw error;
  return customer.id;
}

async function setUserSubscription(emailOrCustomerId, fields, byCustomer) {
  let query = supabase.from('users').update(fields);
  if (byCustomer) {
    query = query.eq('stripe_customer_id', emailOrCustomerId);
  } else {
    query = query.eq('email', emailOrCustomerId);
  }
  const { error } = await query;
  if (error) throw error;
}

async function handleStripeEvent(event) {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const customerId = session.customer;
      const email = normalizeEmail(session.customer_details?.email || session.customer_email);
      let subscriptionEnd = null;
      if (session.subscription && stripe) {
        const sub = await stripe.subscriptions.retrieve(session.subscription);
        if (sub.current_period_end) {
          subscriptionEnd = new Date(sub.current_period_end * 1000).toISOString();
        }
      }
      if (!subscriptionEnd) {
        subscriptionEnd = addDays(new Date(), 31).toISOString();
      }
      const payload = {
        subscription_status: 'active',
        subscription_end: subscriptionEnd
      };
      if (customerId) payload.stripe_customer_id = customerId;

      if (customerId) {
        await setUserSubscription(customerId, payload, true);
      }
      if (email) {
        await ensureUser(email);
        await setUserSubscription(email, payload, false);
      }
      console.log('[stripe] checkout.session.completed → active', email || customerId);
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const customerId = sub.customer;
      await setUserSubscription(
        customerId,
        { subscription_status: 'expired' },
        true
      );
      console.log('[stripe] subscription.deleted → expired', customerId);
      break;
    }
    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const customerId = invoice.customer;
      await setUserSubscription(
        customerId,
        { subscription_status: 'expired' },
        true
      );
      console.log('[stripe] invoice.payment_failed → expired', customerId);
      break;
    }
    default:
      break;
  }
}

app.get('/health', function (_req, res) {
  res.json({ ok: true, service: 'pocketbooks-poker-subscription' });
});

app.get('/subscribe', function (_req, res) {
  res.sendFile(path.join(__dirname, 'public', 'subscribe.html'));
});

// ── Auth ──────────────────────────────────────────────────────────────────────
app.post('/auth/magic-link', async function (req, res) {
  try {
    if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
    const email = normalizeEmail(req.body && req.body.email);
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email required' });
    }

    await ensureUser(email);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo:
          'https://pocketbooks-poker-api-production.up.railway.app/auth/callback',
        shouldCreateUser: true
      }
    });
    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    console.error('[auth/magic-link]', err);
    res.status(500).json({ error: err.message || 'Failed to send magic link' });
  }
});

app.post('/auth/verify', async function (req, res) {
  try {
    if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
    const body = req.body || {};
    const tokenHash = body.token_hash || body.token;
    const type = body.type || 'email';
    const accessToken = body.access_token;

    let authUser = null;

    if (accessToken) {
      const { data, error } = await supabase.auth.getUser(accessToken);
      if (error) throw error;
      authUser = data.user;
    } else if (tokenHash) {
      const { data, error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type
      });
      if (error) throw error;
      authUser = data.user;
    } else {
      return res.status(400).json({ error: 'token or access_token required' });
    }

    const email = normalizeEmail(authUser && authUser.email);
    if (!email) return res.status(400).json({ error: 'No email on auth user' });

    const user = await ensureUser(email);
    res.json({
      user: {
        id: user.id,
        email: user.email
      },
      subscription_status: user.subscription_status,
      subscription_end: user.subscription_end,
      isActive: isSubscriptionActive(user)
    });
  } catch (err) {
    console.error('[auth/verify]', err);
    res.status(401).json({ error: err.message || 'Verification failed' });
  }
});

// ── Subscription ──────────────────────────────────────────────────────────────
app.get('/subscription/check', async function (req, res) {
  try {
    if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
    const email = normalizeEmail(req.query.email);
    if (!email) return res.status(400).json({ error: 'email query required' });

    const user = await getUserByEmail(email);
    if (!user) {
      return res.json({
        status: 'none',
        subscription_end: null,
        isActive: false
      });
    }
    res.json({
      status: user.subscription_status,
      subscription_end: user.subscription_end,
      isActive: isSubscriptionActive(user)
    });
  } catch (err) {
    console.error('[subscription/check]', err);
    res.status(500).json({ error: err.message || 'Check failed' });
  }
});

app.post('/subscription/create-checkout', async function (req, res) {
  try {
    if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
    if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });
    const priceId = stripePriceId;
    if (!priceId) {
      return res.status(503).json({
        error:
          STRIPE_MODE === 'live'
            ? 'STRIPE_LIVE_PRICE_ID (or STRIPE_PRICE_ID) not set'
            : 'STRIPE_PRICE_ID not set'
      });
    }

    const email = normalizeEmail(req.body && req.body.email);
    if (!email) return res.status(400).json({ error: 'email required' });

    const user = await ensureUser(email);
    const customerId = await ensureStripeCustomer(user);

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${BASE_URL}/subscribe?checkout=success`,
      cancel_url: `${BASE_URL}/subscribe?checkout=cancel`,
      metadata: {
        pocketbooks_user_id: user.id,
        email
      }
    });

    res.json({ checkoutUrl: session.url });
  } catch (err) {
    console.error('[subscription/create-checkout]', err);
    res.status(500).json({ error: err.message || 'Checkout failed' });
  }
});

// ── Promo ─────────────────────────────────────────────────────────────────────
app.post('/promo/redeem', async function (req, res) {
  try {
    if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
    const email = normalizeEmail(req.body && req.body.email);
    const code = String((req.body && req.body.code) || '').trim().toUpperCase();
    if (!email) return res.status(400).json({ error: 'email required' });
    if (!code) return res.status(400).json({ error: 'code required' });

    const { data: promo, error: promoErr } = await supabase
      .from('promo_codes')
      .select('*')
      .ilike('code', code)
      .maybeSingle();
    if (promoErr) throw promoErr;
    if (!promo) {
      return res.status(404).json({ success: false, message: 'Invalid promo code' });
    }

    const grantsUntil = new Date(promo.grants_access_until);
    if (grantsUntil.getTime() <= Date.now()) {
      return res.status(400).json({ success: false, message: 'Promo code has expired' });
    }
    if ((promo.use_count || 0) >= (promo.max_uses || 0)) {
      return res.status(400).json({ success: false, message: 'Promo code has no remaining uses' });
    }

    const user = await ensureUser(email);

    const { error: updErr } = await supabase
      .from('users')
      .update({
        subscription_status: 'promo',
        subscription_end: promo.grants_access_until
      })
      .eq('id', user.id);
    if (updErr) throw updErr;

    const { error: countErr } = await supabase
      .from('promo_codes')
      .update({ use_count: (promo.use_count || 0) + 1 })
      .eq('id', promo.id);
    if (countErr) throw countErr;

    const { error: redErr } = await supabase.from('promo_redemptions').insert({
      user_id: user.id,
      code: promo.code
    });
    if (redErr) throw redErr;

    res.json({
      success: true,
      message: 'Promo applied — access granted',
      subscription_end: promo.grants_access_until
    });
  } catch (err) {
    console.error('[promo/redeem]', err);
    res.status(500).json({ success: false, message: err.message || 'Redeem failed' });
  }
});

app.listen(PORT, function () {
  console.log(`[pocketbooks] subscription server listening on :${PORT}`);
  console.log(`[pocketbooks] BASE_URL=${BASE_URL}`);
  console.log(
    `[pocketbooks] STRIPE_MODE=${STRIPE_MODE} key=${stripeKey ? 'set' : 'missing'} price=${stripePriceId ? 'set' : 'missing'} webhook=${stripeWebhookSecret ? 'set' : 'missing'}`
  );
});
