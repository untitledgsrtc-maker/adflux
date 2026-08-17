// api/wa/team-assistant.js — EDGE runtime.
// WhatsApp Internal Team Assistant — Phase 1 ("hi → your day").
// Spec: docs/WHATSAPP_INTERNAL_ASSISTANT_SPEC.md · SQL: supabase_wa_team_assistant_p1.sql
// ─────────────────────────────────────────────────────────────────────────
// Dispatched ASYNC by the team_assistant_dispatch pg_net trigger when a KNOWN
// REP messages the 95 number (the webhook recognised the sender number and wrote
// a team_assistant_requests row instead of a customer conversation). This reads
// that request, pulls the rep's OWN data (scoped to the user_id the webhook
// resolved from the number map — never from message content), formats a short
// snapshot, and sends it back on WhatsApp.
//
// WHY EDGE: the Vercel Hobby plan caps a deploy at 12 Node functions (§219) — an
// Edge fn doesn't count. Raw fetch to Supabase REST + the Graph API, no supabase-js.
//
// SECURITY: called only by our own DB trigger, gated by a shared secret header
// (x-ta-secret == TEAM_ASSISTANT_SECRET). A rep only ever gets THEIR own data,
// sent to THEIR own number (both taken from the trusted request row) — a forged
// call (even with the secret) can only re-send a rep's snapshot to that rep.
// No Claude in P1 — this just formats + sends. NL queries + PDF are P2.
//
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
const dmy = (d) => { const p = String(d || '').split('-'); return p.length === 3 ? `${p[2]}/${p[1]}` : String(d || '') }

export default async function handler(req) {
  if (req.method !== 'POST') return nope('method_not_allowed', 405)
  if (!SUPABASE_URL || !SERVICE_KEY || !WA_TOKEN || !TA_SECRET) return nope('not_configured', 503)
  if (String(req.headers.get('x-ta-secret') || '') !== TA_SECRET) return nope('forbidden', 403)

  let body
  try { body = await req.json() } catch { return nope('bad_body', 400) }
  const rid = String(body?.request_id || '')
  // UUID only — interpolated into a PostgREST filter below.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rid)) return nope('bad_request_id')

  const request = (await sbRows(`team_assistant_requests?id=eq.${rid}&select=id,user_id,wa_from,phone_number_id,status,handled_at&limit=1`))?.[0]
  if (!request) return nope('request_not_found')
  if (request.handled_at) return nope('already_handled')   // idempotency — never double-send
  const uid = request.user_id
  const to  = String(request.wa_from || '').replace(/\D/g, '')   // digits only (send target)
  const pnid = String(request.phone_number_id || '')
  // Defence-in-depth: both are DB-sourced (Meta payload, past the webhook HMAC
  // gate) but get interpolated into the Graph URL / send target — validate shape.
  if (!uid || to.length < 10 || !/^\d+$/.test(pnid)) { await markDone(rid, 'error'); return nope('incomplete_request') }

  // Per-rep debounce (review finding F2): if this rep already got a snapshot in
  // the last ~90s, skip — rapid "hi / hello" must not fire two snapshots.
  // handled_at is per-request, so this is the cross-request guard.
  const since = new Date(Date.now() - 90_000).toISOString()
  const recent = await sbRows(`team_assistant_requests?user_id=eq.${uid}&status=eq.handled&handled_at=gte.${since}&select=id&limit=1`)
  if (recent.length) { await markDone(rid, 'skipped'); return nope('debounced') }

  // ── IST "today" ──
  const IST_MS = 5.5 * 3600 * 1000
  const istNow = new Date(Date.now() + IST_MS)
  const istToday = istNow.toISOString().slice(0, 10)                                   // YYYY-MM-DD (IST)
  const ist30    = new Date(istNow.getTime() + 30 * 86400000).toISOString().slice(0, 10)
  const istMidnightUtc = new Date(`${istToday}T00:00:00+05:30`).toISOString()          // start of IST today, in UTC

  // ── the rep's own data (service key bypasses RLS; every query scoped to uid) ──
  const user = (await sbRows(`users?id=eq.${uid}&select=name&limit=1`))?.[0] || {}
  const firstName = String(user.name || '').trim().split(/\s+/)[0] || 'there'

  const tgtRow = (await sbRows(`daily_targets?user_id=eq.${uid}&select=min_calls&limit=1`))?.[0]
  const callsTarget = Number(tgtRow?.min_calls) > 0 ? Number(tgtRow.min_calls) : 50
  const callsDone = await sbCount(`call_logs?user_id=eq.${uid}&call_at=gte.${istMidnightUtc}`)

  const fups = await sbRows(`follow_ups?assigned_to=eq.${uid}&is_done=eq.false&follow_up_date=lte.${istToday}&select=follow_up_date,note,leads(name)&order=follow_up_date.asc&limit=40`)
  const dueToday = fups.filter((f) => f.follow_up_date === istToday)
  const overdue  = fups.filter((f) => f.follow_up_date < istToday)
  const fupLabel = (f) => (f.leads && f.leads.name && String(f.leads.name).trim()) || (f.note ? String(f.note).slice(0, 30) : 'a lead')

  const renewals = await sbRows(`quotes?created_by=eq.${uid}&status=eq.won&campaign_end_date=gte.${istToday}&campaign_end_date=lte.${ist30}&select=client_name,client_company,campaign_end_date&order=campaign_end_date.asc&limit=10`)

  // ── format (plain WhatsApp text — no markdown; emoji ok, §33 waiver) ──
  const L = []
  L.push(`Hi ${firstName} 👋 Here's your day:`)
  L.push('')
  L.push(`📞 Calls today: ${callsDone}/${callsTarget}`)
  L.push('')
  if (dueToday.length) {
    L.push(`📋 Follow-ups due today: ${dueToday.length}`)
    dueToday.slice(0, 6).forEach((f) => L.push(`• ${fupLabel(f)}`))
    if (dueToday.length > 6) L.push(`…and ${dueToday.length - 6} more`)
  } else {
    L.push('📋 No follow-ups due today ✅')
  }
  if (overdue.length) L.push(`⏰ ${overdue.length} overdue — clear these first`)
  L.push('')
  if (renewals.length) {
    L.push(`🔁 Renewals due (next 30 days): ${renewals.length}`)
    renewals.slice(0, 6).forEach((q) => L.push(`• ${(q.client_company || q.client_name || 'client')} — ${dmy(q.campaign_end_date)}`))
  } else {
    L.push('🔁 No renewals due in the next 30 days')
  }
  L.push('')
  L.push('Send "hi" anytime for the latest. (Coming soon: send a quote PDF, your meetings, incentive.)')
  const text = L.join('\n')

  // ── send + mark handled ──
  try {
    const gr = await fetch(`${GRAPH}/${pnid}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WA_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
    })
    const gd = await gr.json().catch(() => ({}))
    if (!gr.ok) { await markDone(rid, 'error'); return nope('send_failed:' + (gd?.error?.message || gr.status), 502) }
  } catch (e) { await markDone(rid, 'error'); return nope('send_error', 502) }

  await markDone(rid, 'handled')
  return ok()
}

async function markDone(rid, status) {
  try { await sb(`team_assistant_requests?id=eq.${rid}`, { method: 'PATCH', body: JSON.stringify({ status, handled_at: new Date().toISOString() }) }) } catch { /* non-fatal */ }
}
