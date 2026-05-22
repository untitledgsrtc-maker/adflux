// Vercel serverless function: Google Roads API snapToRoads proxy.
//
// Why
//   Roads API requires an API key + Chrome's strict-origin-when-cross-origin
//   referrer policy strips Referer for fetch() calls from the browser,
//   so a key restricted to Websites referers gets 403
//   API_KEY_HTTP_REFERRER_BLOCKED. Server-side calls don't have that
//   problem.
//
// Security
//   Server-side key (`ROADS_KEY_SERVER` env var, NO VITE_ prefix → never
//   shipped to browser bundle). Restrict that key in Cloud Console to
//   Roads API + Directions API only. No application restriction needed —
//   Vercel functions are server-to-server.
//
// Contract
//   POST /api/snap-to-roads
//     body: { path: "lat,lng|lat,lng|..." }       // 100 points max
//     → 200 { snappedPoints: [...] }              // pass-through from Google
//     → 400 { error: "..." }                      // missing path / >100 pts
//     → 502 { error: "..." }                      // Google unreachable

import { requireAuth } from './_auth'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' })
    return
  }

  // Phase 85.3 — require Supabase JWT. Audit 24 May 2026 flagged
  // unauthenticated access as P1; anyone with the URL could drain
  // your Google Roads API spend.
  const user = await requireAuth(req, res)
  if (!user) return

  const key = process.env.ROADS_KEY_SERVER
  if (!key) {
    res.status(500).json({ error: 'ROADS_KEY_SERVER not configured' })
    return
  }

  let body = req.body
  if (typeof body === 'string') {
    try { body = JSON.parse(body) } catch { body = {} }
  }
  const path = body?.path
  if (!path || typeof path !== 'string') {
    res.status(400).json({ error: 'path required' })
    return
  }
  // Hard-cap at 100 points (Roads API limit; defensive).
  const ptCount = path.split('|').length
  if (ptCount > 100) {
    res.status(400).json({ error: `path has ${ptCount} points; max 100` })
    return
  }

  try {
    const url = `https://roads.googleapis.com/v1/snapToRoads?path=${encodeURIComponent(path)}&interpolate=true&key=${key}`
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) })
    const json = await r.json()
    res.status(r.status).json(json)
  } catch (e) {
    res.status(502).json({ error: e?.message || 'upstream failure' })
  }
}
