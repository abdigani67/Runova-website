'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 400;

/**
 * Build the exact system prompt the receptionist runs with.
 */
function buildSystemPrompt({ clinic, treatmentsString, historyString }) {
  return `You are a warm, professional AI receptionist for ${clinic.clinic_name}. Your job is to respond to Instagram DMs from potential clients. Always be helpful, concise (under 3 sentences unless the question requires more), and guide the conversation toward booking.

Follow these clinic-specific style and tone instructions exactly, they define how this clinic wants you to sound: ${clinic.ai_instructions || ''}

TREATMENTS AND PRICING:
${treatmentsString}

BOOKING LINK: ${clinic.booking_link || 'N/A'}

WHAT THIS CUSTOMER HAS SAID SO FAR:
${historyString}

At the END of your reply, on the same line, append ###[TEMP]|[REASON] where TEMP is hot/warm/cold based on buying intent, and REASON is a short explanation. Hot = asking about price or booking. Warm = interested but not ready. Cold = just browsing or no clear intent. If a lead was previously hot but is now postponing, prepend !cooled to REASON. Never cool a hot lead just because they asked a question — only cool if they explicitly say they are not ready or postponing.`;
}

/**
 * Sleep helper.
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Call Anthropic. Retries once after 2s on error/timeout.
 * Returns the raw response text, or null if both attempts fail.
 */
async function callClaude({ systemPrompt, userMessage }) {
  const attempt = async () => {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    return textBlock ? textBlock.text : '';
  };

  try {
    return await attempt();
  } catch (firstErr) {
    console.warn('[claude] first attempt failed, retrying in 2s:', firstErr.message);
    await delay(2000);
    try {
      return await attempt();
    } catch (secondErr) {
      console.error('[claude] second attempt failed, giving up:', secondErr.message);
      return null;
    }
  }
}

/**
 * Parse the model output into { replyText, temperature, reason }.
 *
 * Defensive: splits on the FIRST "###" only (reply text could contain "###"),
 * and if the marker is missing entirely, sends the whole message as the reply
 * and leaves scoring undefined so the lead's temperature is left unchanged.
 */
function parseClaudeResponse(rawText) {
  if (!rawText) {
    return { replyText: '', temperature: null, reason: null };
  }

  const markerIndex = rawText.indexOf('###');
  if (markerIndex === -1) {
    return { replyText: rawText.trim(), temperature: null, reason: null };
  }

  const replyText = rawText.slice(0, markerIndex).trim();
  const scoring = rawText.slice(markerIndex + 3).trim();

  // scoring looks like "hot|asking about price". Split on the first "|" only.
  const pipeIndex = scoring.indexOf('|');
  let temperature = null;
  let reason = null;

  if (pipeIndex === -1) {
    temperature = scoring.toLowerCase().trim() || null;
  } else {
    temperature = scoring.slice(0, pipeIndex).toLowerCase().trim() || null;
    reason = scoring.slice(pipeIndex + 1).trim() || null;
  }

  // Only accept known temperature values; otherwise treat as unscored.
  if (!['hot', 'warm', 'cold'].includes(temperature)) {
    temperature = null;
  }

  return { replyText: replyText || rawText.trim(), temperature, reason };
}

module.exports = { buildSystemPrompt, callClaude, parseClaudeResponse };
