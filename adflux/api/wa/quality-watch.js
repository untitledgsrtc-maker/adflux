// api/wa/quality-watch.js — EDGE runtime.
// WhatsApp QUALITY-RATING WATCHER + auto-pause — supabase_wa_quality_watch.sql (§227).
// ─────────────────────────────────────────────────────────────────────────
// Fired every 4h by the wa_quality_watch_dispatch pg_cron job. For each WhatsApp
// number, reads Meta's quality_rating (GET /{phone_number_id}?fields=quality_rating,
// name_status). On RED — the step before a template/all-message block → account lock
// (§133/§148) — it AUTO-PAUSES the risky OUTBOUND (ai_cadence_enabled, ai_nudge_enabled,
// ai_followup_enabled, ai_welcome_image_url) so the block/report signal stops climbing.
// It does NOT touch ai_enabled: the reactive IN-WINDOW replies (a customer messaged us
// <24h ago) are the safe, policy-clean path and stay live. YELLOW → logged as an alert,
// no auto-pause (it usually recovers). Never auto-RE-enables — the owner turns things back
// on after a recovery. Every check is logged to wa_quality_log.
//
// WHY EDGE: §219 Hobby 12-Node-fn cap. SECURITY: x-ai-secret == AI_REPLY_SECRET, fail-closed.
// Reuses the §246 secret + CAMPAIGN_WA_TOKEN — NO new env.
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

export default async function handler(req) {
  if (req.method !== 'POST') return nope('method_not_allowed', 405)
  if (!SUPABASE_URL || !SERVICE_KEY || !WA_TOKEN || !AI_SECRET) return nope('not_configured', 503)
  if (String(req.headers.get('x-ai-secret') || '') !== AI_SECRET) return nope('forbidden', 403)

  const accts = await sbRows(`whatsapp_accounts?select=id,phone_number_id,display_number&phone_number_id=not.is.null`)
  if (!Array.isArray(accts) || accts.length === 0) return ok({ checked: 0 })

  let paused = 0, checked = 0
  const results = []

  for (const a of accts) {
    const pnid = String(a.phone_number_id || '')
    if (!/^\d+$/.test(pnid)) continue
    checked++
    let quality = 'UNKNOWN', nameStatus = null, action = 'ok', note = ''
    try {
      const gr = await fetch(`${GRAPH}/${pnid}?fields=quality_rating,name_status`, {
        headers: { Authorization: `Bearer ${WA_TOKEN}` },
      })
      const gj = await gr.json().catch(() => ({}))
      if (!gr.ok) { action = 'error'; note = String(gj?.error?.message || ('graph_' + gr.status)).slice(0, 200) }
      else {
        quality    = String(gj?.quality_rating || 'UNKNOWN').toUpperCase()
        nameStatus = gj?.name_status ? String(gj.name_status) : null
        if (quality === 'RED') {
          // AUTO-PAUSE the risky outbound. Idempotent (pausing an already-off flag is a no-op).
          // ai_enabled (reactive in-window replies) is deliberately LEFT ON.
          // Pause the PRE-EXISTING flags first — a single missing/renamed column (e.g. the NEW
          // ai_cadence_enabled, absent until supabase_wa_cadence.sql runs) must NOT 400 the whole
          // write and silently no-op the one safety action. action reflects the ACTUAL result (§227).
          const up = await sb(`whatsapp_accounts?id=eq.${a.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ ai_nudge_enabled: false, ai_followup_enabled: false, ai_welcome_image_url: null }),
          })
          if (up.ok) { action = 'auto_paused'; paused++ }
          else { action = 'pause_failed'; note = 'pause_write_failed' }
          // the cadence flag is the NEW column — patch it SEPARATELY so its absence can't nuke the above.
          try { await sb(`whatsapp_accounts?id=eq.${a.id}`, { method: 'PATCH', body: JSON.stringify({ ai_cadence_enabled: false }) }) } catch { /* column may not exist yet */ }
        } else if (quality === 'YELLOW') {
          action = 'alert'
        }
      }
    } catch (e) { action = 'error'; note = String(e?.message || e).slice(0, 200) }

    await sb('wa_quality_log', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ phone_number_id: pnid, display_number: a.display_number || null, quality_rating: quality, name_status: nameStatus, action, note: note || null }),
    }).catch(() => {})
    results.push({ number: a.display_number, quality, action })
  }

  return ok({ checked, paused, results })
}
