// api/meta/capi-send.js — EDGE runtime.
// Phase 403: send "Won" for Meta INSTANT-FORM leads back to Meta (Conversions API for CRM) so ads learn which
// leads became customers. Fired every 10 min by capi_dispatch() (pg_cron). Drains capi_outbox rows that the
// leads-stage trigger queued. Only leads that arrived via api/meta/leadgen.js carry a Meta lead id, so only those are sent.
// Gated by x-ta-secret (same secret as the other pg_cron-called endpoints), fail-closed.
// Env: SUPABASE_URL (||VITE_), SUPABASE_SERVICE_ROLE_KEY, META_CAPI_TOKEN, TEAM_ASSISTANT_SECRET,
//      optional META_CAPI_DATASET_ID (default 1841233447007580), META_CAPI_EVENT_NAME (default Purchase).

export const config = { runtime: 'edge' }

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const CAPI_TOKEN   = process.env.META_CAPI_TOKEN
const TA_SECRET    = process.env.TEAM_ASSISTANT_SECRET
const DATASET      = process.env.META_CAPI_DATASET_ID || '1841233447007580'
const EVENT_NAME   = process.env.META_CAPI_EVENT_NAME || 'Purchase'
const GRAPH        = 'https://graph.facebook.com/v21.0'
const MAX_TRIES    = 5

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
const sb = (path, init = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  ...init,
  headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json', ...(init.headers || {}) },
})

export default async function handler(req) {
  if (!SUPABASE_URL || !SERVICE_KEY || !CAPI_TOKEN || !TA_SECRET) return json({ ok: false, reason: 'not_configured' }, 503)
  if (String(req.headers.get('x-ta-secret') || '') !== TA_SECRET) return json({ ok: false, reason: 'forbidden' }, 403)

  const r = await sb(`capi_outbox?status=eq.pending&tries=lt.${MAX_TRIES}&order=created_at.asc&limit=25&select=id,lead_id,event_time,value,tries`)
  if (!r.ok) return json({ ok: false, reason: 'outbox_read_failed' })
  const rows = await r.json()
  let sent = 0, failed = 0, skipped = 0

  for (const row of rows) {
    const patch = (b) => sb(`capi_outbox?id=eq.${row.id}`, { method: 'PATCH', body: JSON.stringify(b) })
    try {
      const il = await (await sb(`inbound_leads?provider=eq.meta_lead&lead_id=eq.${row.lead_id}&select=external_event_id&limit=1`)).json()
      const metaLeadId = il?.[0]?.external_event_id
      if (!metaLeadId) { await patch({ status: 'skipped', error: 'no meta lead id' }); skipped++; continue }

      const event = {
        event_name: EVENT_NAME,
        event_time: Math.floor(new Date(row.event_time).getTime() / 1000),
        action_source: 'system_generated',
        event_id: `won-${row.lead_id}`,                      // Meta dedupes on this
        user_data: { lead_id: Number(metaLeadId) },
        custom_data: { event_source: 'crm', lead_event_source: 'Untitled OS', ...(row.value > 0 ? { value: Number(row.value), currency: 'INR' } : {}) },
      }
      const g = await fetch(`${GRAPH}/${DATASET}/events?access_token=${encodeURIComponent(CAPI_TOKEN)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: [event] }),
      })
      const body = await g.text()
      if (g.ok) { await patch({ status: 'sent', sent_at: new Date().toISOString(), error: null }); sent++ }
      else { await patch({ tries: row.tries + 1, error: body.slice(0, 500) }); failed++ }
    } catch (e) {
      await patch({ tries: row.tries + 1, error: String(e?.message || e).slice(0, 500) }); failed++
    }
  }
  return json({ ok: true, queued: rows.length, sent, failed, skipped })
}
