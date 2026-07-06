# Runova — Instagram DM Webhook Server

A Node.js + Express webhook server that receives Instagram DMs from Meta and replies
with an AI-generated message (Anthropic `claude-sonnet-4-6`), per clinic. Replaces the
Make.com automation.

## What it does (per incoming DM)

1. Receives `POST /webhook` from Meta and **verifies** `X-Hub-Signature-256` against the
   raw body using `META_APP_SECRET`. Invalid signatures are rejected with `403`.
2. Returns `200` immediately, then processes asynchronously (so Meta doesn't retry).
3. Skips echoes, read receipts, reactions, and non-text (attachment-only) messages.
4. Skips duplicate deliveries (idempotent on Meta's `message_id`).
5. Looks up the clinic by `instagram_page_id`. Unknown page → exit silently.
6. Skips if the lead has `manual_override = true` or `ai_active = false` (a human is handling it).
7. Builds context from the last 15 messages + active treatments, calls Anthropic
   (one retry after 2s on failure), parses the reply and `###TEMP|REASON` scoring.
8. Saves the incoming message, sends the reply via the Meta Graph API, saves the AI reply,
   upserts the lead, and updates temperature scoring (without cooling an already-hot lead).

The Supabase schema is **not** modified by this server — it only reads and writes existing tables.

## Live activity dashboard

A lightweight, self-refreshing dashboard replaces the visibility you had in Make's
run history. It shows recent leads (with hot / warm / cold scoring) and a live
message feed, read straight from Supabase.

- **URL:** `GET /dashboard?token=<DASHBOARD_TOKEN>`
- Set `DASHBOARD_TOKEN` to a secret string to enable it. Leave it unset to disable
  the route entirely (returns `503`). A wrong or missing token returns `401`.
- It exposes customer conversation data, so treat the token like a password and
  only share the URL with staff. (For production, consider putting it behind proper
  auth or an allowlist — the token is basic protection, not full access control.)
- The page auto-refreshes every 20 seconds. It's read-only.

## File structure

```
server/
├── index.js                 Express server, routes, raw-body capture
├── src/
│   ├── webhook.js           Main DM handler — orchestrates the flow
│   ├── clinic.js            Supabase clinic + treatment fetches
│   ├── claude.js            Anthropic call, prompt builder, response parser
│   ├── meta.js              Signature verification + send reply (Graph API)
│   ├── leads.js             Lead upsert + scoring
│   ├── conversations.js     History fetch, message save, dedup
│   ├── dashboard.js         Token-gated live activity dashboard
│   └── supabase.js          Shared Supabase service-role client
├── .env.example
├── railway.json
├── Procfile
└── package.json
```

## Run locally

```bash
cd server
npm install
cp .env.example .env      # then fill in the values (see below)
npm run dev               # or: npm start
```

The server listens on `PORT` (default `3000`). Health check: `GET /`.

To test the webhook end-to-end locally, expose it with a tunnel (e.g. `ngrok http 3000`)
and point the Meta webhook at the tunnel URL.

## Environment variables

Put these in `.env` locally, and set them as Railway variables in production:

| Variable                    | What to put in it |
|-----------------------------|-------------------|
| `SUPABASE_URL`              | Your Supabase project URL, e.g. `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase **service role** key (Project Settings → API). Server-side only — never expose it. |
| `ANTHROPIC_API_KEY`         | Your Anthropic API key (`sk-ant-...`). |
| `META_APP_SECRET`           | App Secret from the Meta app dashboard (App Settings → Basic). Used to verify webhook signatures. |
| `VERIFY_TOKEN`              | Any string **you choose** (e.g. a random 32-char value). You'll enter the same value in Meta's webhook setup. |
| `DASHBOARD_TOKEN`           | Optional. A secret that gates the `/dashboard` activity page. Unset = dashboard disabled. |
| `PORT`                      | Optional. Railway sets this automatically; defaults to `3000`. |

## Deploy to Railway

1. Push this repo to GitHub (already done if you're reading this in the repo).
2. In Railway: **New Project → Deploy from GitHub repo**, select this repo.
3. Set the **root directory** to `server` (Settings → Root Directory), since the server
   lives in a subfolder alongside the marketing site.
4. Add the environment variables from the table above (Variables tab).
5. Railway builds with Nixpacks and runs `npm start` (see `railway.json` / `Procfile`).
   It injects `PORT` automatically.
6. Once deployed, copy the public URL, e.g. `https://your-app.up.railway.app`.

## Point your Meta webhook at it

1. In the Meta app dashboard → **Instagram** (or Messenger) → **Webhooks / Configure**.
2. **Callback URL:** `https://your-app.up.railway.app/webhook`
3. **Verify token:** the exact same string you set as `VERIFY_TOKEN`.
4. Click **Verify and Save** — Meta sends a `GET /webhook` challenge; the server echoes
   `hub.challenge` back when the token matches.
5. **Subscribe** to the `messages` field for your Instagram account.
6. Ensure your Instagram Business account is connected to the app and that each clinic's
   `page_access_token` (stored in the `clinics` table) has messaging permissions.

## Notes / known limitations

- **Model:** `claude-sonnet-4-6`, `max_tokens: 400`. Change in `src/claude.js` if needed.
- **Graph API version:** `v21.0` (in `src/meta.js`).
- **Concurrency:** two DMs arriving within a second or two can interleave and produce two
  replies / a race on `message_count`. Acceptable for launch; a per-conversation lock or
  queue would be the proper fix if it becomes an issue.
- **Non-text DMs** (images, stickers, voice notes) are skipped silently.
- All errors are caught and logged with context (clinic name, handle, step). A processing
  error never crashes the server and never blocks other messages.
