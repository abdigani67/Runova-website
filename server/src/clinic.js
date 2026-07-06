'use strict';

const { supabase } = require('./supabase');

/**
 * Look up a clinic by the Instagram page id (the webhook recipient id).
 * Returns the clinic row, or null if none is found.
 */
async function getClinicByPageId(instagramPageId) {
  const { data, error } = await supabase
    .from('clinics')
    .select('*')
    .eq('instagram_page_id', instagramPageId)
    .maybeSingle();

  if (error) {
    console.error(`[clinic] lookup failed for page ${instagramPageId}:`, error.message);
    return null;
  }
  return data || null;
}

/**
 * Fetch active treatments for a clinic and format them into a readable string
 * for the Anthropic system prompt.
 */
async function getTreatmentsString(clinicId, clinicName) {
  const { data, error } = await supabase
    .from('treatments')
    .select('treatment_name, price_from, price_to, duration_mins, description')
    .eq('clinic_id', clinicId)
    .eq('active', true);

  if (error) {
    console.error(`[clinic] treatments lookup failed for clinic ${clinicName}:`, error.message);
    return 'No treatment information is currently available.';
  }
  if (!data || data.length === 0) {
    return 'No treatments are currently listed.';
  }

  return data
    .map((t) => {
      const price =
        t.price_from != null && t.price_to != null
          ? `£${t.price_from}—£${t.price_to}`
          : t.price_from != null
            ? `from £${t.price_from}`
            : 'price on request';
      const duration = t.duration_mins != null ? `${t.duration_mins} mins` : 'varies';
      const info = t.description || '';
      return `Treatment: ${t.treatment_name}, Price: ${price}, Duration: ${duration}, Info: ${info}`;
    })
    .join('\n');
}

module.exports = { getClinicByPageId, getTreatmentsString };
