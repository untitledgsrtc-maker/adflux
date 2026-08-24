// api/wa/followup-cadence.js — EDGE runtime.
// CLOSED-WINDOW FOLLOW-UP CADENCE — supabase_wa_cadence.sql (§227).
// ─────────────────────────────────────────────────────────────────────────
// Fired once a day (10:00 IST) by the followup_cadence_dispatch pg_cron job. For
// each lead DUE (followup_cadence_candidates does the qualifying: window closed,
// engaged, not Lost/Won/opted-out, ≤1 template/day, at the day-2/4/7/9/15/25/30 or
// nurture slot), sends the matching APPROVED Utility template (reply-first Gujarati,
// {{1}}=name) from the number they chatted on. The moment they reply, the reactive
// AI closer (§115) takes over — this only RE-OPENS the 24h window.
//
// ⚠ SPAM (98982 flagged twice, §133/§148): everything conservative. The SQL gates
// on the OFF flag + opt-out + Lost/Won + one-template-per-day (via followup_last_at
// AND a template-message-log guard). This endpoint re-gates quiet hours + Sunday.
// SEND-then-MARK (a lost mark can't permanently skip a slot on a pending template;
// the message-log guard makes a re-send at most one/day). Every send is logged so
// block/report rate stays measurable, AND the quality-watch cron auto-pauses this
// whole engine (ai_cadence_enabled=false) if Meta's rating dips.
//
// WHY EDGE: §219 Hobby 12-Node-fn cap. SECURITY: x-ai-secret == AI_REPLY_SECRET,
// fail-closed. Reuses the §246/§210 secret — NO new env. Recipient + template are
// 100% server-derived (the candidate RPC returns them; the request body is ignored).
// Env: SUPABASE_URL (||VITE_) + SUPABASE_SERVICE_ROLE_KEY + CAMPAIGN_WA_TOKEN + AI_REPLY_SECRET.
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

  const due = await sbRows(`rpc/followup_cadence_candidates`, { method: 'POST', body: '{}' })
  if (!Array.isArray(due) || due.length === 0) return ok({ due: 0, sent: 0 })

  const nowIso = new Date().toISOString()
  let sent = 0, failed = 0, logFailed = 0, markFailed = 0

  for (const c of due) {
    const to   = String(c.customer_wa_id || '').replace(/\D/g, '')
    const pnid = String(c.phone_number_id || '')
    const tplName = String(c.meta_template_name || '')
    const stage = parseInt(c.new_stage, 10)
    if (to.length < 10 || !/^\d+$/.test(pnid) || !tplName || !Number.isFinite(stage)) { failed++; continue }
    const first = cleanFirstName(c.lead_name)

    try {
      const gr = await fetch(`${GRAPH}/${pnid}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${WA_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp', to, type: 'template',
          template: {
            name: tplName,
            language: { code: c.language || 'gu' },
            components: [{ type: 'body', parameters: [{ type: 'text', text: first }] }],
          },
        }),
      })
      const gj = await gr.json().catch(() => ({}))
      // Meta rejected (template not approved yet / frequency cap 131049 / bad number / policy) →
      // do NOT mark → the slot is retried next day (once the template is live / the cap resets).
      if (!gr.ok) { failed++; continue }
      const wamid = gj?.messages?.[0]?.id || null

      // Log the REAL substituted text (§125.1) so a rep opening the thread sees what was sent.
      const logBody = c.preview_body ? String(c.preview_body).split('{{1}}').join(first)
                                     : `📋 Follow-up sent (${tplName})`
      // send-then-mark. TWO independent throttle records back the ≤1/day guard: (a) this
      // whatsapp_messages template row (the candidate's 20h NOT EXISTS reads it) AND (b) the
      // stage/last_at mark. A future re-send needs BOTH missing → at most one extra send/day.
      // ai_paused is left UNTOUCHED so the reactive AI answers a reply.
      sent++
      const logRes = await sb('whatsapp_messages', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          conversation_id: c.conversation_id, direction: 'out',
          type: 'template', body: logBody, wamid, at: nowIso,
        }),
      })
      if (!logRes.ok) logFailed++
      const markRes = await sb('rpc/followup_cadence_mark', {
        method: 'POST',
        body: JSON.stringify({ p_conversation_id: c.conversation_id, p_new_stage: stage }),
      })
      if (!markRes.ok) markFailed++
    } catch { failed++ }
  }

  return ok({ due: due.length, sent, failed, logFailed, markFailed })
}
