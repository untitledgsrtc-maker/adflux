// api/wa/team-nudge.js — EDGE runtime.
// WhatsApp Internal Team Assistant — Phase 3 (every-2-hour pending nudge).
// Spec: docs/WHATSAPP_INTERNAL_ASSISTANT_SPEC.md · SQL: supabase_wa_team_assistant_p3.sql
// ─────────────────────────────────────────────────────────────────────────
// Fired by the team_assistant_nudge_dispatch pg_cron job every 2h during work
// hours. For each mapped rep who (a) has >=1 open follow-up due-today/overdue AND
// (b) has an OPEN 24h WhatsApp window (messaged our number in the last 24h — we
// know from team_assistant_requests), sends a short free-text reminder from the
// number they messaged, to their own number.
//
// v1 = FREE-TEXT ONLY: a rep who hasn't messaged in 24h (window closed) is
// SKIPPED (no template — that's P4). So the reps who say "hi" daily get the
// day's nudges; the silent ones don't (yet). ₹0 messaging.
//
// SECURITY: x-ta-secret gated + fail-closed. Each rep only ever gets THEIR OWN
// pending count, sent to THEIR OWN number. No Claude, no data beyond a count.
// Env: SUPABASE_URL (||VITE_) + SUPABASE_SERVICE_ROLE_KEY + CAMPAIGN_WA_TOKEN
//   + TEAM_ASSISTANT_SECRET.
// ─────────────────────────────────────────────────────────────────────────

export const config = { runtime: 'edge' }

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const WA_TOKEN     = process.env.CAMPAIGN_WA_TOKEN
const TA_SECRET    = process.env.TEAM_ASSISTANT_SECRET
const GRAPH        = 'https://graph.facebook.com/v21.0'

const ok   = (obj = {}) => new Response(JSON.stringify({ ok: true, ...obj }), { status: 200, headers: { 'content-type': 'application/json' } })
const nope = (reason, status = 200) => new Response(JSON.stringify({ ok: false, reason }), { status, headers: { 'content-type': 'application/json' } })

const sb = (path, init = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  ...init,
  headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json', ...(init.headers || {}) },
})
const sbRows = async (path) => { try { return (await (await sb(path)).json()) || [] } catch { return [] } }
const sbCount = async (path) => {
  try {
    const r = await sb(path + (path.includes('?') ? '&' : '?') + 'select=id&limit=1', { headers: { Prefer: 'count=exact' } })
    const n = parseInt(String(r.headers.get('content-range') || '').split('/')[1], 10)
    return Number.isFinite(n) ? n : 0
  } catch { return 0 }
}

export default async function handler(req) {
  if (req.method !== 'POST') return nope('method_not_allowed', 405)
  if (!SUPABASE_URL || !SERVICE_KEY || !WA_TOKEN || !TA_SECRET) return nope('not_configured', 503)
  if (String(req.headers.get('x-ta-secret') || '') !== TA_SECRET) return nope('forbidden', 403)

  // IST work-hours gate (re-checked here even though the cron schedules the UTC
  // hours — belt-and-suspenders + skips Sunday, which the every-2h cron can't).
  const istNow = new Date(Date.now() + 5.5 * 3600 * 1000)
  const istHour = istNow.getUTCHours()
  if (istNow.getUTCDay() === 0) return ok({ skipped: 'sunday' })
  if (istHour < 9 || istHour >= 20) return ok({ skipped: 'off_hours', istHour })

  const istToday = istNow.toISOString().slice(0, 10)
  const dayAgo   = new Date(Date.now() - 24 * 3600 * 1000).toISOString()

  const reps = await sbRows(`users?whatsapp_number=not.is.null&is_active=eq.true&select=id,name`)
  let sent = 0, closed = 0, clear = 0

  const sendText = async (pnid, to, text) => {
    const gr = await fetch(`${GRAPH}/${pnid}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WA_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
    })
    if (!gr.ok) throw new Error('graph_' + gr.status)
  }

  for (const r of reps) {
    const uid = r.id
    const pending = await sbCount(`follow_ups?assigned_to=eq.${uid}&is_done=eq.false&follow_up_date=lte.${istToday}`)
    if (pending < 1) { clear++; continue }                       // nothing pending → no nudge
    // Open 24h window? = they messaged our number in the last 24h (team_assistant_requests).
    const last = (await sbRows(`team_assistant_requests?user_id=eq.${uid}&created_at=gte.${dayAgo}&select=phone_number_id,wa_from&order=created_at.desc&limit=1`))?.[0]
    const to = String(last?.wa_from || '').replace(/\D/g, '')
    const pnid = String(last?.phone_number_id || '')
    if (to.length < 10 || !/^\d+$/.test(pnid)) { closed++; continue }   // window closed → skip (v1, no template)
    const first = String(r.name || '').trim().split(/\s+/)[0] || 'there'
    const text = `👋 ${first}, quick reminder — you have ${pending} follow-up${pending > 1 ? 's' : ''} due or overdue today. Reply "hi" for your full plan.`
    try { await sendText(pnid, to, text); sent++ } catch { /* skip this rep, continue */ }
  }

  return ok({ reps: reps.length, sent, window_closed: closed, no_pending: clear })
}
