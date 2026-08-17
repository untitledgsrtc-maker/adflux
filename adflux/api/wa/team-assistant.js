// api/wa/team-assistant.js — EDGE runtime.
// WhatsApp Internal Team Assistant — Phase 1 + 2.
// Spec: docs/WHATSAPP_INTERNAL_ASSISTANT_SPEC.md · SQL: supabase_wa_team_assistant_p1.sql
// ─────────────────────────────────────────────────────────────────────────
// Dispatched ASYNC by the team_assistant_dispatch pg_net trigger when a KNOWN
// REP messages the 95 number (the webhook resolved the sender number → user_id).
// Replies with the rep's OWN data:
//   • a plain greeting ("hi") → their day snapshot (P1, no Claude, free).
//   • a question → Claude answers from the rep's scoped data (P2).
//   • "send X's quote" → Claude picks the quote, the endpoint sends its stored
//     PDF as a WhatsApp document (P2).
//
// SECURITY: x-ta-secret gated + fail-closed. Identity is the webhook-resolved
// request.user_id — NEVER message content. Every data query is scoped =eq.uid.
// Claude only ever sees THIS rep's own data + own quotes; a SENDPDF is
// re-verified against the rep's own quote list before sending, and the reply
// goes only to the rep's own number. So a rep can never reach another rep's
// data, quotes, or PDF.
//
// WHY EDGE: the Vercel Hobby plan caps a deploy at 12 Node functions (§219) —
// Edge doesn't count. Raw fetch to Supabase REST + Anthropic + the Graph API.
//
// Env: SUPABASE_URL (||VITE_) + SUPABASE_SERVICE_ROLE_KEY + CAMPAIGN_WA_TOKEN
//   + TEAM_ASSISTANT_SECRET + ANTHROPIC_API_KEY [+ ANTHROPIC_MODEL].
// ─────────────────────────────────────────────────────────────────────────

export const config = { runtime: 'edge' }

const SUPABASE_URL  = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY
const WA_TOKEN      = process.env.CAMPAIGN_WA_TOKEN
const TA_SECRET     = process.env.TEAM_ASSISTANT_SECRET
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY
const MODEL         = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5'
const GRAPH         = 'https://graph.facebook.com/v21.0'
const ANTHROPIC     = 'https://api.anthropic.com/v1/messages'

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
const inr = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN')

// A message that is ONLY a greeting (or empty) → the free fixed snapshot, no
// Claude. Anything with a real question falls through to Claude.
const GREETING_RE = /^[^\p{L}\p{N}]*(hi+|hey+|hello+|hlo|helo|menu|start|status|day|report|update|morning|namaste|namaskar|jai\s*\w+|kem\s*cho|good\s*(morning|afternoon|evening|noon))?[^\p{L}\p{N}]*$/iu
const isGreeting = (m) => { const s = String(m || '').trim(); return !s || (s.length <= 40 && GREETING_RE.test(s)) }

async function markDone(rid, status) {
  try { await sb(`team_assistant_requests?id=eq.${rid}`, { method: 'PATCH', body: JSON.stringify({ status, handled_at: new Date().toISOString() }) }) } catch { /* non-fatal */ }
}

export default async function handler(req) {
  if (req.method !== 'POST') return nope('method_not_allowed', 405)
  if (!SUPABASE_URL || !SERVICE_KEY || !WA_TOKEN || !TA_SECRET) return nope('not_configured', 503)
  if (String(req.headers.get('x-ta-secret') || '') !== TA_SECRET) return nope('forbidden', 403)

  let body
  try { body = await req.json() } catch { return nope('bad_body', 400) }
  const rid = String(body?.request_id || '')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rid)) return nope('bad_request_id')

  const request = (await sbRows(`team_assistant_requests?id=eq.${rid}&select=id,user_id,wa_from,phone_number_id,status,handled_at,message_text&limit=1`))?.[0]
  if (!request) return nope('request_not_found')
  if (request.handled_at) return nope('already_handled')
  const uid  = request.user_id
  const to   = String(request.wa_from || '').replace(/\D/g, '')
  const pnid = String(request.phone_number_id || '')
  const msg  = String(request.message_text || '')
  if (!uid || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(uid)) || to.length < 10 || !/^\d+$/.test(pnid)) { await markDone(rid, 'error'); return nope('incomplete_request') }

  const greeting = isGreeting(msg)

  // Per-rep debounce — ONLY for greetings (rapid "hi hi" must not fire two
  // snapshots). A real question is ALWAYS answered (a rep asking two different
  // things in a row must get two answers), so the debounce never blocks P2.
  if (greeting) {
    const since = new Date(Date.now() - 90_000).toISOString()
    const recent = await sbRows(`team_assistant_requests?user_id=eq.${uid}&status=eq.handled&handled_at=gte.${since}&select=id&limit=1`)
    if (recent.length) { await markDone(rid, 'skipped'); return nope('debounced') }
  }

  // ── IST + the rep's own data (service key; every query scoped to uid) ──
  const IST_MS = 5.5 * 3600 * 1000
  const istNow = new Date(Date.now() + IST_MS)
  const istToday = istNow.toISOString().slice(0, 10)
  const istMonth = istToday.slice(0, 7)
  const ist30    = new Date(istNow.getTime() + 30 * 86400000).toISOString().slice(0, 10)
  const istMidnightUtc = new Date(`${istToday}T00:00:00+05:30`).toISOString()

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

  const msdRow = (await sbRows(`monthly_sales_data?staff_id=eq.${uid}&month_year=eq.${istMonth}&select=new_client_revenue,renewal_revenue&limit=1`))?.[0]
  const businessMonth = (Number(msdRow?.new_client_revenue) || 0) + (Number(msdRow?.renewal_revenue) || 0)

  // the rep's recent quotes — for Claude to answer quote questions + resolve a "send PDF"
  const quotes = await sbRows(`quotes?created_by=eq.${uid}&select=id,quote_number,client_name,client_company,status,total_amount&order=created_at.desc&limit=30`)

  // ── the fixed day snapshot (greetings + Claude-failure fallback) ──
  const snapshot = () => {
    const L = []
    L.push(`Hi ${firstName} 👋 Here's your day:`)
    L.push('')
    L.push(`📞 Calls today: ${callsDone}/${callsTarget}`)
    L.push('')
    if (dueToday.length) {
      L.push(`📋 Follow-ups due today: ${dueToday.length}`)
      dueToday.slice(0, 6).forEach((f) => L.push(`• ${fupLabel(f)}`))
      if (dueToday.length > 6) L.push(`…and ${dueToday.length - 6} more`)
    } else L.push('📋 No follow-ups due today ✅')
    if (overdue.length) L.push(`⏰ ${overdue.length} overdue — clear these first`)
    L.push('')
    if (renewals.length) {
      L.push(`🔁 Renewals due (next 30 days): ${renewals.length}`)
      renewals.slice(0, 6).forEach((q) => L.push(`• ${(q.client_company || q.client_name || 'client')} — ${dmy(q.campaign_end_date)}`))
    } else L.push('🔁 No renewals due in the next 30 days')
    if (businessMonth > 0) { L.push(''); L.push(`💰 Business this month: ${inr(businessMonth)}`) }
    L.push('')
    L.push('Ask me anything — "my renewals", "send Mahant\'s quote", "how many follow-ups".')
    return L.join('\n')
  }

  const sendText = async (text) => {
    const gr = await fetch(`${GRAPH}/${pnid}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WA_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
    })
    if (!gr.ok) { const gd = await gr.json().catch(() => ({})); throw new Error(gd?.error?.message || ('graph_' + gr.status)) }
  }

  // ── greeting → snapshot, no Claude ──
  if (greeting) {
    try { await sendText(snapshot()) } catch (e) { await markDone(rid, 'error'); return nope('send_failed:' + String(e?.message || e), 502) }
    await markDone(rid, 'handled')
    return ok({ mode: 'snapshot' })
  }

  // ── a real question → Claude, grounded in the rep's data ──
  if (!ANTHROPIC_KEY) { try { await sendText(snapshot()) } catch { /* */ } await markDone(rid, 'handled'); return ok({ mode: 'snapshot_no_ai' }) }

  const qLines = quotes.map((q) => `${q.id} · ${q.quote_number || '(no ref)'} · ${(q.client_company || q.client_name || 'client')} · ${q.status}${q.total_amount ? ` · ${inr(q.total_amount)}` : ''}`).join('\n') || '(no quotes)'
  const fupLines = dueToday.length ? dueToday.map((f) => `• ${fupLabel(f)} (${dmy(f.follow_up_date)})`).join('\n') : 'none due today'
  const renLines = renewals.length ? renewals.map((q) => `• ${(q.client_company || q.client_name || 'client')} — ${dmy(q.campaign_end_date)}`).join('\n') : 'none in 30 days'

  const system = `You are the internal WhatsApp assistant for ${user.name || firstName}, a sales rep at Untitled Advertising (OOH/LED advertising, Vadodara). Answer THEIR question using ONLY the data below. NEVER invent a number, a client, a follow-up, or a quote — if the answer isn't in the data, say you don't have it here and suggest they open the app.

Keep it SHORT (this is WhatsApp): 2-5 short lines, plain text only. NO markdown — no **, no #, no *. Reply in the language they wrote (English / Hindi / Gujarati). 1-2 light emoji are fine.

${user.name || firstName}'s data (today ${istToday}):
- Calls logged today: ${callsDone} of a target of ${callsTarget}
- Follow-ups due today (${dueToday.length}):
${fupLines}
- Overdue follow-ups: ${overdue.length}
- Renewals due in the next 30 days (${renewals.length}):
${renLines}
- Business this month: ${inr(businessMonth)}
- Their recent quotes (id · ref · client · status · amount):
${qLines}

SENDING A QUOTE PDF: if they ask you to send / share a quote's PDF (e.g. "send Mahant's quote", "send me the pdf for X", "share ABC quote"), pick the ONE matching quote from the recent-quotes list above and add a FINAL line, on its own, EXACTLY in this form:
SENDPDF: <the quote id from the list>
Use the exact id. Match on the client name or the quote ref. If NO quote in the list matches what they asked, do NOT add the line — tell them you couldn't find that quote in their list. Only ever pick a quote from the list above (these are their own).`

  let reply = ''
  try {
    const ar = await fetch(ANTHROPIC, {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 400, system, messages: [{ role: 'user', content: msg.slice(0, 1000) }] }),
    })
    if (!ar.ok) throw new Error('claude_' + ar.status)
    const data = await ar.json()
    reply = (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim()
  } catch {
    // Claude down → don't leave the rep hanging; send their day snapshot.
    try { await sendText(snapshot()) } catch { /* */ }
    await markDone(rid, 'handled')
    return ok({ mode: 'snapshot_fallback' })
  }

  // ── resolve a SENDPDF marker (re-verified against the rep's OWN quotes) ──
  let pdfQuote = null
  const pm = reply.match(/(^|\n)\s*SENDPDF:\s*([0-9a-fA-F-]{36})\s*$/m)
  if (pm) {
    reply = (reply.slice(0, pm.index) + reply.slice(pm.index + pm[0].length)).trim()   // strip our control marker
    const wantId = pm[2].toLowerCase()
    pdfQuote = quotes.find((q) => String(q.id).toLowerCase() === wantId) || null   // MUST be one of the rep's own quotes
  }

  // send the text (if any left after stripping the marker)
  if (reply) {
    try { await sendText(reply) } catch (e) { await markDone(rid, 'error'); return nope('send_failed:' + String(e?.message || e), 502) }
  }

  // send the quote PDF as a document (best-effort — text already went)
  if (pdfQuote) {
    const safeRef = String(pdfQuote.quote_number || '').replace(/[^A-Za-z0-9_-]/g, '_')
    let signed = null
    if (safeRef) {
      try {
        const sr = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/quote-pdfs/${safeRef}.pdf`, {
          method: 'POST', headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ expiresIn: 600 }),
        })
        if (sr.ok) { const sj = await sr.json().catch(() => ({})); if (sj?.signedURL) signed = `${SUPABASE_URL}/storage/v1${sj.signedURL}` }
      } catch { /* no PDF → handled below */ }
    }
    if (signed) {
      try {
        await fetch(`${GRAPH}/${pnid}/messages`, {
          method: 'POST', headers: { Authorization: `Bearer ${WA_TOKEN}`, 'content-type': 'application/json' },
          body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'document', document: { link: signed, filename: `${pdfQuote.quote_number}.pdf` } }),
        })
      } catch { /* document send failed — the text reply already landed */ }
    } else {
      // the quote was never shared as a PDF → tell the rep how to make it
      try { await sendText(`That quote (${pdfQuote.quote_number || 'it'}) doesn't have a PDF yet. Open it in the app and tap Share once, then I can send it. 📄`) } catch { /* */ }
    }
  }

  if (!reply && !pdfQuote) { try { await sendText(snapshot()) } catch { /* */ } }   // empty answer → give the snapshot

  await markDone(rid, 'handled')
  return ok({ mode: 'ai', pdf: !!pdfQuote })
}
