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
      `https://is.gd/create.php?format=simple&url=${encodeURIComponent(url)}`,
      { signal: controller.signal }
    )
    clearTimeout(timer)

    if (!upstream.ok) {
      return res.status(502).json({ error: `is.gd ${upstream.status}` })
    }
    const short = (await upstream.text()).trim()
    // is.gd returns `Error: ...` as plaintext on failure (still HTTP 200).
    if (!/^https?:\/\/\S+$/i.test(short) || /^error:/i.test(short)) {
      return res.status(502).json({ error: 'is.gd returned malformed body' })
    }

    // Cache for 1 hour — same URL shortens to the same short URL and
    // upstream can be slow under load. Safe because URLs in this app
    // are immutable (PDF uploads use a fresh timestamped path).
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400')
    return res.status(200).json({ short })
  } catch (e) {
    clearTimeout(timer)
    return res.status(502).json({ error: e.message || 'Upstream error' })
  }
}
