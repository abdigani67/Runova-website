'use strict';

const { supabase } = require('./supabase');

/**
 * Returns true if a message with this Meta message_id has already been stored.
 * Used to make webhook processing idempotent — Meta occasionally redelivers the
 * same event, and without this check we would send a duplicate AI reply.
 */
async function messageAlreadyProcessed(messageId) {
  if (!messageId) return false;
  const { data, error } = await supabase
    .from('conversations')
    .select('id')
    .eq('message_id', messageId)
    .maybeSingle();

  if (error) {
    // On error, fall through (return false) rather than blocking a real reply.
    console.error(`[conversations] dedup check failed for ${messageId}:`, error.message);
    return false;
  }
  return !!data;
}

/**
 * Fetch the last 15 messages for this handle+clinic, oldest-first, formatted as
 * a readable history string:  "Customer: hi | AI: hello | Customer: price?"
 */
async function getHistoryString(instagramHandle, clinicId) {
  const { data, error } = await supabase
    .from('conversations')
    .select('sender_type, message_text, timestamp')
    .eq('instagram_handle', instagramHandle)
    .eq('clinic_id', clinicId)
    .order('timestamp', { ascending: false })
    .limit(15);

  if (error) {
    console.error(`[conversations] history lookup failed for ${instagramHandle}:`, error.message);
    return 'No prior conversation history.';
  }
  if (!data || data.length === 0) {
    return 'No prior conversation history — this is the first message.';
  }

  const chronological = data.reverse();
  const labelFor = (senderType) => {
    if (senderType === 'ai') return 'AI';
    if (senderType === 'staff') return 'Staff';
    return 'Customer';
  };

  return chronological
    .map((row) => `${labelFor(row.sender_type)}: ${row.message_text}`)
    .join(' | ');
}

/**
 * Upsert a conversation row keyed on message_id (unique) to avoid duplicates.
 * Failure is logged but never blocks the reply from being sent.
 */
async function saveMessage({ clinicId, instagramHandle, messageId, senderType, messageText }) {
  const row = {
    clinic_id: clinicId,
    instagram_handle: instagramHandle,
    message_id: messageId,
    sender_type: senderType,
    message_text: messageText,
    timestamp: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('conversations')
    .upsert(row, { onConflict: 'message_id' });

  if (error) {
    console.error(
      `[conversations] failed to save ${senderType} message for ${instagramHandle}:`,
      error.message
    );
  }
}

module.exports = { messageAlreadyProcessed, getHistoryString, saveMessage };
