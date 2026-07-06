'use strict';

const { getClinicByPageId, getTreatmentsString } = require('./clinic');
const { getLead, upsertLead, maybeUpdateLeadScore } = require('./leads');
const {
  messageAlreadyProcessed,
  getHistoryString,
  saveMessage,
} = require('./conversations');
const { buildSystemPrompt, callClaude, parseClaudeResponse } = require('./claude');
const { sendReply } = require('./meta');

/**
 * Entry point for a full webhook payload. Iterates every messaging event and
 * processes each independently so one failure never affects the others.
 */
async function handleWebhookEvent(payload) {
  if (!payload || !Array.isArray(payload.entry)) {
    return;
  }

  for (const entry of payload.entry) {
    const messagingEvents = entry.messaging || entry.standby || [];
    for (const event of messagingEvents) {
      try {
        await processMessagingEvent(event);
      } catch (err) {
        console.error('[webhook] error processing messaging event:', err);
      }
    }
  }
}

async function processMessagingEvent(event) {
  const message = event.message;

  // Skip anything that isn't an inbound text DM.
  if (!message) return; // reads, reactions, postbacks, etc.
  if (message.is_echo) return; // the page's own outgoing message
  const incomingText = message.text;
  if (!incomingText || incomingText.trim() === '') return; // attachment-only / non-text — skip silently

  const senderId = event.sender && event.sender.id;
  const pageId = event.recipient && event.recipient.id;
  const messageId = message.mid;

  if (!senderId || !pageId) return;

  // Ignore messages the page sends to itself.
  if (senderId === pageId) return;

  // Idempotency: Meta can redeliver the same event. Skip if already stored.
  if (await messageAlreadyProcessed(messageId)) {
    console.log(`[webhook] skipping already-processed message ${messageId}`);
    return;
  }

  // Look up the clinic by page id. If unknown, exit silently.
  const clinic = await getClinicByPageId(pageId);
  if (!clinic) {
    console.log(`[webhook] no clinic for page ${pageId} — ignoring`);
    return;
  }

  const logCtx = `${clinic.clinic_name} / ${senderId}`;

  // Load the existing lead (may be null on first contact).
  const existingLead = await getLead(clinic.id, senderId);

  // If a human is handling this conversation, do not send an AI reply.
  if (existingLead && (existingLead.manual_override || existingLead.ai_active === false)) {
    console.log(`[webhook] AI paused for ${logCtx} (manual_override/ai_active) — skipping`);
    return;
  }

  // Build context for the model (history is fetched BEFORE saving the incoming
  // message, so the current DM isn't duplicated — it's passed as the user turn).
  const historyString = await getHistoryString(senderId, clinic.id);
  const treatmentsString = await getTreatmentsString(clinic.id, clinic.clinic_name);
  const systemPrompt = buildSystemPrompt({ clinic, treatmentsString, historyString });

  // Call Anthropic (with one retry inside). On total failure, exit silently.
  const rawText = await callClaude({ systemPrompt, userMessage: incomingText });
  if (!rawText) {
    console.error(`[webhook] no AI reply for ${logCtx} — skipping (nothing sent)`);
    return;
  }

  const { replyText, temperature, reason } = parseClaudeResponse(rawText);
  if (!replyText) {
    console.error(`[webhook] parsed empty reply for ${logCtx} — skipping`);
    return;
  }

  // Save the customer's incoming message (upsert on message_id).
  await saveMessage({
    clinicId: clinic.id,
    instagramHandle: senderId,
    messageId,
    senderType: 'user',
    messageText: incomingText,
  });

  // Send the reply to the customer. No retry (avoids duplicate messages).
  const responseMessageId = await sendReply({
    pageAccessToken: clinic.page_access_token,
    recipientId: senderId,
    text: replyText,
    context: logCtx,
  });

  // Only save the AI reply if the send actually succeeded (we need Meta's id).
  if (responseMessageId) {
    await saveMessage({
      clinicId: clinic.id,
      instagramHandle: senderId,
      messageId: responseMessageId,
      senderType: 'ai',
      messageText: replyText,
    });
  } else {
    console.error(`[webhook] reply not delivered for ${logCtx} — AI reply not saved`);
  }

  // Upsert the lead (message_count / last_message / last_contact, or insert).
  const lead = await upsertLead({
    existingLead,
    clinicId: clinic.id,
    instagramHandle: senderId,
    incomingText,
  });

  // Update scoring, respecting the "don't cool a hot lead" rule.
  if (lead) {
    await maybeUpdateLeadScore({
      leadId: lead.id,
      previousTemperature: existingLead ? existingLead.lead_temperature : null,
      temperature,
      reason,
    });
  }

  console.log(`[webhook] replied to ${logCtx} (temp=${temperature || 'unchanged'})`);
}

module.exports = { handleWebhookEvent };
