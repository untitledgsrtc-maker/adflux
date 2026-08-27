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
//    if a field name differs, adjust mapGroup()/mapScreen() and redeploy.
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
const cmsH = { Authorization: `Bearer ${AIADFLUX_KEY}`, 'X-API-Key': AIADFLUX_KEY, accept: 'application/json' }

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
  .replace(/gsrtc|bus\s*stand|depot|station/g, '').replace(/[^a-z0-9]/g, '')

// aiadflux group -> { gid, gname }
function mapGroup(g) {
  return {
    gid: String(g?.id ?? g?.group_id ?? g?.uuid ?? '').trim(),
    gname: String(g?.name ?? g?.group_name ?? g?.group ?? g?.title ?? '').trim(),
  }
}
// aiadflux screen -> { external_id, name, status, group_ref } | null
function mapScreen(s) {
  const external_id = String(s?.external_id ?? s?.id ?? s?.screen_id ?? s?.uuid ?? '').trim()
  if (!external_id) return null
  let status = 'unknown'
  const raw = s?.status ?? s?.state ?? s?.online ?? s?.is_online
  if (raw === true || raw === 'online' || raw === 'up' || raw === 'active' || raw === 1) status = 'online'
  else if (raw === false || raw === 'offline' || raw === 'down' || raw === 'inactive' || raw === 0) status = 'offline'
  return {
    external_id,
    name: String(s?.name ?? s?.screen_name ?? s?.title ?? external_id).trim(),
    status,
    group_ref: String(s?.group_id ?? s?.group ?? s?.group_name ?? '').trim(),
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

  // ── DEBUG echo: reveal the exact CMS field shape (no writes) ──
  if (url.searchParams.get('debug')) {
    try {
      const [g, s] = await Promise.all([cms('/groups'), cms('/screens?per_page=2')])
      const gl = asList(g), sl = asList(s)
      return j({
        ok: true, debug: true, base: AIADFLUX_URL,
        groups_count: gl.length, groups_sample: gl[0] || null,
        screens_count: sl.length, screens_sample: sl[0] || null,
        wrapper_keys: {
          groups: g && typeof g === 'object' && !Array.isArray(g) ? Object.keys(g) : 'array',
          screens: s && typeof s === 'object' && !Array.isArray(s) ? Object.keys(s) : 'array',
        },
      })
    } catch (e) { return j({ ok: false, error: 'aiadflux_unreachable', detail: String(e?.message || e).slice(0, 160) }, 502) }
  }

  if (req.method !== 'POST') return j({ error: 'method — POST to sync, or GET ?debug=1 to inspect' }, 405)

  const nowIso = new Date().toISOString()

  // 1 · GROUPS → link/create depots, build the group->depot map
  const groupMap = {}, nameMap = {}
  let depotsLinked = 0
  try {
    const groups = asList(await cms('/groups')).map(mapGroup).filter(g => g.gid || g.gname)
    const depots = await sbGet('ops_depots?select=id,name,external_group_id')
    for (const g of groups) {
      let d = g.gid && depots.find(x => x.external_group_id === g.gid)
      if (!d && g.gname) d = depots.find(x => !x.external_group_id && norm(x.name) && norm(x.name) === norm(g.gname))
      if (d) {
        if (g.gid && d.external_group_id !== g.gid) {
          await sbPatch('ops_depots', `id=eq.${d.id}`, { external_group_id: g.gid, updated_at: nowIso })
          d.external_group_id = g.gid; depotsLinked++
        }
      } else {
        d = await sbInsertReturn('ops_depots', { name: g.gname || `Depot ${g.gid}`, external_group_id: g.gid || null, is_active: true })
        if (d) { depots.push({ id: d.id, name: d.name, external_group_id: g.gid || null }); depotsLinked++ }
      }
      if (d) {
        if (g.gid) groupMap[g.gid] = d.id
        if (g.gname) nameMap[norm(g.gname)] = d.id
      }
    }
  } catch (e) { return j({ ok: false, error: 'groups_failed', detail: String(e?.message || e).slice(0, 160) }, 502) }

  // 2 · SCREENS → paginated upsert into ops_screens by external_id (creates new)
  let received = 0, online = 0, offline = 0, unresolvedDepot = 0
  const onlineRows = [], offlineRows = [], unknownRows = [], depotLinks = {}
  try {
    for (let page = 1; page <= 60; page++) {
      const list = asList(await cms(`/screens?page=${page}&per_page=200`))
      if (!list.length) break
      received += list.length
      for (const raw of list) {
        const m = mapScreen(raw); if (!m) continue
        if (m.status === 'online') { online++; onlineRows.push({ external_id: m.external_id, name: m.name, status: 'online', last_response_at: nowIso, updated_at: nowIso }) }
        else if (m.status === 'offline') { offline++; offlineRows.push({ external_id: m.external_id, name: m.name, status: 'offline', updated_at: nowIso }) }
        else unknownRows.push({ external_id: m.external_id, name: m.name, updated_at: nowIso })
        const depot_id = groupMap[m.group_ref] || nameMap[norm(m.group_ref)] || null
        if (depot_id) { const a = depotLinks[depot_id] || (depotLinks[depot_id] = []); a.push(m.external_id) }
        else unresolvedDepot++
      }
      if (list.length < 200) break
    }
    // uniform-column upsert batches (status/last_response_at differ per batch,
    // so each status class is its own batch — never nulls an unrelated column)
    const chunkUpsert = async (rows) => { for (let i = 0; i < rows.length; i += 200) await sbUpsert('ops_screens', rows.slice(i, i + 200), 'external_id') }
    if (onlineRows.length)  await chunkUpsert(onlineRows)
    if (offlineRows.length) await chunkUpsert(offlineRows)
    if (unknownRows.length) await chunkUpsert(unknownRows)
    // depot links — a separate PATCH so it NEVER nulls depot_id on an unresolved screen
    for (const depot_id of Object.keys(depotLinks)) {
      const ids = depotLinks[depot_id]
      for (let i = 0; i < ids.length; i += 150) {
        const inList = ids.slice(i, i + 150).map(encodeURIComponent).join(',')
        await sbPatch('ops_screens', `external_id=in.(${inList})`, { depot_id })
      }
    }
  } catch (e) { return j({ ok: false, error: 'screens_failed', detail: String(e?.message || e).slice(0, 160), depots_linked: depotsLinked }, 502) }

  // 3 · recompute today's uptime (the Phase-4 pay signal) — best-effort
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/ops_recompute_uptime_today`, { method: 'POST', headers: sbH, body: JSON.stringify({}) })
  } catch { /* Phase 4 SQL not run yet — statuses still synced */ }

  return j({
    ok: true, depots_linked: depotsLinked,
    screens_received: received, upserted: onlineRows.length + offlineRows.length + unknownRows.length,
    online, offline, unknown: unknownRows.length, unresolved_depot: unresolvedDepot,
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
