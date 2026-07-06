'use strict';

const express = require('express');
const { verifySignature } = require('./src/meta');
const { handleWebhookEvent } = require('./src/webhook');

const app = express();
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// Capture the raw request body so we can verify X-Hub-Signature-256.
// express.json() otherwise discards the raw bytes the HMAC is computed over.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// Health check (useful for Railway and uptime monitors).
app.get('/', (_req, res) => {
  res.status(200).send('Runova Instagram webhook server is running.');
});

// --- Meta webhook verification (GET) ---
// Meta calls this once during setup with hub.mode / hub.verify_token / hub.challenge.
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[webhook] verification succeeded');
    return res.status(200).send(challenge);
  }

  console.warn('[webhook] verification failed (bad mode or token)');
  return res.sendStatus(403);
});

// --- Meta webhook events (POST) ---
app.post('/webhook', (req, res) => {
  // Verify the signature BEFORE acknowledging. Reject spoofed requests.
  if (!verifySignature(req)) {
    console.warn('[webhook] invalid X-Hub-Signature-256 — rejecting');
    return res.sendStatus(403);
  }

  // Acknowledge immediately so Meta does not retry, then process async.
  res.sendStatus(200);

  // Fire-and-forget. Never let a processing error crash the server.
  setImmediate(() => {
    handleWebhookEvent(req.body).catch((err) => {
      console.error('[webhook] unhandled processing error:', err);
    });
  });
});

// Last-resort guards so a stray throw never takes the process down.
process.on('unhandledRejection', (err) => {
  console.error('[process] unhandledRejection:', err);
});
process.on('uncaughtException', (err) => {
  console.error('[process] uncaughtException:', err);
});

app.listen(PORT, () => {
  console.log(`Runova Instagram webhook server listening on port ${PORT}`);
});
