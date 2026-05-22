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

import { requireAuth } from './_auth'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'GET only' })
    return
  }

  // Phase 85.3 — require Supabase JWT.
  const user = await requireAuth(req, res)
  if (!user) return

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
