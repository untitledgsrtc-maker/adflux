// api/ops/sync.js — EDGE runtime (Operations module §230-§232, Phase 5 → REAL data).
// ─────────────────────────────────────────────────────────────────────────
// Mirrors the owner's aiadflux CMS (read-only API, https://api.adfluxcms.com/api/v1)
// into ops_depots + ops_screens:
//   1 · GET /groups  → the ~21 bus-stand depots. Stamp aiadflux group id onto the
//       matching ops_depot (external_group_id; fuzzy name match on first run,
//       exact-by-id after). Creates a depot if none matches (never orphans screens).
//   2 · GET /screens → every screen, paginated (per_page=200). UPSERT ops_screens
//       by external_id with live status/name, linked to its depot. Creates NEW
//       screens (the old stub only PATCHed existing ones).
//   3 · recompute today's uptime (the Phase-4 pay signal).
// This flips the Operations module from MANUAL seed data to REAL CMS data with no
// front-end rework — the module already reads ops_screens / ops_uptime_daily.
//
// ── INERT UNTIL WIRED: does NOTHING until AIADFLUX_API_KEY is set in Vercel env
//    (returns {skipped:'not configured'}). Read-only against aiadflux; writes ONLY
//    ops_* tables (additive) — never sales/frozen. §45-safe. ──
//
// DEBUG (no writes): GET ...?debug=1&secret=<OPS_SYNC_SECRET> echoes the RAW first
//    /groups + /screens object so the exact CMS field names can be confirmed. The
//    map below is tolerant (id/name/status/group per the API guide + webhook sample);
//    if a field name differs, adjust mapScreen() and redeploy.
//
// WHY EDGE: the app is AT the Vercel Hobby 12-Node-fn cap (§219); Edge doesn't count.
// Auth: x-ops-secret == OPS_SYNC_SECRET (pg_cron dispatch) OR ?secret= (owner/debug).
// Env: SUPABASE_URL(||VITE_) + SUPABASE_SERVICE_ROLE_KEY + OPS_SYNC_SECRET
//      + AIADFLUX_API_KEY   [+ AIADFLUX_API_URL — defaults to the CMS base].
// ─────────────────────────────────────────────────────────────────────────

export const config = { runtime: 'edge' }

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const OPS_SECRET   = process.env.OPS_SYNC_SECRET
const AIADFLUX_KEY = process.env.AIADFLUX_API_KEY
const AIADFLUX_URL = (process.env.AIADFLUX_API_URL || 'https://api.adfluxcms.com/api/v1').replace(/\/+$/, '')

const j = (o, s = 200) => new Response(JSON.stringify(o), {
  status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
})
const sbH  = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' }
// Bearer only (the API guide's primary; some servers 500 on a dual auth header).
const cmsH = { Authorization: `Bearer ${AIADFLUX_KEY}`, accept: 'application/json' }

// tolerant CMS fetch with a 12s timeout; returns the parsed body (throws on !ok)
async function cms(path) {
  const ac = new AbortController()
  const to = setTimeout(() => ac.abort(), 12000)
  try {
    const r = await fetch(`${AIADFLUX_URL}${path}`, { headers: cmsH, signal: ac.signal })
    if (!r.ok) throw new Error(`aiadflux ${path} HTTP ${r.status}`)
    return await r.json()
  } finally { clearTimeout(to) }
}
// tolerate {data:[...]} / {screens:[...]} / {groups:[...]} / {items:[...]} / bare [...]
const asList = (b) => Array.isArray(b) ? b
  : (Array.isArray(b?.data) ? b.data
  : (Array.isArray(b?.screens) ? b.screens
  : (Array.isArray(b?.groups) ? b.groups
  : (Array.isArray(b?.items) ? b.items : []))))

// normalize a depot/group name for fuzzy first-run matching
// "Godhra Bus Stand" and "Godhra GSRTC Bus Stand" both -> "godhra"
const norm = (s) => String(s || '').toLowerCase()
  .replace(/gsrtc|gidc|bus\s*stand|bus\s*stop|stand|depot|station/g, '').replace(/[^a-z0-9]/g, '')

// aiadflux screen -> mapped fields | null. Real shape confirmed 2026-08-27: the
// screen EMBEDS its depot as `Group` {id,name} + `group_id` (int) + `location`
// (depot name string), and its GPS in `location_settings` {latitude,longitude}.
// So the whole sync sources from /screens — /groups (a broken CMS endpoint) unused.
function mapScreen(s) {
  const external_id = String(s?.id ?? s?.external_id ?? s?.screen_id ?? s?.uuid ?? '').trim()
  if (!external_id) return null
  let status = 'unknown'
  const raw = s?.status ?? s?.state ?? s?.online ?? s?.is_online
  if (raw === true || raw === 'online' || raw === 'up' || raw === 'active' || raw === 1) status = 'online'
  else if (raw === false || raw === 'offline' || raw === 'down' || raw === 'inactive' || raw === 0) status = 'offline'
  const G = s?.Group || s?.group || null
  const gObj = G && typeof G === 'object' && !Array.isArray(G)
  const ls = (s?.location_settings && typeof s.location_settings === 'object') ? s.location_settings : {}
  const num = (v) => { const n = Number(v); return Number.isFinite(n) && n !== 0 ? n : null }
  // camera (AI-audience) status: cameras[].status Active/Inactive is authoritative;
  // fall back to the player_settings.camera_status enabled flag; null = no camera.
  const cams = Array.isArray(s?.cameras) ? s.cameras : []
  const hasCam = (s?.License?.has_camera === true) || cams.length > 0
  let camera_active = null
  if (hasCam && cams.length) camera_active = cams.some(c => String(c?.status || '').toLowerCase() === 'active')
  else if (hasCam) camera_active = (s?.player_settings?.camera_status === true)
  return {
    external_id,
    name: String(s?.name ?? s?.screen_name ?? s?.title ?? external_id).trim(),
    status,
    group_id: String(s?.group_id ?? (gObj ? (G.id ?? G.group_id ?? '') : '') ?? '').trim(),
    group_name: String((gObj ? (G.name ?? G.description ?? '') : (typeof G === 'string' ? G : '')) || s?.location || s?.group_name || '').trim(),
    lat: num(ls.latitude),
    lng: num(ls.longitude),
    orientation: s?.orientation ? String(s.orientation).toUpperCase() : null,
    last_response: s?.last_response || s?.last_response_at || null,
    camera_active,
  }
}

// ── Supabase REST helpers (service role) ──
async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: sbH })
  return r.ok ? r.json() : []
}
async function sbUpsert(table, rows, onConflict) {
  return (await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: 'POST',
    headers: { ...sbH, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  })).ok
}
async function sbInsertReturn(table, row) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST', headers: { ...sbH, Prefer: 'return=representation' }, body: JSON.stringify(row),
  })
  if (!r.ok) return null
  const a = await r.json()
  return Array.isArray(a) ? a[0] : a
}
async function sbPatch(table, filter, patch) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: 'PATCH', headers: { ...sbH, Prefer: 'return=minimal' }, body: JSON.stringify(patch),
  })
}

export default async function handler(req) {
  if (!SUPABASE_URL || !SERVICE_KEY) return j({ error: 'not_configured' }, 503)
  const url = new URL(req.url)
  const secret = req.headers.get('x-ops-secret') || url.searchParams.get('secret')
  if (!OPS_SECRET || secret !== OPS_SECRET) return j({ error: 'forbidden' }, 403)
  if (!AIADFLUX_KEY) return j({ ok: true, skipped: 'not configured' })

  // ── DEBUG: probe each CMS endpoint INDEPENDENTLY (no writes) — reveals the
  //    field shape AND which endpoints work vs error, so a broken /groups doesn't
  //    hide a working /screens. ──
  if (url.searchParams.get('debug')) {
    async function probe(path) {
      try {
        const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 12000)
        const r = await fetch(`${AIADFLUX_URL}${path}`, { headers: cmsH, signal: ac.signal })
        clearTimeout(to)
        const text = await r.text()
        let body; try { body = JSON.parse(text) } catch { body = text.slice(0, 400) }
        const list = Array.isArray(body) ? body : asList(body)
        return {
          status: r.status, ok: r.ok,
          count: list.length,
          sample: list[0] ?? (r.ok ? body : String(typeof body === 'object' ? JSON.stringify(body) : body).slice(0, 400)),
          wrapper_keys: body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body) : 'array',
        }
      } catch (e) { return { error: String(e?.message || e).slice(0, 200) } }
    }
    const [groups, screens, health] = await Promise.all([
      probe('/groups'), probe('/screens?per_page=2'), probe('/health/summary'),
    ])
    return j({ ok: true, debug: true, base: AIADFLUX_URL, auth: 'Bearer', groups, screens, health })
  }

  // POST (cron dispatch) or a secret-gated GET ?run=1 (owner fires it from a browser).
  if (req.method !== 'POST' && !url.searchParams.get('run')) {
    return j({ error: 'method — POST (or GET ?run=1) to sync, or GET ?debug=1 to inspect' }, 405)
  }

  const nowIso = new Date().toISOString()

  // 1 · pull ALL screens (paginated). Each screen embeds its depot (Group {id,name})
  //     + group_id + GPS, so the whole sync sources from /screens — /groups is a
  //     broken CMS endpoint (HTTP 500) and is never called.
  const screens = []
  const seen = new Set()   // de-dup + guard against an API that ignores paging
  let received = 0
  try {
    for (let page = 1; page <= 60; page++) {
      const list = asList(await cms(`/screens?page=${page}&per_page=200`))
      if (!list.length) break
      let newInPage = 0
      for (const raw of list) {
        const m = mapScreen(raw); if (!m || seen.has(m.external_id)) continue
        seen.add(m.external_id); newInPage++; received++; screens.push(m)
      }
      if (list.length < 200 || newInPage === 0) break   // last/short page or repeat
    }
  } catch (e) { return j({ ok: false, error: 'screens_failed', detail: String(e?.message || e).slice(0, 160) }, 502) }

  // 2 · build the depot map from the screens' embedded groups. Link an aiadflux
  //     group to an existing seed depot (by external_group_id, then fuzzy name),
  //     else create one; backfill its GPS from a member screen.
  const groupMap = {}   // aiadflux group_id -> ops_depots.id
  let depotsLinked = 0, depotsCreated = 0
  try {
    const groups = {}   // group_id -> { name, lat, lng }
    for (const m of screens) {
      const gid = m.group_id; if (!gid) continue
      const g = groups[gid] || (groups[gid] = { name: m.group_name, lat: null, lng: null })
      if (!g.name && m.group_name) g.name = m.group_name
      if (g.lat == null && m.lat != null) { g.lat = m.lat; g.lng = m.lng }
    }
    const depots = await sbGet('ops_depots?select=id,name,external_group_id,lat,lng,is_active')
    for (const gid of Object.keys(groups)) {
      const g = groups[gid]
      if (/\btest\b/i.test(g.name || '')) continue   // never make a depot for a test group (F2)
      let d = depots.find(x => x.external_group_id === gid)
      if (!d && g.name) d = depots.find(x => !x.external_group_id && norm(x.name) && norm(x.name) === norm(g.name))
      if (d) {
        const patch = {}
        if (d.external_group_id !== gid) { patch.external_group_id = gid; depotsLinked++ }
        if (d.is_active === false) patch.is_active = true   // a live CMS group reactivates a deactivated depot (never leave a linked depot dark)
        if (d.lat == null && g.lat != null) { patch.lat = g.lat; patch.lng = g.lng }
        if (Object.keys(patch).length) { patch.updated_at = nowIso; await sbPatch('ops_depots', `id=eq.${d.id}`, patch); d.external_group_id = gid }
      } else {
        d = await sbInsertReturn('ops_depots', { name: g.name || `Depot ${gid}`, external_group_id: gid, lat: g.lat, lng: g.lng, is_active: true })
        if (d) { depots.push({ id: d.id, name: d.name, external_group_id: gid, lat: g.lat, lng: g.lng }); depotsCreated++ }
      }
      if (d) groupMap[gid] = d.id
    }
  } catch (e) { return j({ ok: false, error: 'depots_failed', detail: String(e?.message || e).slice(0, 160) }, 502) }

  // 3 · upsert screens (ONE uniform batch — status is just a column now) + link depots
  let online = 0, offline = 0, unknownN = 0, unresolvedDepot = 0
  let placeholdersRetired = false
  const rows = [], depotLinks = {}
  for (const m of screens) {
    if (m.status === 'online') online++; else if (m.status === 'offline') offline++; else unknownN++
    rows.push({ external_id: m.external_id, name: m.name, status: m.status, camera_active: m.camera_active, last_response_at: m.last_response, orientation: m.orientation, lat: m.lat, lng: m.lng, updated_at: nowIso })
    const depot_id = groupMap[m.group_id] || null
    if (depot_id) { const a = depotLinks[depot_id] || (depotLinks[depot_id] = []); a.push(m.external_id) }
    else unresolvedDepot++
  }
  try {
    // upsert, tolerant of a not-yet-added camera_active column (retry without it)
    const upsertScreens = async (batch) => {
      if (await sbUpsert('ops_screens', batch, 'external_id')) return true
      return sbUpsert('ops_screens', batch.map(({ camera_active, ...r }) => r), 'external_id')
    }
    let allOk = true
    for (let i = 0; i < rows.length; i += 200) { if (!(await upsertScreens(rows.slice(i, i + 200)))) allOk = false }
    // link depots — a separate PATCH so an unresolved screen keeps depot_id null (not wiped)
    for (const depot_id of Object.keys(depotLinks)) {
      const ids = depotLinks[depot_id]
      for (let i = 0; i < ids.length; i += 150) {
        const inList = ids.slice(i, i + 150).map(encodeURIComponent).join(',')
        await sbPatch('ops_screens', `external_id=in.(${inList})`, { depot_id })
      }
    }
    // retire the Phase-0 placeholder screens (external_id NULL, seeded from
    // cities.screens) now the real CMS screens are in — ONLY after a clean, non-empty
    // sync so a failed/empty pull can never wipe the seed. A ticket that referenced a
    // placeholder keeps its depot (ops_tickets.screen_id is ON DELETE SET NULL).
    if (received > 0 && rows.length > 0 && allOk) {
      const dr = await fetch(`${SUPABASE_URL}/rest/v1/ops_screens?external_id=is.null`, { method: 'DELETE', headers: { ...sbH, Prefer: 'return=minimal' } })
      placeholdersRetired = dr.ok
    }
  } catch (e) { return j({ ok: false, error: 'upsert_failed', detail: String(e?.message || e).slice(0, 160), depots_linked: depotsLinked, depots_created: depotsCreated }, 502) }

  // 4 · recompute today's uptime (the Phase-4 pay signal) — best-effort
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/ops_recompute_uptime_today`, { method: 'POST', headers: sbH, body: JSON.stringify({}) })
  } catch { /* Phase 4 SQL not run yet — statuses still synced */ }

  // 5 · reconcile offline tickets (open/auto-cancel per station) — best-effort
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/ops_reconcile_offline_tickets`, { method: 'POST', headers: sbH, body: JSON.stringify({}) })
  } catch { /* Phase 2 SQL not run yet — statuses still synced */ }

  return j({
    ok: true,
    screens_received: received, upserted: rows.length,
    online, offline, unknown: unknownN,
    depots_linked: depotsLinked, depots_created: depotsCreated, unresolved_depot: unresolvedDepot,
    placeholders_retired: placeholdersRetired,
  })
}

// ── Phase 2 hooks (documented, not built — add once the sync flow is proven):
//    • Inbound webhook receiver (screen.offline / screen.online / screen.content_failed
//      / camera.*) — verify X-Aiadflux-Signature with the webhook secret, 200-fast,
//      flip ops_screens.status, and auto-open an ops_tickets fault on a new offline
//      (dedup on an existing open fault; assign the depot's owning tech). NOTE the CMS
//      webhook currently targets https://adfluxcrm.com/api/webhooks/aiadflux — re-point
//      it to our domain (or proxy) before Phase 2.
//    • WhatsApp downtime alert (approved gu template) to the owning tech. Keep both
//      opt-in behind an env flag so a noisy CMS can't spam the field queue.
