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

// ── Places (New) lookup for the Log Meeting company search ─────────────
// Lives in this file on purpose: the Hobby plan caps a deployment at 12
// serverless functions, and a separate api/places-search.js made the whole
// deploy fail (exceeded_serverless_functions_per_deployment, 29 Oct 2026).
// GET /api/directions?places=1&q=<text>[&lat=&lng=]  -> { results: [{id,name,address}] }
// GET /api/directions?places=1&id=<placeId>           -> { place: {name,address,city,phone,website,types,lat,lng} }
// Needs "Places API (New)" enabled + allowed on the ROADS_KEY_SERVER key.
const PLACE_ID_RE = /^[A-Za-z0-9_-]{10,200}$/

function componentOf(components, type) {
  const c = (components || []).find(x => (x.types || []).includes(type))
  return c?.longText || ''
}

async function placesHandler(req, res, key) {
  const { q, id, lat, lng } = req.query || {}

  try {
    // ── Details for one picked place ──
    if (id) {
      if (!PLACE_ID_RE.test(String(id))) {
        res.status(400).json({ error: 'bad place id' })
        return
      }
      const r = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(String(id))}`, {
        headers: {
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask': 'id,displayName,formattedAddress,addressComponents,nationalPhoneNumber,websiteUri,types,location',
        },
        signal: AbortSignal.timeout(8000),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        res.status(502).json({ error: j?.error?.message || `Places ${r.status}` })
        return
      }
      res.status(200).json({
        place: {
          name:    j.displayName?.text || '',
          address: j.formattedAddress || '',
          city:    componentOf(j.addressComponents, 'locality')
                   || componentOf(j.addressComponents, 'administrative_area_level_2'),
          phone:   j.nationalPhoneNumber || '',
          website: j.websiteUri || '',
          types:   Array.isArray(j.types) ? j.types : [],
          lat:     Number.isFinite(j.location?.latitude) ? j.location.latitude : null,
          lng:     Number.isFinite(j.location?.longitude) ? j.location.longitude : null,
        },
      })
      return
    }

    // ── Search ──
    const text = String(q || '').trim().slice(0, 100)
    if (text.length < 3) {
      res.status(400).json({ error: 'q must be at least 3 characters' })
      return
    }
    const body = { textQuery: text, regionCode: 'IN', languageCode: 'en', maxResultCount: 5 }
    const la = Number(lat), ln = Number(lng)
    if (Number.isFinite(la) && Number.isFinite(ln) && Math.abs(la) <= 90 && Math.abs(ln) <= 180) {
      body.locationBias = { circle: { center: { latitude: la, longitude: ln }, radius: 50000 } }
    }
    const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) {
      res.status(502).json({ error: j?.error?.message || `Places ${r.status}` })
      return
    }
    res.status(200).json({
      results: (j.places || []).slice(0, 5).map(p => ({
        id:      p.id,
        name:    p.displayName?.text || '',
        address: p.formattedAddress || '',
      })),
    })
  } catch (e) {
    res.status(502).json({ error: e?.message || 'upstream failure' })
  }
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

  if (req.query?.places) return placesHandler(req, res, key)

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
