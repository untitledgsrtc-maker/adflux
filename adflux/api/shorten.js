// Vercel serverless function: same-origin URL shortener proxy.
//
// Why this exists
//   vercel.json's CSP sets `connect-src 'self' https://*.supabase.co ...`.
//   Third-party shorteners (is.gd, cleanuri.com, tinyurl.com) are blocked
//   by that policy for direct browser calls — even if they support CORS.
//   Routing the request through this function is a same-origin call
//   ("self"), which the CSP allows, and the outbound call happens
//   server-side where neither CSP nor CORS apply.
//
// Shortener choice — is.gd (not TinyURL)
//   TinyURL's legacy `api-create.php` endpoint still produces shortlinks,
//   but as of 2025 those shortlinks now serve a "deprecated API endpoint"
//   interstitial page BEFORE redirecting to the destination. That
//   interstitial is what users saw when tapping a WhatsApp PDF link, and
//   it looks broken/spammy to the client. The fix is to stop using that
//   endpoint entirely — new `api.tinyurl.com` v2 needs an API token we
//   don't have, so we switched to is.gd: same GET→plaintext shape as
//   legacy TinyURL, no interstitial, no token, stable for 15+ years.
//
// Contract
//   GET /api/shorten?url=<encoded long url>
//   → 200 { short: "https://is.gd/xxxxx" }
//   → 400 { error: "..." }         (missing/invalid url)
//   → 502 { error: "..." }         (is.gd unreachable or bad response)
//
// Notes
//   - Node 18+ has a native global `fetch` — no extra dependencies.
//   - 5s outbound timeout so a hanging upstream can't stall the request.
//   - Allows wa.me / supabase.co URLs only by default — we never want
//     this endpoint to be used as an open redirect generator by a
//     third party. The allowlist is the root of the hostname.

const ALLOWED_HOST_SUFFIXES = [
  '.supabase.co',   // our PDF storage URLs
  'wa.me',          // WhatsApp click-to-chat links
  // Phase 81.4 — quote PDFs now served via the app.untitledad.in
  // domain (Vercel rewrite → Supabase storage). Allowlist the
  // root so the shortener accepts them too.
  '.untitledad.in',
  'untitledad.in',
]

// Phase 85.4 — per-IP rate limiter. Audit 24 May 2026 flagged that a
// bot could burn through is.gd quota by hammering this endpoint.
// In-memory Map keyed by client IP; entries auto-expire after the
// window. Vercel cold start (~5 min idle) wipes the bucket — that's
// fine for this scale (single-tenant ~6 reps).
const RATE_WINDOW_MS  = 60 * 1000   // 1 minute
const RATE_MAX        = 60           // 60 calls / IP / minute
const rateBucket      = new Map()    // ip → { count, resetAt }

function rateLimit(ip) {
  const now   = Date.now()
  const entry = rateBucket.get(ip)
  if (!entry || entry.resetAt < now) {
    rateBucket.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return { ok: true, remaining: RATE_MAX - 1 }
  }
  if (entry.count >= RATE_MAX) {
    return { ok: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) }
  }
  entry.count += 1
  return { ok: true, remaining: RATE_MAX - entry.count }
}

export default async function handler(req, res) {
  // Phase 85.4 — rate limit before any other work.
  const ip = (req.headers?.['x-forwarded-for'] || '').split(',')[0].trim()
            || req.socket?.remoteAddress
            || 'unknown'
  const rl = rateLimit(ip)
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfter))
    return res.status(429).json({ error: `Rate limit exceeded. Retry in ${rl.retryAfter}s.` })
  }

  const { url } = req.query || {}
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing url query parameter' })
  }

  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return res.status(400).json({ error: 'Malformed url' })
  }

  const host = parsed.hostname.toLowerCase()
  const allowed = ALLOWED_HOST_SUFFIXES.some(suffix =>
    host === suffix || host.endsWith(suffix)
  )
  if (!allowed) {
    return res.status(400).json({ error: 'Host not on allowlist' })
  }

  // Phase 86.2 — server-side cascade. is.gd is flaky in 2026 (owner
  // hit 502 on UA-2026-0055). Try multiple shortener providers
  // server-side so the client sees one consistent /api/shorten
  // response. Order: cleanuri (most reliable today) → is.gd → tinyurl
  // legacy. First success wins. Long URL returned only if all fail.

  // Cleanuri — POST form-urlencoded, JSON response, no auth.
  async function tryCleanuri(longUrl, signal) {
    const r = await fetch('https://cleanuri.com/api/v1/shorten', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    `url=${encodeURIComponent(longUrl)}`,
      signal,
    })
    if (!r.ok) return null
    const j = await r.json().catch(() => null)
    const s = j?.result_url
    return (typeof s === 'string' && /^https?:\/\/\S+$/i.test(s)) ? s : null
  }
  // is.gd — GET plaintext response, no auth.
  async function tryIsGd(longUrl, signal) {
    const r = await fetch(
      `https://is.gd/create.php?format=simple&url=${encodeURIComponent(longUrl)}`,
      { signal }
    )
    if (!r.ok) return null
    const t = (await r.text()).trim()
    if (!/^https?:\/\/\S+$/i.test(t) || /^error:/i.test(t)) return null
    return t
  }
  // TinyURL legacy — GET plaintext. Shipped deprecation interstitial
  // in 2025 (Phase 34Z note) but still produces a redirect that works
  // when the others are down. Last resort.
  async function tryTinyUrl(longUrl, signal) {
    const r = await fetch(
      `https://tinyurl.com/api-create.php?url=${encodeURIComponent(longUrl)}`,
      { signal }
    )
    if (!r.ok) return null
    const t = (await r.text()).trim()
    if (!/^https?:\/\/tinyurl\.com\/\S+$/i.test(t)) return null
    return t
  }

  const providers = [tryCleanuri, tryIsGd, tryTinyUrl]

  for (const fn of providers) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 4000) // 4s per provider
    try {
      const short = await fn(url, controller.signal)
      clearTimeout(timer)
      if (short && short.length < url.length) {
        res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400')
        return res.status(200).json({ short, provider: fn.name.replace(/^try/, '').toLowerCase() })
      }
    } catch {
      clearTimeout(timer)
      // continue to next provider
    }
  }

  // All providers failed. Return the original URL so the client can
  // gracefully fall back (whatsapp.js shortenUrl already does this).
  return res.status(200).json({ short: url, provider: 'fallback-original' })
}
