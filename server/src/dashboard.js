'use strict';

const { supabase } = require('./supabase');

const DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN;

function esc(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function relativeTime(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 45) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function truncate(text, n) {
  if (!text) return '';
  const t = String(text);
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

async function loadData() {
  const [leadsRes, convsRes, clinicsRes] = await Promise.all([
    supabase
      .from('leads')
      .select('id, instagram_handle, display_name, lead_temperature, temperature_reason, status, message_count, last_message, last_contact, clinic_id')
      .order('last_contact', { ascending: false, nullsFirst: false })
      .limit(25),
    supabase
      .from('conversations')
      .select('instagram_handle, sender_type, message_text, timestamp, clinic_id')
      .order('timestamp', { ascending: false })
      .limit(40),
    supabase.from('clinics').select('id, clinic_name'),
  ]);

  const firstError = leadsRes.error || convsRes.error || clinicsRes.error;
  const clinicMap = {};
  for (const c of clinicsRes.data || []) clinicMap[c.id] = c.clinic_name;

  return {
    leads: leadsRes.data || [],
    conversations: convsRes.data || [],
    clinicMap,
    error: firstError ? firstError.message : null,
  };
}

function tempChip(temp) {
  const t = (temp || '').toLowerCase();
  if (t === 'hot') return '<span class="chip hot">Hot</span>';
  if (t === 'warm') return '<span class="chip warm">Warm</span>';
  if (t === 'cold') return '<span class="chip cold">Cold</span>';
  return '<span class="chip none">—</span>';
}

function senderLabel(type) {
  if (type === 'ai') return '<span class="who ai">AI</span>';
  if (type === 'staff') return '<span class="who staff">Staff</span>';
  return '<span class="who cust">Customer</span>';
}

function renderPage({ leads, conversations, clinicMap, error }, token) {
  const counts = { hot: 0, warm: 0, cold: 0 };
  for (const l of leads) {
    const t = (l.lead_temperature || '').toLowerCase();
    if (counts[t] != null) counts[t] += 1;
  }

  const errorBanner = error
    ? `<div class="banner">Couldn't reach the database: ${esc(error)}. Check the Supabase environment variables.</div>`
    : '';

  const emptyLeads = leads.length === 0
    ? '<p class="empty">No leads yet — they appear here as customers message in.</p>'
    : '';
  const emptyConvs = conversations.length === 0
    ? '<p class="empty">No messages yet.</p>'
    : '';

  const leadCards = leads
    .map((l) => {
      const name = l.display_name || l.instagram_handle || 'unknown';
      const clinic = clinicMap[l.clinic_id] || 'clinic';
      return `
      <article class="lead">
        <div class="lead-top">
          <span class="handle">${esc(name)}</span>
          ${tempChip(l.lead_temperature)}
        </div>
        ${l.temperature_reason ? `<p class="reason">${esc(l.temperature_reason)}</p>` : ''}
        ${l.last_message ? `<p class="last">${esc(truncate(l.last_message, 90))}</p>` : ''}
        <div class="lead-meta">
          <span>${esc(clinic)}</span>
          <span>·</span>
          <span>${esc(l.message_count || 0)} msg${l.message_count === 1 ? '' : 's'}</span>
          <span>·</span>
          <span>${esc(relativeTime(l.last_contact))}</span>
        </div>
      </article>`;
    })
    .join('');

  const convRows = conversations
    .map((c) => {
      const clinic = clinicMap[c.clinic_id] || 'clinic';
      return `
      <div class="msg-row ${c.sender_type === 'ai' ? 'is-ai' : ''}">
        <div class="msg-head">
          ${senderLabel(c.sender_type)}
          <span class="msg-handle">${esc(c.instagram_handle)}</span>
          <span class="msg-time">${esc(relativeTime(c.timestamp))}</span>
        </div>
        <p class="msg-text">${esc(truncate(c.message_text, 180))}</p>
        <span class="msg-clinic">${esc(clinic)}</span>
      </div>`;
    })
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="20">
<title>Runova · Live activity</title>
<style>
:root{
  --bg:#f4f5f8;--panel:#fff;--panel-2:#fafbfd;--ink:#14161d;--ink-2:#3d424f;--ink-3:#6b7180;
  --line:#e2e5ec;--line-2:#d4d8e2;--accent:#d6357a;--accent-soft:#fdeaf2;
  --hot:#e0532a;--warm:#c98a1e;--cold:#3f6fd6;
  --hot-soft:#fbe9e2;--warm-soft:#f7efdc;--cold-soft:#e6edfb;
  --shadow-sm:0 1px 2px rgba(20,22,29,.06);
  --mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif;
}
@media (prefers-color-scheme:dark){:root{
  --bg:#0d0f15;--panel:#171a22;--panel-2:#1c1f28;--ink:#f2f3f7;--ink-2:#c3c7d2;--ink-3:#8b91a1;
  --line:#262a34;--line-2:#333846;--accent:#f0578f;--accent-soft:#2a1622;
  --hot:#f47a4e;--warm:#e4b24d;--cold:#6f97f0;--hot-soft:#2c1a12;--warm-soft:#2a2311;--cold-soft:#131c30;
  --shadow-sm:0 1px 2px rgba(0,0,0,.4);
}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.5;-webkit-font-smoothing:antialiased}
.wrap{max-width:74rem;margin:0 auto;padding:2rem clamp(1rem,4vw,2rem) 4rem}
header{display:flex;flex-wrap:wrap;gap:.75rem 1rem;align-items:baseline;justify-content:space-between;margin-bottom:1.4rem}
h1{font-size:1.5rem;letter-spacing:-.02em;margin:0;font-weight:750}
.sub{font-family:var(--mono);font-size:.72rem;color:var(--ink-3);letter-spacing:.05em}
.live-dot{display:inline-block;width:.5rem;height:.5rem;border-radius:50%;background:var(--accent);margin-right:.4rem;vertical-align:middle;animation:pulse 2.4s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.banner{background:var(--hot-soft);border:1px solid var(--hot);color:var(--hot);border-radius:10px;padding:.7rem 1rem;font-size:.85rem;margin-bottom:1.2rem}
.stats{display:flex;flex-wrap:wrap;gap:.6rem;margin-bottom:1.6rem}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:.6rem .9rem;box-shadow:var(--shadow-sm);min-width:5.5rem}
.stat .n{font-size:1.35rem;font-weight:750;font-family:var(--mono);letter-spacing:-.02em}
.stat .k{font-family:var(--mono);font-size:.64rem;text-transform:uppercase;letter-spacing:.1em;color:var(--ink-3)}
.stat.hot .n{color:var(--hot)}.stat.warm .n{color:var(--warm)}.stat.cold .n{color:var(--cold)}
.grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:1.4rem}
@media (max-width:820px){.grid{grid-template-columns:1fr}}
.col-head{font-family:var(--mono);font-size:.7rem;text-transform:uppercase;letter-spacing:.12em;color:var(--ink-3);margin:0 0 .8rem}
.lead{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:.85rem .95rem;box-shadow:var(--shadow-sm);margin-bottom:.7rem}
.lead-top{display:flex;align-items:center;justify-content:space-between;gap:.6rem}
.handle{font-weight:650;font-size:.95rem}
.reason{margin:.4rem 0 0;color:var(--ink-2);font-size:.85rem}
.last{margin:.35rem 0 0;color:var(--ink-3);font-size:.82rem;font-style:italic}
.lead-meta{display:flex;flex-wrap:wrap;gap:.35rem;margin-top:.55rem;font-family:var(--mono);font-size:.68rem;color:var(--ink-3)}
.chip{font-family:var(--mono);font-size:.66rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;padding:.2rem .5rem;border-radius:6px}
.chip.hot{color:var(--hot);background:var(--hot-soft);border:1px solid color-mix(in srgb,var(--hot) 35%,transparent)}
.chip.warm{color:var(--warm);background:var(--warm-soft);border:1px solid color-mix(in srgb,var(--warm) 35%,transparent)}
.chip.cold{color:var(--cold);background:var(--cold-soft);border:1px solid color-mix(in srgb,var(--cold) 35%,transparent)}
.chip.none{color:var(--ink-3);background:var(--panel-2);border:1px solid var(--line)}
.feed{display:flex;flex-direction:column;gap:.55rem}
.msg-row{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:.7rem .9rem;box-shadow:var(--shadow-sm)}
.msg-row.is-ai{border-left:3px solid var(--accent)}
.msg-head{display:flex;align-items:center;gap:.5rem;font-family:var(--mono);font-size:.7rem;color:var(--ink-3)}
.who{font-weight:600;padding:.12rem .4rem;border-radius:5px}
.who.cust{color:var(--ink-2);background:var(--panel-2);border:1px solid var(--line)}
.who.ai{color:var(--accent);background:var(--accent-soft)}
.who.staff{color:var(--warm);background:var(--warm-soft)}
.msg-handle{color:var(--ink-2)}
.msg-time{margin-left:auto}
.msg-text{margin:.4rem 0 .25rem;font-size:.88rem;color:var(--ink);line-height:1.45}
.msg-clinic{font-family:var(--mono);font-size:.64rem;color:var(--ink-3)}
.empty{color:var(--ink-3);font-size:.9rem;background:var(--panel-2);border:1px dashed var(--line-2);border-radius:10px;padding:1rem}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div>
      <h1><span class="live-dot"></span>Live activity</h1>
      <div class="sub">Runova receptionist · auto-refreshes every 20s</div>
    </div>
    <div class="sub">${esc(new Date().toLocaleTimeString())}</div>
  </header>

  ${errorBanner}

  <div class="stats">
    <div class="stat"><div class="n">${leads.length}</div><div class="k">Recent leads</div></div>
    <div class="stat hot"><div class="n">${counts.hot}</div><div class="k">Hot</div></div>
    <div class="stat warm"><div class="n">${counts.warm}</div><div class="k">Warm</div></div>
    <div class="stat cold"><div class="n">${counts.cold}</div><div class="k">Cold</div></div>
  </div>

  <div class="grid">
    <section>
      <p class="col-head">Recent leads</p>
      ${emptyLeads}
      ${leadCards}
    </section>
    <section>
      <p class="col-head">Message feed</p>
      ${emptyConvs}
      <div class="feed">${convRows}</div>
    </section>
  </div>
</div>
</body>
</html>`;
}

/**
 * Token-gated live activity dashboard.
 * Access: GET /dashboard?token=<DASHBOARD_TOKEN>
 */
async function handleDashboard(req, res) {
  if (!DASHBOARD_TOKEN) {
    return res
      .status(503)
      .type('text/plain')
      .send('Dashboard is disabled. Set DASHBOARD_TOKEN to enable it.');
  }
  if (req.query.token !== DASHBOARD_TOKEN) {
    return res.status(401).type('text/plain').send('Unauthorized. Append ?token=... to the URL.');
  }

  try {
    const data = await loadData();
    res.status(200).type('html').send(renderPage(data, req.query.token));
  } catch (err) {
    console.error('[dashboard] render failed:', err.message);
    res
      .status(200)
      .type('html')
      .send(
        renderPage(
          { leads: [], conversations: [], clinicMap: {}, error: err.message },
          req.query.token
        )
      );
  }
}

module.exports = { handleDashboard };
