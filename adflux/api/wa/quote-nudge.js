// api/wa/quote-nudge.js — EDGE runtime.
// SAME-DAY OPEN-WINDOW QUOTE NUDGE — supabase_quote_nudge.sql.
// ─────────────────────────────────────────────────────────────────────────
// Fired hourly (:07) by the quote_nudge_dispatch pg_cron job. For each lead DUE
// (quote_nudge_candidates does the qualifying: the AI auto-sent a quote 2–4h ago,
// customer silent since, 24h window STILL OPEN, not rep-paused, not opted-out),
// sends ONE gentle FREE-TEXT nudge (plain text — the window is open, so no template
// and no ₹0.8 marketing cost). The moment they reply, the reactive AI (§246) closes.
//
// WHY it's spam-safe on the twice-flagged number (§133/§148): free text INSIDE the
// customer's own 24h window (they messaged us <24h ago). Not business-initiated, not
// a paid template — sidesteps the §213 reclassification entirely. One nudge, ever.
//
// WHY EDGE (not Node): §219 Hobby 12-Node-fn cap. SECURITY: x-ai-secret ==
// AI_REPLY_SECRET, fail-closed. Reuses the §246 secret — NO new env. Recipient +
// number + text are 100% server-derived.
// Env: SUPABASE_URL (||VITE_) + SUPABASE_SERVICE_ROLE_KEY + CAMPAIGN_WA_TOKEN + AI_REPLY_SECRET.
// ─────────────────────────────────────────────────────────────────────────

export const config = { runtime: 'edge' }

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const WA_TOKEN     = process.env.CAMPAIGN_WA_TOKEN
const AI_SECRET    = process.env.AI_REPLY_SECRET
const GRAPH        = 'https://graph.facebook.com/v21.0'

const ok   = (obj = {}) => new Response(JSON.stringify({ ok: true, ...obj }),  { status: 200, headers: { 'content-type': 'application/json' } })
const nope = (reason, status = 200) => new Response(JSON.stringify({ ok: false, reason }), { status, headers: { 'content-type': 'application/json' } })

const sb = (path, init = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  ...init,
  headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json', ...(init.headers || {}) },
})
const sbRows = async (path, init) => { try { return (await (await sb(path, init)).json()) || [] } catch { return [] } }

// Junk-name guard (§252): auto-created leads carry '.', a phone number, or 'WhatsApp
// lead'. Fall back to no name (a clean greeting) rather than a junk {{name}}.
function cleanFirstName(raw) {
  const s = String(raw || '').trim()
  const first = s.split(/\s+/)[0] || ''
  if (!first || /whatsapp lead/i.test(s)) return ''
  if (!/[A-Za-zऀ-ॿ઀-૿]/.test(first)) return ''   // must hold a real letter (Latin/Devanagari/Gujarati)
  return first
}

export default async function handler(req) {
  if (req.method !== 'POST') return nope('method_not_allowed', 405)
  if (!SUPABASE_URL || !SERVICE_KEY || !WA_TOKEN || !AI_SECRET) return nope('not_configured', 503)
  if (String(req.headers.get('x-ai-secret') || '') !== AI_SECRET) return nope('forbidden', 403)

  // Belt-and-suspenders over the hourly cron: business hours 09:30–19:30 IST + skip Sunday.
  const istNow = new Date(Date.now() + 5.5 * 3600 * 1000)
  if (istNow.getUTCDay() === 0) return ok({ skipped: 'sunday' })
  const istMin = istNow.getUTCHours() * 60 + istNow.getUTCMinutes()
  if (istMin < 9 * 60 + 30 || istMin >= 19 * 60 + 30) return ok({ skipped: 'off_hours', istMin })

  const due = await sbRows(`rpc/quote_nudge_candidates`, { method: 'POST', body: '{}' })
  if (!Array.isArray(due) || due.length === 0) return ok({ due: 0, sent: 0 })

  const nowIso = new Date().toISOString()
  let sent = 0, failed = 0, logFailed = 0, markFailed = 0

  for (const c of due) {
    const to   = String(c.customer_wa_id || '').replace(/\D/g, '')
    const pnid = String(c.phone_number_id || '')
    if (to.length < 10 || !/^\d+$/.test(pnid)) { failed++; continue }
    const first = cleanFirstName(c.lead_name)
    const name = first ? ' ' + first : ''
    // §226 — up to 2 same-day FREE-TEXT touches (window OPEN). Reply-first, NO price/pitch.
    // 4 DISTINCT messages by touch (1|2) × has_quote so nothing repeats. *bold* = WhatsApp bold.
    let body
    if (c.has_quote) {
      body = Number(c.touch) >= 2
        ? `નમસ્તે${name} 🙏 તમારા GSRTC LED *ભાવપત્રક* વિશે કોઈ પ્રશ્ન હોય તો જણાવો — હું અત્યારે ઓનલાઈન છું. કઈ સિટી કે કેટલા મહિના, એ પસંદ કરવામાં પણ મદદ કરું? 👍`
        : `નમસ્તે${name} 👋 તમને GSRTC LED સ્ક્રીન નું *ભાવપત્રક* મળ્યું? કોઈ પ્રશ્ન હોય તો આ મેસેજ પર *જવાબ* આપો — અમે મદદ કરીશું.`
    } else {
      body = Number(c.touch) >= 2
        ? `નમસ્તે${name} 🙏 GSRTC LED સ્ક્રીન નું *ભાવપત્રક* જોઈતું હોય તો — કઈ *સિટી* + કેટલા *મહિના*, એટલું જણાવો, હું તરત મોકલી આપું 👍`
        : `નમસ્તે${name} 👋 તમે GSRTC બસ સ્ટેશન LED સ્ક્રીન વિશે પૂછ્યું હતું — હજુ કોઈ પ્રશ્ન હોય તો આ મેસેજ પર *જવાબ* આપો, હું મદદ કરીશ. 🙂`
    }

    try {
      // MARK-then-SEND (review P1) — CLAIM the one-nudge throttle BEFORE sending. The
      // candidates RPC dedups only on quote_nudge_at, and a free-text nudge has no
      // distinguishing marker for a message-based guard, so a lost mark-after-send
      // would let the next hourly cron RE-SEND a duplicate to the twice-flagged number.
      // Claiming first makes a duplicate impossible: the worst case is a rare MISSED
      // nudge (a send that fails after the claim) — the right trade on a spam-flagged
      // number (miss > duplicate). quote_nudge_mark is `WHERE quote_nudge_at IS NULL`
      // and the cron is single, so the claim happens exactly once.
      const markRes = await sb('rpc/quote_nudge_mark', {
        method: 'POST', body: JSON.stringify({ p_conversation_id: c.conversation_id }),
      })
      if (!markRes.ok) { markFailed++; continue }   // couldn't claim → skip; next cron retries (nothing sent, no dup)

      const gr = await fetch(`${GRAPH}/${pnid}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${WA_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body, preview_url: false } }),
      })
      const gj = await gr.json().catch(() => ({}))
      if (!gr.ok) { failed++; continue }   // claimed but Meta rejected (window-close race / bad number) → MISSED, never retried → never a dup
      const wamid = gj?.messages?.[0]?.id || null

      // Log for inbox visibility only (best-effort — the throttle is already claimed, so
      // a lost log can NOT cause a re-send). ai_paused left UNTOUCHED so the reactive AI
      // answers the customer's reply.
      sent++
      const logRes = await sb('whatsapp_messages', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ conversation_id: c.conversation_id, direction: 'out', type: 'text', body, wamid, at: nowIso }),
      })
      if (!logRes.ok) logFailed++
    } catch { failed++ }
  }

  return ok({ due: due.length, sent, failed, logFailed, markFailed })
}
