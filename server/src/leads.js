'use strict';

const { supabase } = require('./supabase');

/**
 * Fetch the lead for this handle+clinic, or null if they don't exist yet.
 */
async function getLead(clinicId, instagramHandle) {
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .eq('clinic_id', clinicId)
    .eq('instagram_handle', instagramHandle)
    .maybeSingle();

  if (error) {
    console.error(`[leads] lookup failed for ${instagramHandle}:`, error.message);
    return null;
  }
  return data || null;
}

/**
 * Insert a new lead, or bump message_count / last_message / last_contact on an
 * existing one. Returns the resulting lead row (or the existing snapshot on
 * failure so scoring logic can still run). Failure is logged, never thrown.
 */
async function upsertLead({ existingLead, clinicId, instagramHandle, incomingText }) {
  const now = new Date().toISOString();

  if (!existingLead) {
    const { data, error } = await supabase
      .from('leads')
      .insert({
        clinic_id: clinicId,
        instagram_handle: instagramHandle,
        status: 'new',
        lead_stage: 'awareness',
        ai_active: true,
        manual_override: false,
        message_count: 1,
        last_message: incomingText,
        last_contact: now,
      })
      .select()
      .maybeSingle();

    if (error) {
      console.error(`[leads] insert failed for ${instagramHandle}:`, error.message);
      return null;
    }
    return data;
  }

  const { data, error } = await supabase
    .from('leads')
    .update({
      message_count: (existingLead.message_count || 0) + 1,
      last_message: incomingText,
      last_contact: now,
    })
    .eq('id', existingLead.id)
    .select()
    .maybeSingle();

  if (error) {
    console.error(`[leads] update failed for ${instagramHandle}:`, error.message);
    return existingLead;
  }
  return data;
}

/**
 * Update lead temperature scoring.
 *
 * Rule: only rescore if the lead was NOT already "hot", OR the AI reply/reason
 * contains the "!cooled" marker (which explicitly signals a hot lead is cooling).
 * This prevents a hot lead from being downgraded just because they asked a
 * follow-up question.
 */
async function maybeUpdateLeadScore({ leadId, previousTemperature, temperature, reason }) {
  if (!leadId || !temperature) return;

  const wasHot = previousTemperature === 'hot';
  const cooled = typeof reason === 'string' && reason.includes('!cooled');

  if (wasHot && !cooled) {
    return; // keep the existing hot score
  }

  const { error } = await supabase
    .from('leads')
    .update({
      lead_temperature: temperature,
      temperature_reason: reason,
    })
    .eq('id', leadId);

  if (error) {
    console.error(`[leads] score update failed for lead ${leadId}:`, error.message);
  }
}

module.exports = { getLead, upsertLead, maybeUpdateLeadScore };
