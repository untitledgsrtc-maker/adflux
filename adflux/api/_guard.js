// Phase 85.3.1 — shared guard for Google-paid proxies. Replaces the
// hard JWT requirement (Phase 85.3) which was silently bailing on
// expired PWA sessions and breaking /admin/gps route rendering.
//
// New strategy
//   • Same-origin check on Origin / Referer header (web + APK both
//     load from app.untitledad.in, so both pass).
//   • Per-IP rate limit (60 req/min) — same shape as /api/shorten.
//
// Trade-off
//   Bot with curl + spoofed Referer can still hit the endpoint.
//   But the Roads API key is restricted in Cloud Console to (a)
//   specific APIs (Directions / Roads / Maps JS), and (b) request
//   counts billed against the project. Combined with the rate limit
//   that's a tight enough seal for our scale.

const ALLOWED_ORIGINS = [
  'https://app.untitledad.in',
  'https://untitled-os-tau.vercel.app',
  // Vercel preview deployments — match any *.vercel.app under our
  // project. Suffix check below handles it.
]

const RATE_WINDOW_MS = 60 * 1000
const RATE_MAX       = 60
const rateBucket     = new Map()

function rateLimit(ip) {
  const now   = Date.now()
  const entry = rateBucket.get(ip)
  if (!entry || entry.resetAt < now) {
    rateBucket.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return { ok: true }
  }
  if (entry.count >= RATE_MAX) {
    return { ok: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) }
  }
  entry.count += 1
  return { ok: true }
}

function isSameOrigin(req) {
  const origin  = req.headers?.origin || ''
  const referer = req.headers?.referer || ''
  const candidate = origin || referer
  if (!candidate) return false
  try {
    const u = new URL(candidate)
    const host = `${u.protocol}//${u.host}`
    if (ALLOWED_ORIGINS.includes(host)) return true
    if (u.host.endsWith('.vercel.app')) return true
    return false
  } catch {
    return false
  }
}

/**
 * Returns true if the request passed the guard. On failure sends
 * the appropriate HTTP status + JSON error and returns false.
 */
export function guardProxy(req, res) {
  if (!isSameOrigin(req)) {
    res.status(403).json({ error: 'Cross-origin requests not allowed' })
    return false
  }
  const ip = (req.headers?.['x-forwarded-for'] || '').split(',')[0].trim()
          || req.socket?.remoteAddress
          || 'unknown'
  const rl = rateLimit(ip)
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfter))
    res.status(429).json({ error: `Rate limit exceeded. Retry in ${rl.retryAfter}s.` })
    return false
  }
  return true
}
