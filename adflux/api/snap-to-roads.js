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

// Phase 85.3.2 — guard inlined per-endpoint. See api/directions.js
// for the explanation: Vercel's bundler does not include
// `_`-prefixed sibling files, so any helper import crashes the
// function at startup.

const ALLOWED_ORIGINS = [
  'https://app.untitledad.in',
  'https://untitled-os-tau.vercel.app',
]
const RATE_WINDOW_MS = 60 * 1000
const RATE_MAX       = 60
const rateBucket     = new Map()

function guardProxy(req, res) {
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
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' })
    return
  }

  if (!guardProxy(req, res)) return

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
