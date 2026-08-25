// api/ops/sync.js — EDGE runtime (Operations module Phase 5, §230).
// ─────────────────────────────────────────────────────────────────────────
// Pulls live screen status from the owner's aiadflux CMS API and updates
// ops_screens.status / last_response_at by external_id, then recomputes each
// field tech's daily uptime (→ the Phase 4 pay signal). This is the adapter
// that flips the whole Operations module from MANUAL data to REAL data with
// zero rework — the module already reads ops_screens / ops_uptime_daily.
//
// ── INERT UNTIL WIRED. Does NOTHING until AIADFLUX_API_URL + AIADFLUX_API_KEY
//    are set in Vercel env (returns {skipped:'not configured'}). The aiadflux
//    API isn't finalised by the owner's CMS dev yet — this is the ready shell.
//    When the real API lands, VERIFY its response shape against mapScreen()
//    below and tweak the field names if they differ, then set the env +
//    schedule the cron (supabase_ops_p5_sync.sql). Do NOT assume it works
//    untested — test against a real aiadflux payload on a preview deploy first
//    (§35). It touches only ops_* tables (additive), never sales/frozen. ──
//
// WHY EDGE: the app is AT the Vercel Hobby 12-Node-fn cap (§219); Edge fns
// don't count.
//
// Auth: x-ops-secret == OPS_SYNC_SECRET (the pg_cron dispatch passes it).
//
// Env: SUPABASE_URL (||VITE_) + SUPABASE_SERVICE_ROLE_KEY + OPS_SYNC_SECRET
//      + AIADFLUX_API_URL + AIADFLUX_API_KEY.
// ─────────────────────────────────────────────────────────────────────────

export const config = { runtime: 'edge' }

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const OPS_SECRET   = process.env.OPS_SYNC_SECRET
const AIADFLUX_URL = process.env.AIADFLUX_API_URL
const AIADFLUX_KEY = process.env.AIADFLUX_API_KEY

const j = (o, s = 200) => new Response(JSON.stringify(o), {
  status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
})

const sbHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' }

// Map ONE aiadflux screen object → { external_id, status } (online|offline|unknown).
// The exact field names come from the aiadflux API (see the API-spec doc shared
// with the CMS dev). This is deliberately tolerant — adjust to the real shape
// when the API is live. Anything unrecognised → 'unknown' (never a false state).
function mapScreen(s) {
  const external_id = String(s.external_id || s.id || s.screen_id || s.uuid || '').trim()
  if (!external_id) return null
  let status = 'unknown'
  const raw = s.status ?? s.state ?? s.online ?? s.is_online
  if (raw === true || raw === 'online' || raw === 'up' || raw === 'active' || raw === 1) status = 'online'
  else if (raw === false || raw === 'offline' || raw === 'down' || raw === 'inactive' || raw === 0) status = 'offline'
  return { external_id, status }
}

// PATCH the given external_ids to one status (chunked; never inserts — new
// screens the API reports but that aren't in ops_screens yet are skipped,
// seed them first). Returns the count attempted.
async function patchStatus(ids, status, stampSeen) {
  const patch = { status, updated_at: new Date().toISOString() }
  if (stampSeen) patch.last_response_at = new Date().toISOString()
  let done = 0
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150)
    const inList = chunk.map(encodeURIComponent).join(',')
    const r = await fetch(`${SUPABASE_URL}/rest/v1/ops_screens?external_id=in.(${inList})`, {
      method: 'PATCH', headers: { ...sbHeaders, Prefer: 'return=minimal' }, body: JSON.stringify(patch),
    })
    if (r.ok) done += chunk.length
  }
  return done
}

export default async function handler(req) {
  if (req.method !== 'POST') return j({ error: 'method' }, 405)
  if (!SUPABASE_URL || !SERVICE_KEY) return j({ error: 'not_configured' }, 503)
  if (!OPS_SECRET || req.headers.get('x-ops-secret') !== OPS_SECRET) return j({ error: 'forbidden' }, 403)

  // inert until the aiadflux API is wired
  if (!AIADFLUX_URL || !AIADFLUX_KEY) return j({ ok: true, skipped: 'not configured' })

  // 1 · pull live statuses from the CMS
  let items
  try {
    const ac = new AbortController()
    const to = setTimeout(() => ac.abort(), 12000)
    const r = await fetch(AIADFLUX_URL, {
      headers: { Authorization: `Bearer ${AIADFLUX_KEY}`, accept: 'application/json' }, signal: ac.signal,
    })
    clearTimeout(to)
    if (!r.ok) return j({ ok: false, error: 'aiadflux_http', status: r.status }, 502)
    const body = await r.json()
    // tolerate { screens: [...] } or a bare [...]
    items = Array.isArray(body) ? body : (Array.isArray(body?.screens) ? body.screens : (Array.isArray(body?.data) ? body.data : null))
    if (!Array.isArray(items)) return j({ ok: false, error: 'aiadflux_shape' }, 502)
  } catch (e) { return j({ ok: false, error: 'aiadflux_unreachable', detail: String(e?.message || e).slice(0, 120) }, 502) }

  // 2 · map + group by target status
  const online = [], offline = []
  for (const s of items) {
    const m = mapScreen(s)
    if (!m) continue
    if (m.status === 'online') online.push(m.external_id)
    else if (m.status === 'offline') offline.push(m.external_id)
    // 'unknown' → leave as-is (don't overwrite a known status with unknown)
  }

  // 3 · write statuses (PATCH only — never inserts)
  let updated = 0
  try {
    if (online.length)  updated += await patchStatus(online, 'online', true)
    if (offline.length) updated += await patchStatus(offline, 'offline', false)
  } catch (e) { return j({ ok: false, error: 'patch_failed', detail: String(e?.message || e).slice(0, 120) }, 502) }

  // 4 · recompute today's uptime per tech (the Phase 4 pay signal). Best-effort
  //     — a missing Phase 4 fn just means uptime isn't recomputed yet.
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/ops_recompute_uptime_today`, {
      method: 'POST', headers: sbHeaders, body: JSON.stringify({}),
    })
  } catch { /* Phase 4 not run yet — statuses still synced */ }

  return j({ ok: true, received: items.length, online: online.length, offline: offline.length, updated })
}

// ── Phase 5.1 hooks (documented, not built — add once the API flow is proven):
//    • Auto-create a fault ticket for a screen that just went offline (compare
//      the pre-PATCH status; dedup on an existing open fault ticket for the
//      screen; assign to the depot's owning tech). That IS the downtime alert.
//    • A WhatsApp downtime alert (approved template) to the owning tech.
//    Both touch only ops_* + the existing WhatsApp send infra; keep them opt-in
//    behind an env flag so a noisy CMS can't spam the field queue.
