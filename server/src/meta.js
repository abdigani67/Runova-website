'use strict';

const crypto = require('crypto');

const GRAPH_API_VERSION = 'v21.0';
const APP_SECRET = process.env.META_APP_SECRET;

/**
 * Verify the X-Hub-Signature-256 header against the raw request body using the
 * app secret. Uses a timing-safe comparison. Returns true only if valid.
 */
function verifySignature(req) {
  const signature = req.get('x-hub-signature-256');
  if (!signature || !req.rawBody) {
    return false;
  }
  if (!APP_SECRET) {
    console.error('[meta] META_APP_SECRET is not set — cannot verify signatures');
    return false;
  }

  const expected =
    'sha256=' +
    crypto.createHmac('sha256', APP_SECRET).update(req.rawBody).digest('hex');

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

/**
 * Send a reply to the customer via the Meta Graph API.
 * Returns the response message_id, or null if the send failed.
 * Per spec: do NOT retry Meta sends (avoids duplicate messages).
 */
async function sendReply({ pageAccessToken, recipientId, text, context }) {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/me/messages?access_token=${encodeURIComponent(
    pageAccessToken
  )}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text },
        messaging_type: 'RESPONSE',
      }),
    });

    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.error(
        `[meta] send failed (${res.status}) for ${context || recipientId}:`,
        JSON.stringify(body)
      );
      return null;
    }

    return body.message_id || null;
  } catch (err) {
    console.error(`[meta] send threw for ${context || recipientId}:`, err.message);
    return null;
  }
}

module.exports = { verifySignature, sendReply };
