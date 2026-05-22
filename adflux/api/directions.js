// Vercel serverless function: Google Directions API proxy.
//
// Why
//   Owner GPS pings often cluster at 2-3 spots (check-in, parked,
//   check-out) — Roads API snapToRoads can't reconstruct the road
//   route between far-apart clusters. Directions API computes the
//   actual driving route between origin + destination + optional
//   waypoints, returning an encoded polyline that follows real
//   streets.
//
// Security
//   Same server-side key as snap-to-roads (ROADS_KEY_SERVER, no
//   VITE_ prefix). Key restricted in Cloud Console to Roads API +
//   Directions API + Maps JavaScript API.
//
// Contract
//   GET /api/directions?origin=lat,lng&destination=lat,lng&waypoints=lat,lng|lat,lng
//     → 200 { polyline: "encoded_string", distance_m: 7400, duration_s: 1200 }
//     → 400 { error: "..." }
//     → 502 { error: "..." }
//
//   The polyline is Google's encoded format. Frontend decodes via
//   google.maps.geometry.encoding.decodePath().

// Phase 85.3.2 — inline guard. Vercel's serverless function bundler
// does NOT include sibling `_`-prefixed helper files on this
// project, so any `import { X } from './_guard'` crashes the
// function at startup with FUNCTION_INVOCATION_FAILED. Discovered
// 23 May 2026 when /api/directions kept 500-ing after both
// Phase 85.3 (_auth) and Phase 85.3.1 (_guard) swaps. Inlining
// the guard logic per-endpoint sidesteps the issue.

const ALLOWED_ORIGINS = [
  'https://app.untitledad.in',
  'https://untitled-os-tau.vercel.app',
]
const RATE_WINDOW_MS = 60 * 1000
const RATE_MAX       = 60
const rateBucket     = new Map()

function guardProxy(req, res) {
  // 1) Same-origin allowlist
  const origin  = req.headers?.origin || ''
  const referer = req.headers?.referer || ''
  const candidate = origin || referer
  let sameOrigin = false
  if (candidate) {
    try {
      const u = new URL(candidate)
      const host = `${u.protocol}//${u.host}`
      sameOrigin = ALLOWED_ORIGINS.includes(host) || u.host.endsWith('.vercel.app')
    } catch {
      sameOrigin = false
    }
  }
  if (!sameOrigin) {
    res.status(403).json({ error: 'Cross-origin requests not allowed' })
    return false
  }
  // 2) Per-IP rate limit
  const ip = (req.headers?.['x-forwarded-for'] || '').split(',')[0].trim()
          || req.socket?.remoteAddress
          || 'unknown'
  const now = Date.now()
  const entry = rateBucket.get(ip)
  if (!entry || entry.resetAt < now) {
    rateBucket.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS })
  } else if (entry.count >= RATE_MAX) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
    res.setHeader('Retry-After', String(retryAfter))
    res.status(429).json({ error: `Rate limit exceeded. Retry in ${retryAfter}s.` })
    return false
  } else {
    entry.count += 1
  }
  return true
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'GET only' })
    return
  }

  if (!guardProxy(req, res)) return

  const key = process.env.ROADS_KEY_SERVER
  if (!key) {
    res.status(500).json({ error: 'ROADS_KEY_SERVER not configured' })
    return
  }

  const { origin, destination, waypoints, mode } = req.query || {}
  if (!origin || !destination) {
    res.status(400).json({ error: 'origin and destination required' })
    return
  }

  const params = new URLSearchParams({
    origin: String(origin),
    destination: String(destination),
    mode: String(mode || 'driving'),
    key,
  })
  if (waypoints) {
    // Optional waypoints — pipe-separated lat,lng pairs.
    params.set('waypoints', String(waypoints))
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) })
    const json = await r.json()
    if (json.status !== 'OK' || !Array.isArray(json.routes) || json.routes.length === 0) {
      res.status(200).json({
        polyline: null,
        distance_m: 0,
        duration_s: 0,
        google_status: json.status || 'NO_ROUTE',
        error_message: json.error_message || null,
      })
      return
    }
    const route = json.routes[0]
    const leg  = route.legs?.[0] || {}
    res.status(200).json({
      polyline:   route.overview_polyline?.points || null,
      distance_m: leg.distance?.value || 0,
      duration_s: leg.duration?.value || 0,
      google_status: 'OK',
    })
  } catch (e) {
    res.status(502).json({ error: e?.message || 'upstream failure' })
  }
}
