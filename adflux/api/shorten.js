// Vercel serverless function: same-origin URL shortener proxy.
//
// Why this exists
//   vercel.json's CSP sets `connect-src 'self' https://*.supabase.co ...`.
//   Third-party shorteners (tinyurl.com, is.gd, cleanuri.com) are blocked
//   by that policy, so the browser cannot call them directly — even if
//   they support CORS. Routing the request through this function is a
//   same-origin call ("self"), which the CSP allows, and the outbound
//   TinyURL call happens server-side where neither CSP nor CORS apply.
//
// Contract
//   GET /api/shorten?url=<encoded long url>
//   → 200 { short: "https://tinyurl.com/xxxxx" }
//   → 400 { error: "..." }         (missing/invalid url)
//   → 502 { error: "..." }         (TinyURL unreachable or bad response)
//
// Notes
//   - Node 18+ has a native global `fetch` — no extra dependencies.
//   - 5s outbound timeout so a hanging TinyURL can't stall the request.
//   - Allows wa.me / supabase.co URLs only by default — we never want
//     this endpoint to be used as an open redirect generator by a
//     third party. The allowlist is the root of the hostname.

const ALLOWED_HOST_SUFFIXES = [
  '.supabase.co',   // our PDF storage URLs
  'wa.me',          // WhatsApp click-to-chat links
]

export default async function handler(req, res) {
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

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)

  try {
    const upstream = await fetch(
      `https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`,
      { signal: controller.signal }
    )
    clearTimeout(timer)

    if (!upstream.ok) {
      return res.status(502).json({ error: `TinyURL ${upstream.status}` })
    }
    const short = (await upstream.text()).trim()
    if (!/^https?:\/\/\S+$/i.test(short)) {
      return res.status(502).json({ error: 'TinyURL returned malformed body' })
    }

    // Cache for 1 hour — same URL shortens to the same short URL and
    // TinyURL can be slow under load. Safe because URLs in this app
    // are immutable (PDF uploads use a fresh timestamped path).
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400')
    return res.status(200).json({ short })
  } catch (e) {
    clearTimeout(timer)
    return res.status(502).json({ error: e.message || 'Upstream error' })
  }
}
