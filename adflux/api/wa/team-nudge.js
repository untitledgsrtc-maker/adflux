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

// Run fn over items with a small concurrency. The old loops were fully sequential (3 reads + 1 WhatsApp send per
// person) and, with ~25 people, ran past the 8 s the pg_cron caller waits; the caller then hung up and the Edge
// function was cut mid-loop, so only the first people got a nudge. Parallel batches finish in a couple of seconds.
const pool = async (items, size, fn) => {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn))
}

export default async function handler(req) {
  if (req.method !== 'POST') return nope('method_not_allowed', 405)
  if (!SUPABASE_URL || !SERVICE_KEY || !WA_TOKEN || !TA_SECRET) return nope('not_configured', 503)
  if (String(req.headers.get('x-ta-secret') || '') !== TA_SECRET) return nope('forbidden', 403)

  // IST work-hours gate (re-checked here even though the cron schedules the UTC
  // hours — belt-and-suspenders + skips Sunday, which the every-2h cron can't).
  const istNow = new Date(Date.now() + 5.5 * 3600 * 1000)
  const istHour = istNow.getUTCHours()
  // Phase 411 TEST: {"force":true,"only":"<first name>"} bypasses the Sunday/hours gate for EXACTLY ONE person
  // (the real path otherwise: pending count + open 24h window + Meta send). Refused if the name matches 0 or 2+ people.
  let body0 = {}
  try { body0 = (await req.clone().json()) || {} } catch { /* normal cron call has no usable body */ }
  const forced = body0.force === true && typeof body0.only === 'string' && body0.only.trim().length >= 3
  if (!forced) {
    if (istNow.getUTCDay() === 0) return ok({ skipped: 'sunday' })
    if (istHour < 9 || istHour >= 20) return ok({ skipped: 'off_hours', istHour })
  }

  const istToday = istNow.toISOString().slice(0, 10)
  const dayAgo   = new Date(Date.now() - 24 * 3600 * 1000).toISOString()

  let mode = ''
  try { mode = String((await req.json())?.mode || '') } catch { /* no body = the normal pending-follow-up nudge */ }

  let reps = await sbRows(`users?whatsapp_number=not.is.null&is_active=eq.true&select=id,name,role`)
  if (forced) {
    const q = body0.only.trim().toLowerCase()
    reps = reps.filter((r) => String(r.name || '').toLowerCase().startsWith(q))
    if (reps.length !== 1) return nope('force_needs_exactly_one_match:' + reps.length)
  }
  let sent = 0, closed = 0, clear = 0, failed = 0
  const errs = {}   // Meta error code -> count, returned so a failing nudge is visible in the cron response

  const sendText = async (pnid, to, text) => {
    const gr = await fetch(`${GRAPH}/${pnid}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WA_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
    })
    if (!gr.ok) {
      let code = ''
      try { const j = await gr.json(); code = String(j?.error?.code || '') + (j?.error?.error_subcode ? '/' + j.error.error_subcode : '') } catch { /* keep status only */ }
      throw new Error('graph_' + gr.status + (code ? ':' + code : ''))
    }
  }

  // Evening report reminder (Phase 371): only people with an open window who have NOT shared today's report.
  if (mode === 'evening') {
    if (istHour < 19 || istHour >= 21) return ok({ skipped: 'not_evening', istHour })
    await pool(reps, 8, async (r) => {
      if (['admin', 'co_owner', 'agency'].includes(r.role)) return
      const uid = r.id
      const shared = (await sbCount(`work_sessions?user_id=eq.${uid}&work_date=eq.${istToday}&evening_summary_sent_at=not.is.null`))
        + (await sbCount(`work_report_shares?user_id=eq.${uid}&work_date=eq.${istToday}`))
      if (shared > 0) { clear++; return }
      const worked = (await sbCount(`work_sessions?user_id=eq.${uid}&work_date=eq.${istToday}&check_in_at=not.is.null`)) > 0
      if (!worked) { clear++; return }
      const last = (await sbRows(`team_assistant_requests?user_id=eq.${uid}&created_at=gte.${dayAgo}&select=phone_number_id,wa_from&order=created_at.desc&limit=1`))?.[0]
      const to = String(last?.wa_from || '').replace(/\D/g, '')
      const pnid = String(last?.phone_number_id || '')
      if (to.length < 10 || !/^\d+$/.test(pnid)) { closed++; return }
      const first = String(r.name || '').trim().split(/\s+/)[0] || 'there'
      try { await sendText(pnid, to, `${first}, your evening report is not shared yet. Open the app and tap Share to send it.`); sent++ } catch (e) { failed++; errs[e.message] = (errs[e.message] || 0) + 1 }
    })
    return ok({ mode, reps: reps.length, sent, failed, errors: errs, window_closed: closed, already_shared_or_off: clear })
  }

  await pool(reps, 8, async (r) => {
    const uid = r.id
    let pending
    let what = 'follow-up'
    if (r.role === 'staff') { pending = await sbCount(`work_task_parts?assignee_id=eq.${uid}&status=not.in.(finished,postponed)&due_date=lte.${istToday}`); what = 'task' }
    else if (r.role === 'operation_executive') { pending = await sbCount(`ops_tickets?assigned_to=eq.${uid}&status=in.(open,in_progress)`); what = 'open fault' }
    else if (['operation_head', 'hr', 'accounts', 'office_staff', 'office_admin'].includes(r.role)) { clear++; return }
    else pending = await sbCount(`follow_ups?assigned_to=eq.${uid}&is_done=eq.false&follow_up_date=lte.${istToday}`)
    if (pending < 1) { clear++; return }                       // nothing pending → no nudge
    // Open 24h window? = they messaged our number in the last 24h (team_assistant_requests).
    const last = (await sbRows(`team_assistant_requests?user_id=eq.${uid}&created_at=gte.${dayAgo}&select=phone_number_id,wa_from&order=created_at.desc&limit=1`))?.[0]
    const to = String(last?.wa_from || '').replace(/\D/g, '')
    const pnid = String(last?.phone_number_id || '')
    if (to.length < 10 || !/^\d+$/.test(pnid)) { closed++; return }   // window closed → skip (v1, no template)
    const first = String(r.name || '').trim().split(/\s+/)[0] || 'there'
    const text = `👋 ${first}, quick reminder — you have ${pending} ${what}${pending > 1 ? 's' : ''} ${what === 'open fault' ? 'waiting' : 'due or overdue today'}. Reply "hi" for your full plan.`
    try { await sendText(pnid, to, text); sent++ } catch (e) { failed++; errs[e.message] = (errs[e.message] || 0) + 1 }
  })

  return ok({ reps: reps.length, sent, failed, errors: errs, window_closed: closed, no_pending: clear })
}
