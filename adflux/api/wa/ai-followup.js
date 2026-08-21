// api/wa/ai-followup.js — EDGE runtime.
// AI QUOTE FOLLOW-UP — auto-chase a silent AI-quote lead (§209/§210 → §"closer").
// SQL: supabase_ai_quote_followup.sql
// ─────────────────────────────────────────────────────────────────────────
// Fired once a day (11:00 IST) by the ai_quote_followup_dispatch pg_cron job.
// For each lead DUE (ai_quote_followup_candidates does the qualifying: got an AI
// quote, no reply since, not opted-out, <2 touches, day-2 / day-6 timing), sends
// one APPROVED Utility template (reply-first Gujarati, NO price/pitch) from the
// number they chatted on. The moment they reply, the reactive AI closer (§115)
// takes over. This only RE-OPENS the 24h window.
//
// ⚠ SPAM (98982 flagged twice — §133/§148). Everything conservative: the SQL
// gates on the OFF flag + opt-out + max-2 + timing; this endpoint re-gates quiet
// hours + Sunday. Every send is logged so block/report rate is measurable.
//
// WHY EDGE (not Node): §219 Hobby 12-Node-fn cap — a Node fn breaks every deploy.
// SECURITY: x-ai-secret == AI_REPLY_SECRET, fail-closed. Reuses the §246/§210
// secret — NO new env. Recipient + template are 100% server-derived.
// Env: SUPABASE_URL (||VITE_) + SUPABASE_SERVICE_ROLE_KEY + CAMPAIGN_WA_TOKEN
//   + AI_REPLY_SECRET.
// ─────────────────────────────────────────────────────────────────────────

export const config = { runtime: 'edge' }

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const WA_TOKEN     = process.env.CAMPAIGN_WA_TOKEN
const AI_SECRET    = process.env.AI_REPLY_SECRET
const GRAPH        = 'https://graph.facebook.com/v21.0'

const ok   = (obj = {}) => new Response(JSON.stringify({ ok: true, ...obj }), { status: 200, headers: { 'content-type': 'application/json' } })
const nope = (reason, status = 200) => new Response(JSON.stringify({ ok: false, reason }), { status, headers: { 'content-type': 'application/json' } })

const sb = (path, init = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  ...init,
  headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json', ...(init.headers || {}) },
})
const sbRows = async (path, init) => { try { return (await (await sb(path, init)).json()) || [] } catch { return [] } }

// Junk-name guard (§252): a customer-visible {{1}}. Auto-created leads carry '.',
// a phone number, or 'WhatsApp lead'. Fall back to a warm neutral gu word.
function cleanFirstName(raw) {
  const s = String(raw || '').trim()
  const first = s.split(/\s+/)[0] || ''
  if (!first || /whatsapp lead/i.test(s)) return 'મિત્ર'          // "friend"
  // must contain a real letter (Latin / Devanagari / Gujarati), not just digits/dots
  if (!/[A-Za-zऀ-ॿ઀-૿]/.test(first)) return 'મિત્ર'
  return first
}

export default async function handler(req) {
  if (req.method !== 'POST') return nope('method_not_allowed', 405)
  if (!SUPABASE_URL || !SERVICE_KEY || !WA_TOKEN || !AI_SECRET) return nope('not_configured', 503)
  if (String(req.headers.get('x-ai-secret') || '') !== AI_SECRET) return nope('forbidden', 403)

  // Quiet hours 09:30–19:30 IST + skip Sunday (belt-and-suspenders over the daily cron).
  const istNow = new Date(Date.now() + 5.5 * 3600 * 1000)
  if (istNow.getUTCDay() === 0) return ok({ skipped: 'sunday' })
  const istMin = istNow.getUTCHours() * 60 + istNow.getUTCMinutes()
  if (istMin < 9 * 60 + 30 || istMin >= 19 * 60 + 30) return ok({ skipped: 'off_hours', istMin })

  // The Utility template row (§125.1 preview_body lockstep). One fetch.
  const tpl = (await sbRows(`wa_outcome_templates?outcome=eq.quote_followup&is_active=eq.true&select=meta_template_name,language,preview_body&limit=1`))?.[0]
  if (!tpl?.meta_template_name) return nope('no_template')   // template not seeded yet → inert

  const due = await sbRows(`rpc/ai_quote_followup_candidates`, { method: 'POST', body: '{}' })
  if (!Array.isArray(due) || due.length === 0) return ok({ due: 0, sent: 0 })

  const nowIso = new Date().toISOString()
  let sent = 0, failed = 0, logFailed = 0, markFailed = 0

  for (const c of due) {
    const to   = String(c.customer_wa_id || '').replace(/\D/g, '')
    const pnid = String(c.phone_number_id || '')
    if (to.length < 10 || !/^\d+$/.test(pnid)) { failed++; continue }
    const first = cleanFirstName(c.lead_name)

    try {
      const gr = await fetch(`${GRAPH}/${pnid}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${WA_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp', to, type: 'template',
          template: {
            name: tpl.meta_template_name,
            language: { code: tpl.language || 'gu' },
            components: [{ type: 'body', parameters: [{ type: 'text', text: first }] }],
          },
        }),
      })
      const gj = await gr.json().catch(() => ({}))
      if (!gr.ok) { failed++; continue }   // Meta rejected (bad number / policy) → count, move on
      const wamid = gj?.messages?.[0]?.id || null

      // Log the REAL text (§125.1) so a rep opening the thread sees what was sent.
      const logBody = tpl.preview_body ? String(tpl.preview_body).split('{{1}}').join(first)
                                       : `[template] ${tpl.meta_template_name}`
      // The message went out. TWO INDEPENDENT throttle records (P1) — a future
      // re-send needs BOTH to be missing: (a) this whatsapp_messages row (the
      // candidate SQL's 3-day NOT EXISTS guard reads it) AND (b) the mark table
      // (sent_count). sb() does NOT throw on a 4xx, so inspect .ok and surface a
      // failed write rather than counting a phantom throttle. ai_paused is left
      // UNTOUCHED so the reactive AI answers a reply on an AI thread and never
      // hijacks a rep-paused thread.
      sent++
      const logRes = await sb('whatsapp_messages', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          conversation_id: c.conversation_id, direction: 'out',
          type: 'template', body: logBody, wamid, at: nowIso,
        }),
      })
      if (!logRes.ok) logFailed++
      const markRes = await sb('rpc/ai_quote_followup_mark', {
        method: 'POST',
        body: JSON.stringify({ p_lead_id: c.lead_id, p_conversation_id: c.conversation_id }),
      })
      if (!markRes.ok) markFailed++
    } catch { failed++ }
  }

  // logFailed>0 AND markFailed>0 on the same lead is the only re-send window;
  // surfaced here so a run that ever shows both non-zero gets looked at.
  return ok({ due: due.length, sent, failed, logFailed, markFailed })
}
