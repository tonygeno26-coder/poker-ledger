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
  var role = q.role || h.role || '';
  var owner = q.owner || h.owner || '';
  var parts = [];
  if (access) parts.push('access_token=' + encodeURIComponent(access));
  if (token) {
    parts.push('token=' + encodeURIComponent(token));
    parts.push('token_hash=' + encodeURIComponent(token));
  }
  if (type) parts.push('type=' + encodeURIComponent(type));
  if (refresh) parts.push('refresh_token=' + encodeURIComponent(refresh));
  if (role) parts.push('role=' + encodeURIComponent(role));
  if (owner) parts.push('owner=' + encodeURIComponent(owner));
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
    if (q.role) parts.push('role=' + encodeURIComponent(String(q.role)));
    if (q.owner) parts.push('owner=' + encodeURIComponent(String(q.owner)));
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

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function bearerToken(req) {
  const header = String((req.headers && req.headers.authorization) || '');
  if (!header.toLowerCase().startsWith('bearer ')) return '';
  return header.slice(7).trim();
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

async function getUserById(id) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function resolveOwnerRef(ownerRef) {
  const ref = String(ownerRef || '').trim();
  if (!ref) return null;
  if (ref.includes('@')) return getUserByEmail(normalizeEmail(ref));
  return getUserById(ref);
}

/** Authenticate via Supabase access JWT (Authorization: Bearer …). */
async function requireAuthUser(req) {
  requireSupabase();
  const token = bearerToken(req);
  if (!token) throw httpError(401, 'Authorization Bearer token required');

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data || !data.user) {
    throw httpError(401, (error && error.message) || 'Invalid or expired token');
  }

  const email = normalizeEmail(data.user.email);
  if (!email) throw httpError(401, 'No email on auth user');

  const user = await ensureUser(email);
  return { authUser: data.user, user, accessToken: token };
}

async function activateHostViewer(viewerUser, ownerRef) {
  const owner = await resolveOwnerRef(ownerRef);
  if (!owner) throw httpError(400, 'Owner not found for host_viewer activation');
  if (owner.id === viewerUser.id) {
    throw httpError(400, 'Viewer cannot link to themselves as host_viewer');
  }

  const viewerEmail = normalizeEmail(viewerUser.email);
  const { data: invite, error: inviteErr } = await supabase
    .from('host_viewers')
    .select('*')
    .eq('owner_user_id', owner.id)
    .eq('viewer_email', viewerEmail)
    .in('status', ['pending', 'active'])
    .maybeSingle();
  if (inviteErr) throw inviteErr;
  if (!invite) {
    throw httpError(403, 'No pending host_viewer invite for this owner');
  }

  const now = new Date().toISOString();
  const { data: updatedUser, error: updErr } = await supabase
    .from('users')
    .update({
      role: 'host_viewer',
      linked_owner_id: owner.id
    })
    .eq('id', viewerUser.id)
    .select('*')
    .single();
  if (updErr) throw updErr;

  const { error: hvErr } = await supabase
    .from('host_viewers')
    .update({
      status: 'active',
      viewer_user_id: viewerUser.id,
      updated_at: now
    })
    .eq('id', invite.id);
  if (hvErr) throw hvErr;

  return updatedUser;
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
    const roleParam = String(body.role || (req.query && req.query.role) || '').trim();
    const ownerParam = String(body.owner || (req.query && req.query.owner) || '').trim();

    let authUser = null;
    let sessionAccessToken = accessToken || null;

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
      if (data.session && data.session.access_token) {
        sessionAccessToken = data.session.access_token;
      }
    } else {
      return res.status(400).json({ error: 'token or access_token required' });
    }

    const email = normalizeEmail(authUser && authUser.email);
    if (!email) return res.status(400).json({ error: 'No email on auth user' });

    let user = await ensureUser(email);

    // Host-viewer magic-link activation: role=host_viewer&owner=<email|userId>
    if (roleParam === 'host_viewer' && ownerParam) {
      user = await activateHostViewer(user, ownerParam);
    }

    res.json({
      user: {
        id: user.id,
        email: user.email
      },
      subscription_status: user.subscription_status,
      subscription_end: user.subscription_end,
      isActive: isSubscriptionActive(user),
      role: user.role || 'owner',
      linked_owner_id: user.linked_owner_id || null,
      // Client persists this for Bearer auth on invite/game routes
      access_token: sessionAccessToken || null
    });
  } catch (err) {
    console.error('[auth/verify]', err);
    const status = err.status || 401;
    res.status(status).json({ error: err.message || 'Verification failed' });
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

// ── Host viewer invites ───────────────────────────────────────────────────────
app.post('/invite/host-viewer', async function (req, res) {
  try {
    if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
    const { user: ownerUser } = await requireAuthUser(req);
    const body = req.body || {};
    const ownerEmail = normalizeEmail(body.ownerEmail);
    const viewerEmail = normalizeEmail(body.viewerEmail);

    if (!ownerEmail || !ownerEmail.includes('@')) {
      return res.status(400).json({ error: 'ownerEmail required' });
    }
    if (!viewerEmail || !viewerEmail.includes('@')) {
      return res.status(400).json({ error: 'viewerEmail required' });
    }
    if (ownerEmail !== normalizeEmail(ownerUser.email)) {
      return res.status(403).json({ error: 'JWT email must match ownerEmail' });
    }
    if (ownerUser.role === 'host_viewer') {
      return res.status(403).json({ error: 'Host viewers cannot invite other viewers' });
    }
    if (ownerEmail === viewerEmail) {
      return res.status(400).json({ error: 'Cannot invite yourself as host viewer' });
    }

    const owner = await ensureUser(ownerEmail);
    await ensureUser(viewerEmail);

    const now = new Date().toISOString();
    const { data: existing, error: existErr } = await supabase
      .from('host_viewers')
      .select('*')
      .eq('owner_user_id', owner.id)
      .eq('viewer_email', viewerEmail)
      .maybeSingle();
    if (existErr) throw existErr;

    if (existing) {
      const { error: updErr } = await supabase
        .from('host_viewers')
        .update({
          status: existing.status === 'active' ? 'active' : 'pending',
          updated_at: now
        })
        .eq('id', existing.id);
      if (updErr) throw updErr;
    } else {
      const { error: insErr } = await supabase.from('host_viewers').insert({
        owner_user_id: owner.id,
        viewer_email: viewerEmail,
        status: 'pending',
        created_at: now,
        updated_at: now
      });
      if (insErr) throw insErr;
    }

    const redirectTo =
      `${BASE_URL}/auth/callback` +
      `?role=host_viewer&owner=${encodeURIComponent(ownerEmail)}`;

    const { error: otpErr } = await supabase.auth.signInWithOtp({
      email: viewerEmail,
      options: {
        emailRedirectTo: redirectTo,
        shouldCreateUser: true,
        data: {
          role: 'host_viewer',
          owner: ownerEmail
        }
      }
    });
    if (otpErr) throw otpErr;

    res.json({ success: true });
  } catch (err) {
    console.error('[invite/host-viewer]', err);
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Failed to invite host viewer' });
  }
});

app.get('/invite/host-viewers/:ownerUserId', async function (req, res) {
  try {
    if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
    const { user } = await requireAuthUser(req);
    const ownerUserId = String(req.params.ownerUserId || '').trim();
    if (!ownerUserId) return res.status(400).json({ error: 'ownerUserId required' });
    if (user.id !== ownerUserId) {
      return res.status(403).json({ error: 'Only the owner can list their host viewers' });
    }

    const { data, error } = await supabase
      .from('host_viewers')
      .select('id, owner_user_id, viewer_email, viewer_user_id, status, created_at, updated_at')
      .eq('owner_user_id', ownerUserId)
      .order('created_at', { ascending: false });
    if (error) throw error;

    res.json({ viewers: data || [] });
  } catch (err) {
    console.error('[invite/host-viewers]', err);
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Failed to list host viewers' });
  }
});

app.delete('/invite/host-viewer/:id', async function (req, res) {
  try {
    if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
    const { user } = await requireAuthUser(req);
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'id required' });

    const { data: row, error: fetchErr } = await supabase
      .from('host_viewers')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!row) return res.status(404).json({ error: 'Invite not found' });
    if (row.owner_user_id !== user.id) {
      return res.status(403).json({ error: 'Only the owner can revoke this invite' });
    }

    const now = new Date().toISOString();
    const { error: updErr } = await supabase
      .from('host_viewers')
      .update({ status: 'revoked', updated_at: now })
      .eq('id', id);
    if (updErr) throw updErr;

    // Clear viewer role linkage if this was their active owner link
    if (row.viewer_user_id) {
      await supabase
        .from('users')
        .update({ role: 'owner', linked_owner_id: null })
        .eq('id', row.viewer_user_id)
        .eq('linked_owner_id', row.owner_user_id)
        .eq('role', 'host_viewer');
    }

    res.json({ success: true, status: 'revoked' });
  } catch (err) {
    console.error('[invite/host-viewer DELETE]', err);
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Failed to revoke host viewer' });
  }
});

app.get('/game/current/:ownerUserId', async function (req, res) {
  try {
    if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
    const { user } = await requireAuthUser(req);
    const ownerUserId = String(req.params.ownerUserId || '').trim();
    if (!ownerUserId) return res.status(400).json({ error: 'ownerUserId required' });

    const viewerEmail = normalizeEmail(user.email);
    let hv = null;
    const { data: byUserId, error: byUserErr } = await supabase
      .from('host_viewers')
      .select('id, status, viewer_email, viewer_user_id')
      .eq('owner_user_id', ownerUserId)
      .eq('status', 'active')
      .eq('viewer_user_id', user.id)
      .maybeSingle();
    if (byUserErr) throw byUserErr;
    hv = byUserId;
    if (!hv) {
      const { data: byEmail, error: byEmailErr } = await supabase
        .from('host_viewers')
        .select('id, status, viewer_email, viewer_user_id')
        .eq('owner_user_id', ownerUserId)
        .eq('status', 'active')
        .eq('viewer_email', viewerEmail)
        .maybeSingle();
      if (byEmailErr) throw byEmailErr;
      hv = byEmail;
    }

    const linkedOk =
      user.role === 'host_viewer' && String(user.linked_owner_id || '') === ownerUserId;
    if (!hv && !linkedOk) {
      return res.status(403).json({
        error: 'Active host_viewer access required for this owner'
      });
    }

    const { data: game, error: gameErr } = await supabase
      .from('games')
      .select('id, owner_user_id, state, updated_at')
      .eq('owner_user_id', ownerUserId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (gameErr) throw gameErr;

    if (!game) {
      return res.status(404).json({
        error:
          'No game synced for this owner yet. Owner app must POST/upsert into games before viewers can load current G.'
      });
    }

    // Return latest G JSON only
    res.json(game.state);
  } catch (err) {
    console.error('[game/current]', err);
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Failed to load current game' });
  }
});

/** Owner sync: upsert latest game state for host viewers to poll. */
app.post('/game/save', async function (req, res) {
  try {
    if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
    const { user } = await requireAuthUser(req);
    const body = req.body || {};
    const ownerUserId = String(body.ownerUserId || '').trim();
    if (!ownerUserId) return res.status(400).json({ error: 'ownerUserId required' });
    if (String(user.id) !== ownerUserId) {
      return res.status(403).json({ error: 'Only the owner can save their game' });
    }
    if (user.role === 'host_viewer') {
      return res.status(403).json({ error: 'Host viewers cannot save games' });
    }

    let state = body.gameState;
    if (typeof state === 'string') {
      try {
        state = JSON.parse(state);
      } catch (e) {
        return res.status(400).json({ error: 'gameState must be valid JSON' });
      }
    }
    if (!state || typeof state !== 'object') {
      return res.status(400).json({ error: 'gameState required' });
    }

    const now = new Date().toISOString();
    const { data: existing, error: findErr } = await supabase
      .from('games')
      .select('id')
      .eq('owner_user_id', ownerUserId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (findErr) throw findErr;

    if (existing && existing.id) {
      const { error: updErr } = await supabase
        .from('games')
        .update({ state: state, updated_at: now })
        .eq('id', existing.id);
      if (updErr) throw updErr;
    } else {
      const { error: insErr } = await supabase.from('games').insert({
        owner_user_id: ownerUserId,
        state: state,
        updated_at: now
      });
      if (insErr) throw insErr;
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[game/save]', err);
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Failed to save game' });
  }
});

// ── Persistent player book (people) ───────────────────────────────────────────
function normalizePersonName(v) {
  return String(v || '').trim().toUpperCase();
}
function normalizePersonTag(v) {
  const t = String(v == null ? '' : v).trim();
  return t ? t.toUpperCase() : null;
}
function personDisplayLabel(row) {
  const name = normalizePersonName(row && row.name);
  const tag = row && row.tag ? String(row.tag).trim() : '';
  return tag ? name + ' · ' + tag.toUpperCase() : name;
}
async function canAccessOwnerBook(user, ownerUserId) {
  if (String(user.id) === String(ownerUserId)) return { ok: true, readOnly: user.role === 'host_viewer' };
  const linkedOk =
    user.role === 'host_viewer' && String(user.linked_owner_id || '') === String(ownerUserId);
  if (linkedOk) return { ok: true, readOnly: true };

  const viewerEmail = normalizeEmail(user.email);
  const { data: byUserId, error: byUserErr } = await supabase
    .from('host_viewers')
    .select('id')
    .eq('owner_user_id', ownerUserId)
    .eq('status', 'active')
    .eq('viewer_user_id', user.id)
    .maybeSingle();
  if (byUserErr) throw byUserErr;
  if (byUserId) return { ok: true, readOnly: true };

  const { data: byEmail, error: byEmailErr } = await supabase
    .from('host_viewers')
    .select('id')
    .eq('owner_user_id', ownerUserId)
    .eq('status', 'active')
    .eq('viewer_email', viewerEmail)
    .maybeSingle();
  if (byEmailErr) throw byEmailErr;
  if (byEmail) return { ok: true, readOnly: true };

  return { ok: false, readOnly: true };
}

app.get('/people/:ownerUserId', async function (req, res) {
  try {
    if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
    const { user } = await requireAuthUser(req);
    const ownerUserId = String(req.params.ownerUserId || '').trim();
    if (!ownerUserId) return res.status(400).json({ error: 'ownerUserId required' });

    const access = await canAccessOwnerBook(user, ownerUserId);
    if (!access.ok) {
      return res.status(403).json({ error: 'Not authorized to read this player book' });
    }

    const includeArchived = String(req.query.includeArchived || '') === '1';
    let q = supabase
      .from('people')
      .select(
        'id, owner_user_id, name, tag, notes, last_role, last_played_at, archived, created_at, updated_at, standing_balance, balance_updated_at'
      )
      .eq('owner_user_id', ownerUserId)
      .order('name', { ascending: true })
      .order('tag', { ascending: true, nullsFirst: true });
    if (!includeArchived) q = q.eq('archived', false);

    const { data, error } = await q;
    if (error) throw error;

    res.json({ people: data || [], readOnly: !!access.readOnly });
  } catch (err) {
    console.error('[people GET]', err);
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Failed to list people' });
  }
});

app.get('/people/:id/balance-history', async function (req, res) {
  try {
    if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
    const { user } = await requireAuthUser(req);
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'id required' });

    const { data: person, error: personErr } = await supabase
      .from('people')
      .select('id, owner_user_id, name, tag, standing_balance, balance_updated_at')
      .eq('id', id)
      .maybeSingle();
    if (personErr) throw personErr;
    if (!person) return res.status(404).json({ error: 'Person not found' });

    const access = await canAccessOwnerBook(user, person.owner_user_id);
    if (!access.ok) {
      return res.status(403).json({ error: 'Not authorized to read this player book' });
    }

    const { data: entries, error: entErr } = await supabase
      .from('person_balance_entries')
      .select(
        'id, person_id, owner_user_id, game_id, opening_balance, closing_balance, delta, posted_at, created_at, game_date, location'
      )
      .eq('person_id', id)
      .order('posted_at', { ascending: false })
      .order('created_at', { ascending: false });
    if (entErr) throw entErr;

    res.json({
      person,
      entries: entries || [],
      readOnly: !!access.readOnly
    });
  } catch (err) {
    console.error('[people balance-history GET]', err);
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Failed to load balance history' });
  }
});

function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function recomputeStandingBalance(personId) {
  const { data: rows, error } = await supabase
    .from('person_balance_entries')
    .select('delta')
    .eq('person_id', personId);
  if (error) throw error;
  const standing = roundMoney(
    (rows || []).reduce(function (s, r) {
      return s + (Number(r.delta) || 0);
    }, 0)
  );
  const now = new Date().toISOString();
  const { data: updated, error: updErr } = await supabase
    .from('people')
    .update({ standing_balance: standing, balance_updated_at: now, updated_at: now })
    .eq('id', personId)
    .select(
      'id, owner_user_id, name, tag, notes, last_role, last_played_at, archived, created_at, updated_at, standing_balance, balance_updated_at'
    )
    .single();
  if (updErr) throw updErr;
  return updated;
}

app.post('/games/:gameId/post-balances', async function (req, res) {
  try {
    if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
    const { user } = await requireAuthUser(req);
    if (user.role === 'host_viewer') {
      return res.status(403).json({ error: 'Host viewers have read-only access to the player book' });
    }

    const gameId = String(req.params.gameId || '').trim();
    if (!gameId) return res.status(400).json({ error: 'gameId required' });

    const body = req.body || {};
    const ownerUserId = String(body.ownerUserId || user.id || '').trim();
    if (!ownerUserId) return res.status(400).json({ error: 'ownerUserId required' });
    if (String(user.id) !== ownerUserId) {
      return res.status(403).json({ error: 'Only the owner can post balances' });
    }

    const rawEntries = Array.isArray(body.entries) ? body.entries : [];
    const byPerson = {};
    for (let i = 0; i < rawEntries.length; i++) {
      const e = rawEntries[i] || {};
      const personId = String(e.personId || e.person_id || '').trim();
      if (!personId) continue;
      byPerson[personId] = {
        personId,
        opening: roundMoney(e.opening != null ? e.opening : e.opening_balance),
        closing: roundMoney(e.closing != null ? e.closing : e.closing_balance)
      };
    }
    const personIds = Object.keys(byPerson);
    const now = new Date().toISOString();
    const gameDate =
      body.gameDate != null
        ? String(body.gameDate || '').trim()
        : body.game_date != null
          ? String(body.game_date || '').trim()
          : '';
    const location =
      body.location != null ? String(body.location || '').trim() : '';

    // Split into owned (post) vs unknown (skip) — never reject the whole request
    const skipped = [];
    let validPersonIds = [];
    if (personIds.length) {
      const { data: owned, error: ownedErr } = await supabase
        .from('people')
        .select('id')
        .eq('owner_user_id', ownerUserId)
        .in('id', personIds);
      if (ownedErr) throw ownedErr;
      const ownedSet = {};
      (owned || []).forEach(function (r) {
        ownedSet[String(r.id)] = true;
      });
      for (let j = 0; j < personIds.length; j++) {
        if (ownedSet[personIds[j]]) validPersonIds.push(personIds[j]);
        else skipped.push(personIds[j]);
      }
    }

    // Upsert rows for valid people only
    for (let k = 0; k < validPersonIds.length; k++) {
      const ent = byPerson[validPersonIds[k]];
      const delta = roundMoney(ent.closing - ent.opening);
      const { data: existing, error: findErr } = await supabase
        .from('person_balance_entries')
        .select('id')
        .eq('person_id', ent.personId)
        .eq('game_id', gameId)
        .maybeSingle();
      if (findErr) throw findErr;

      const rowFields = {
        opening_balance: ent.opening,
        closing_balance: ent.closing,
        delta,
        posted_at: now,
        game_date: gameDate || null,
        location: location || null
      };

      if (existing) {
        const { error: updErr } = await supabase
          .from('person_balance_entries')
          .update(rowFields)
          .eq('id', existing.id);
        if (updErr) throw updErr;
      } else {
        const { error: insErr } = await supabase.from('person_balance_entries').insert({
          person_id: ent.personId,
          owner_user_id: ownerUserId,
          game_id: gameId,
          opening_balance: ent.opening,
          closing_balance: ent.closing,
          delta,
          posted_at: now,
          created_at: now,
          game_date: gameDate || null,
          location: location || null
        });
        if (insErr) throw insErr;
      }
    }

    // Delete entries for people removed from this game's post set.
    // Keep skipped (unknown) person rows — never delete this game's rows for skipped persons.
    const { data: gameRows, error: gameErr } = await supabase
      .from('person_balance_entries')
      .select('id, person_id')
      .eq('game_id', gameId)
      .eq('owner_user_id', ownerUserId);
    if (gameErr) throw gameErr;

    const keep = {};
    validPersonIds.forEach(function (id) {
      keep[id] = true;
    });
    skipped.forEach(function (id) {
      keep[id] = true;
    });
    const removedPersonIds = {};
    const deleteIds = [];
    (gameRows || []).forEach(function (r) {
      if (!keep[String(r.person_id)]) {
        deleteIds.push(r.id);
        removedPersonIds[String(r.person_id)] = true;
      }
    });
    if (deleteIds.length) {
      const { error: delErr } = await supabase
        .from('person_balance_entries')
        .delete()
        .in('id', deleteIds);
      if (delErr) throw delErr;
    }

    // Recompute standing_balance = sum(deltas) for affected people
    const recomputeIds = {};
    validPersonIds.forEach(function (id) {
      recomputeIds[id] = true;
    });
    Object.keys(removedPersonIds).forEach(function (id) {
      recomputeIds[id] = true;
    });
    const updatedPeople = [];
    const ids = Object.keys(recomputeIds);
    for (let m = 0; m < ids.length; m++) {
      updatedPeople.push(await recomputeStandingBalance(ids[m]));
    }

    res.json({
      gameId,
      posted: validPersonIds.length,
      skipped: skipped,
      removed: deleteIds.length,
      people: updatedPeople
    });
  } catch (err) {
    console.error('[post-balances]', err);
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Failed to post balances' });
  }
});

app.post('/people', async function (req, res) {
  try {
    if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
    const { user } = await requireAuthUser(req);
    if (user.role === 'host_viewer') {
      return res.status(403).json({ error: 'Host viewers have read-only access to the player book' });
    }

    const body = req.body || {};
    const ownerUserId = String(body.ownerUserId || user.id || '').trim();
    if (!ownerUserId) return res.status(400).json({ error: 'ownerUserId required' });
    if (String(user.id) !== ownerUserId) {
      return res.status(403).json({ error: 'Only the owner can write their player book' });
    }

    const name = normalizePersonName(body.name);
    if (!name) return res.status(400).json({ error: 'name required' });
    const tag = normalizePersonTag(body.tag);
    const notes = body.notes == null ? null : String(body.notes);
    const lastRole = body.last_role == null && body.lastRole == null
      ? null
      : String(body.last_role || body.lastRole || '').trim() || null;
    const lastPlayedAt = body.last_played_at || body.lastPlayedAt || null;
    const archived = body.archived === true;
    const now = new Date().toISOString();
    const id = String(body.id || '').trim() || undefined;

    // Upsert by id when provided; otherwise insert (unique index guards name+tag)
    if (id) {
      const { data: existing, error: findErr } = await supabase
        .from('people')
        .select('*')
        .eq('id', id)
        .eq('owner_user_id', ownerUserId)
        .maybeSingle();
      if (findErr) throw findErr;
      if (existing) {
        const patch = {
          name,
          tag,
          notes: notes == null ? existing.notes : notes,
          last_role: lastRole == null ? existing.last_role : lastRole,
          last_played_at: lastPlayedAt == null ? existing.last_played_at : lastPlayedAt,
          archived: body.archived == null ? existing.archived : archived,
          updated_at: now
        };
        const { data: updated, error: updErr } = await supabase
          .from('people')
          .update(patch)
          .eq('id', id)
          .eq('owner_user_id', ownerUserId)
          .select('*')
          .single();
        if (updErr) {
          if (updErr.code === '23505') {
            return res.status(409).json({
              error:
                'A person named "' +
                personDisplayLabel({ name, tag }) +
                '" already exists in your book. Use a different tag to tell them apart.'
            });
          }
          throw updErr;
        }
        return res.json({ person: updated, upserted: true });
      }
    }

    const insertRow = {
      owner_user_id: ownerUserId,
      name,
      tag,
      notes,
      last_role: lastRole,
      last_played_at: lastPlayedAt,
      archived,
      created_at: now,
      updated_at: now
    };
    if (id) insertRow.id = id;

    const { data: inserted, error: insErr } = await supabase
      .from('people')
      .insert(insertRow)
      .select('*')
      .single();
    if (insErr) {
      if (insErr.code === '23505') {
        // Idempotent upsert on unique (owner, name, tag)
        let q = supabase
          .from('people')
          .select('*')
          .eq('owner_user_id', ownerUserId)
          .eq('name', name);
        if (tag) q = q.eq('tag', tag);
        else q = q.is('tag', null);
        const { data: dup, error: dupErr } = await q.maybeSingle();
        if (dupErr) throw dupErr;
        if (dup) {
          const patch = {
            notes: notes == null ? dup.notes : notes,
            last_role: lastRole == null ? dup.last_role : lastRole,
            last_played_at: lastPlayedAt == null ? dup.last_played_at : lastPlayedAt,
            archived: body.archived == null ? dup.archived : archived,
            updated_at: now
          };
          const { data: updated, error: updErr } = await supabase
            .from('people')
            .update(patch)
            .eq('id', dup.id)
            .select('*')
            .single();
          if (updErr) throw updErr;
          return res.json({ person: updated, upserted: true });
        }
        return res.status(409).json({
          error:
            'A person named "' +
            personDisplayLabel({ name, tag }) +
            '" already exists in your book. Use a different tag to tell them apart.'
        });
      }
      throw insErr;
    }

    res.json({ person: inserted, upserted: false });
  } catch (err) {
    console.error('[people POST]', err);
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Failed to save person' });
  }
});

app.patch('/people/:id', async function (req, res) {
  try {
    if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
    const { user } = await requireAuthUser(req);
    if (user.role === 'host_viewer') {
      return res.status(403).json({ error: 'Host viewers have read-only access to the player book' });
    }

    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'id required' });

    const { data: row, error: fetchErr } = await supabase
      .from('people')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!row) return res.status(404).json({ error: 'Person not found' });
    if (String(row.owner_user_id) !== String(user.id)) {
      return res.status(403).json({ error: 'Only the owner can edit their player book' });
    }

    const body = req.body || {};
    const patch = { updated_at: new Date().toISOString() };
    if (body.name != null) {
      const name = normalizePersonName(body.name);
      if (!name) return res.status(400).json({ error: 'name required' });
      patch.name = name;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'tag')) {
      patch.tag = normalizePersonTag(body.tag);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'notes')) {
      patch.notes = body.notes == null ? null : String(body.notes);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'archived')) {
      patch.archived = !!body.archived;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'last_role') || Object.prototype.hasOwnProperty.call(body, 'lastRole')) {
      patch.last_role = String(body.last_role || body.lastRole || '').trim() || null;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'last_played_at') || Object.prototype.hasOwnProperty.call(body, 'lastPlayedAt')) {
      patch.last_played_at = body.last_played_at || body.lastPlayedAt || null;
    }

    const { data: updated, error: updErr } = await supabase
      .from('people')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();
    if (updErr) {
      if (updErr.code === '23505') {
        return res.status(409).json({
          error:
            'A person with that name and tag already exists in your book. Choose a different tag.'
        });
      }
      throw updErr;
    }

    res.json({ person: updated });
  } catch (err) {
    console.error('[people PATCH]', err);
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Failed to update person' });
  }
});

app.listen(PORT, function () {
  console.log(`[pocketbooks] subscription server listening on :${PORT}`);
  console.log(`[pocketbooks] BASE_URL=${BASE_URL}`);
  console.log(
    `[pocketbooks] STRIPE_MODE=${STRIPE_MODE} key=${stripeKey ? 'set' : 'missing'} price=${stripePriceId ? 'set' : 'missing'} webhook=${stripeWebhookSecret ? 'set' : 'missing'}`
  );
});
