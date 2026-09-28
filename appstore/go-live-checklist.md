# Stripe Go-Live Checklist — Pocketbooks Poker

**Do not flip live until every box is checked.** Code already supports `STRIPE_MODE=live`; this checklist is ops only. Overnight batch did **not** deploy Railway.

---

## 0. Preconditions

- [ ] Stripe account is **Pocketbooks Poker** (`acct_1UJvAjE79xRtHsbr`) — not CollabHub or any other account
- [ ] Test mode checkout works end-to-end with `STRIPE_MODE=test` (magic link → subscribe → Checkout → webhook → `subscription_status` active/trialing)
- [ ] Promo `DEALER2026` still redeems in test
- [ ] Privacy + marketing URLs resolve:
  - https://pocketbooks-poker-api-production.up.railway.app/privacy
  - https://pocketbookspoker.com

---

## 1. Stripe Dashboard (Live mode)

- [ ] Toggle Stripe Dashboard to **Live**
- [ ] Create (or confirm) Product: **Pocketbooks Poker Pro** (or current display name)
- [ ] Create recurring Price (USD / month) — copy Live `price_…`
- [ ] Copy Live Secret Key `sk_live_…` (Developers → API keys)
- [ ] Developers → Webhooks → Add endpoint:
  - URL: `https://pocketbooks-poker-api-production.up.railway.app/webhook/stripe`
  - Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted` (match what `handleStripeEvent` handles)
  - Copy Live signing secret `whsec_…`

---

## 2. Railway variables (set, do not deploy until ready)

On **pocketbooks-poker-api** production:

- [ ] `STRIPE_LIVE_SECRET_KEY` = Live `sk_live_…`
- [ ] `STRIPE_LIVE_PRICE_ID` = Live `price_…`
- [ ] `STRIPE_LIVE_WEBHOOK_SECRET` = Live `whsec_…`
- [ ] Keep existing test vars (`STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`) so you can roll back by setting `STRIPE_MODE=test`
- [ ] Confirm `BASE_URL` is the production HTTPS origin

---

## 3. Flip the switch

- [ ] Set `STRIPE_MODE=live`
- [ ] Redeploy / let Railway pick up vars
- [ ] Boot log should show `STRIPE_MODE=live key=set price=set webhook=set`

---

## 4. Smoke test (real card or Stripe test in live? — use a real $0.50+ path carefully)

- [ ] Create checkout for a **new** email (not a leftover test customer ID if keys changed accounts)
- [ ] Complete Checkout with a real card (or Stripe’s live-mode validation flow)
- [ ] Confirm webhook `200` in Stripe Dashboard → Webhooks → deliveries
- [ ] Confirm `/subscription/check` returns active/trialing for that email
- [ ] Confirm app gate unlocks (banner / account button)

---

## 5. Rollback

- [ ] If anything fails: set `STRIPE_MODE=test`, redeploy, leave Live vars in place for a later retry
- [ ] Do **not** delete Live products; just leave mode on test

---

## 6. App Store / review notes

- [ ] App Review notes already mention promo `DEALER2026` (see `appstore/metadata.md`)
- [ ] Confirm promo still works against production after live flip (promo is Supabase, not Stripe)
- [ ] Do not put Live secret keys in git, App Store notes, or screenshots

---

## Owner action (Anthony)

1. Create Live product + price + webhook in Pocketbooks Poker Stripe.
2. Paste Live vars into Railway.
3. Flip `STRIPE_MODE=live` when ready.
4. Smoke-test one real checkout + webhook.
5. Keep test vars for instant rollback.
