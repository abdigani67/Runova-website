# Runova DM Receptionist — Setup & Test Runbook

This is the step-by-step guide for getting the Instagram DM webhook server running,
testing it with a real Instagram account, and deploying it. If you're an AI assistant
helping the owner set this up on their laptop: **follow this document top to bottom**,
ask the owner for any value you don't have, and never print secrets back or commit them.

See `README.md` for the deeper reference on how the server works; this file is the
task-oriented checklist.

---

## 0. Context (what's already handled by the owner)

- The **Facebook Page** side is done: the Instagram test account (**"Nova Aesthetics"**)
  is a Business account connected to a Facebook Page, and the Meta app has the Instagram
  messaging product added in **Development mode**, with the owner's account as a tester/role.
- The owner can retrieve the **Page access token** themselves from the Meta developer
  dashboard — just ask for it when needed (step 5), don't walk them through generating it.
- The Supabase schema already exists and **must not be modified** — the server only reads
  and writes existing tables (`clinics`, `leads`, `conversations`, `treatments`).

---

## 1. The three Meta values (don't mix them up)

These are three *different* things from the Meta dashboard, and confusing them is the
#1 cause of setup failure:

| Value | What it is | Where to get it | Where it goes |
|---|---|---|---|
| **App Secret** | Your Meta *app's* password. The server uses it to verify each webhook really came from Meta. | developers.facebook.com → your app → **App Settings → Basic** → **App Secret** (click "Show", enter your FB password) | `META_APP_SECRET` in `.env` |
| **Page access token** | Permission to send messages **as** the Nova Aesthetics page. | Meta developer dashboard (owner has this) | `page_access_token` column on the clinic's row in Supabase |
| **Verify token** | A random string **you invent**. Used once, so Meta and the server can confirm each other during webhook setup. | You make it up (any random string) | `VERIFY_TOKEN` in `.env`, and typed into Meta's webhook form (step 7) |

Treat the App Secret and Page token like passwords: `.env` only (it's gitignored), never
commit them, never paste them anywhere public.

---

## 2. Prerequisites

Check and install as needed:

- **Node.js 18+** — `node -v`
- **git** — `git --version`
- **ngrok** — only needed to test with real Instagram from your laptop (`ngrok --version`).
  Install from ngrok.com and run `ngrok config add-authtoken <token>` once.

---

## 3. Get the code

```bash
# clone if you don't have it, then:
git fetch origin
git checkout claude/instagram-dm-webhook-server-hvv1zq
cd server
npm install
```

Work only on that branch. Do **not** push to `main`.

---

## 4. Environment variables

Create `server/.env` from the template and fill it in:

```bash
cp .env.example .env
```

| Variable | Value |
|---|---|
| `SUPABASE_URL` | Supabase project URL, e.g. `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase **service role** key (Project Settings → API). Server-side only. |
| `ANTHROPIC_API_KEY` | Anthropic API key (`sk-ant-...`). |
| `META_APP_SECRET` | App Secret — see §1 (Settings → Basic). |
| `VERIFY_TOKEN` | Any random string you invent. |
| `DASHBOARD_TOKEN` | Any random string — gates the `/dashboard` page. |
| `PORT` | Optional. Defaults to `3000`. |

Generate the two random strings with:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

Confirm `.env` is gitignored (`git check-ignore server/.env` should print the path).

---

## 5. Run locally and smoke-test (no Instagram needed)

Start it:

```bash
npm run dev
```

Then, in another terminal, verify each behavior:

```bash
# Health check → "Runova Instagram webhook server is running."
curl -s http://localhost:3000/

# Webhook verification challenge (use YOUR VERIFY_TOKEN) → echoes "CHALLENGE123"
curl -s "http://localhost:3000/webhook?hub.mode=subscribe&hub.verify_token=YOUR_VERIFY_TOKEN&hub.challenge=CHALLENGE123"

# Bad signature → 403
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" -H "x-hub-signature-256: sha256=bad" -d '{"entry":[]}'

# Valid signature → 200 (compute the HMAC with YOUR META_APP_SECRET)
BODY='{"object":"instagram","entry":[{"id":"PAGE1","messaging":[{"sender":{"id":"USER123"},"recipient":{"id":"PAGE1"},"message":{"mid":"m_test1","text":"how much is botox?"}}]}]}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "YOUR_META_APP_SECRET" | awk '{print $2}')"
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" -H "x-hub-signature-256: $SIG" -d "$BODY"
```

Watch the server terminal: the valid POST will try to look up a clinic for page `PAGE1`
and log `no clinic for page PAGE1 — ignoring` (expected — that's a fake page id).

## 6. Open the dashboard

Open in a browser (use your `DASHBOARD_TOKEN`):

```
http://localhost:3000/dashboard?token=YOUR_DASHBOARD_TOKEN
```

It shows recent leads (hot/warm/cold) and a live message feed from your Supabase, and
auto-refreshes every 20s. Empty states are normal until real messages arrive.

---

## 7. Wire up "Nova Aesthetics" for a real DM test

### 7a. Start a tunnel so Meta can reach your laptop

```bash
ngrok http 3000
```

Copy the `https://....ngrok-free.app` URL. Your webhook URL is that + `/webhook`.
(Keep the server AND ngrok running throughout the test.)

### 7b. Find the Instagram page id the webhook will use

The clinic row must match the `recipient.id` Meta sends. The most reliable way to find
that exact value:

1. Configure the webhook (7c) and send one test DM to Nova Aesthetics.
2. Watch the server logs for `no clinic for page <NUMBER> — ignoring`.
3. That `<NUMBER>` is the `instagram_page_id` — use it in 7d.

(Alternative: `GET https://graph.facebook.com/v21.0/me?access_token=PAGE_TOKEN` returns
the id, but the log method above is foolproof because it's literally what the server sees.)

### 7c. Point the Meta webhook at ngrok

In the Meta app dashboard → **Instagram** (or Messenger) → **Webhooks / Configuration**:

- **Callback URL:** `https://<your-ngrok>.ngrok-free.app/webhook`
- **Verify token:** your `VERIFY_TOKEN`
- Click **Verify and Save** — the server answers Meta's GET challenge automatically.
- **Subscribe** to the `messages` field for the Instagram account.

### 7d. Add the Nova Aesthetics clinic row in Supabase

The AI can't reply without a clinic row. In Supabase (SQL editor or table editor), ensure
a `clinics` row exists with — at minimum:

```sql
insert into clinics (clinic_name, instagram_page_id, page_access_token, ai_instructions, booking_link)
values (
  'Nova Aesthetics',
  '<INSTAGRAM_PAGE_ID from 7b>',
  '<PAGE_ACCESS_TOKEN from the Meta dashboard>',
  'Warm, professional, on-brand for a modern aesthetics clinic. Keep it friendly and concise.',
  'https://<your-booking-link>'
);
```

And add a couple of active treatments so replies quote real prices:

```sql
insert into treatments (clinic_id, treatment_name, price_from, price_to, duration_mins, description, active)
values
  ('<clinic_id>', 'Lip Filler', 180, 300, 30, 'Dermal filler to add volume and definition to the lips', true),
  ('<clinic_id>', 'Anti-wrinkle (Botox)', 150, 250, 20, 'Relaxes muscles to smooth fine lines', true);
```

(Replace `<clinic_id>` with the id returned by the clinic insert.)

### 7e. Test it

1. From a **different** Instagram account, DM **Nova Aesthetics** something like
   "hey how much is lip filler and do you have slots this week?"
2. Within a second or two the AI receptionist should reply in-thread.
3. Confirm the reply, then check `/dashboard` — a new lead with a temperature score and
   the message feed should appear.

### 7f. If nothing happens — debug in this order

1. **ngrok request log** (http://127.0.0.1:4040) — did Meta POST to `/webhook` at all?
   - No request → webhook subscription/verify token/callback URL is wrong (7c).
2. **Server logs** — what did it print for the request?
   - `invalid X-Hub-Signature-256` → `META_APP_SECRET` is wrong.
   - `no clinic for page X` → the `instagram_page_id` in the row doesn't match `X` (fix 7d).
   - `AI paused ... manual_override/ai_active` → that lead has a human-handling flag set.
   - `no AI reply ... skipping` → Anthropic call failed (check `ANTHROPIC_API_KEY`).
   - `send failed (...)` → the `page_access_token` is wrong/expired, or missing messaging
     permission on the page.
3. **24-hour window:** Instagram only allows replies within 24h of the user's last message.
   For a reply-to-DM test you're always inside it, so this shouldn't bite — but if you're
   trying to send unprompted, it will.

---

## 8. Go live (optional, later)

Deploy `server/` to Railway:

1. Railway → New Project → Deploy from GitHub repo → this repo.
2. Settings → **Root Directory = `server`**.
3. Add all the `.env` variables as Railway variables (Railway injects `PORT`).
4. It builds with Nixpacks and runs `npm start` (see `railway.json` / `Procfile`).
5. Copy the Railway URL, then repoint the Meta webhook callback to
   `https://<your-app>.up.railway.app/webhook` (no more ngrok).
6. Dashboard is then at `https://<your-app>.up.railway.app/dashboard?token=...`.

---

## Guardrails

- Only work on branch `claude/instagram-dm-webhook-server-hvv1zq`. Never push to `main`.
- Never commit `.env` or any secret; never print secrets back after they're set.
- Never modify the Supabase schema — only insert/read rows.
- If a step fails, show the actual error output and diagnose it — don't guess.
