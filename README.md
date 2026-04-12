# 🃏 Pocketbooks — Poker Ledger

A full-stack poker accounting app with Telegram notifications.

## Structure

```
poker-ledger/
├── server/          ← Node.js API + Telegram bot (deploy this to Railway)
├── client/          ← React frontend (deploy this to Railway or Vercel)
└── index.html       ← Standalone offline version (no server needed)
```

## Deploy to Railway

### Step 1 — Create Railway account
Sign up at https://railway.app (GitHub login works)

### Step 2 — Deploy the server

1. Go to https://railway.app/new
2. Click **Deploy from GitHub repo**
3. Connect your GitHub and push this repo
4. Set the **root directory** to `server`
5. Add these environment variables:
   - `TELEGRAM_BOT_TOKEN` = your bot token (from BotFather)
   - `NODE_ENV` = production

### Step 3 — Add PostgreSQL

1. In your Railway project, click **New** → **Database** → **PostgreSQL**
2. Railway auto-sets `DATABASE_URL` — no action needed

### Step 4 — Deploy the frontend

Option A — Deploy client to Railway too:
1. Add another service, set root to `client`
2. Set env var: `REACT_APP_API_URL` = your server's Railway URL + `/api`

Option B — Deploy to Vercel (easier for frontend):
1. `cd client && npx vercel`
2. Set env var `REACT_APP_API_URL` in Vercel dashboard

### Step 5 — Set up Telegram bot
1. Go to BotFather → `/setdomain` → set your Railway frontend URL
2. Players message your bot and type their name to register
3. Their Telegram gets linked to their player profile

## How it works

- **Add players** → link to their Telegram via the bot
- **Run a game** → enter buy-ins, add-ons, cash-outs
- **Click "Settle & Notify"** → calculates who owes who + sends Telegram messages to all players
- **Mark payments paid** → both players get notified
- **Leaderboard** → tracks all-time stats across every session
