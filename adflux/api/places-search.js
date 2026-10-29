// Vercel serverless function: Google Places (New) proxy for the Log Meeting
// company-name search.
//
// Why
//   A rep standing outside a shop types a few letters of the name and picks the
//   Google listing; company, phone, city and website fill in. Free typing still
//   works everywhere, this only adds suggestions.
//
// Contract (GET, same-origin only)
//   /api/places-search?q=sunrise+diag[&lat=22.3&lng=73.1]
//     -> 200 { results: [{ id, name, address }] }          (max 5)
//   /api/places-search?id=<placeId>
//     -> 200 { place: { name, address, city, phone, website } }
//     -> 400 bad input · 403 cross-origin · 429 rate limit · 502 upstream
//
// Cost control
//   Search asks only for id / name / address (cheap fields). Phone and website
//   are fetched once, when the rep actually picks a result. Client debounces
//   and needs 3+ characters; 60 requests / minute / IP below.
//
// Key
//   Reuses the server-side ROADS_KEY_SERVER (no VITE_ prefix). "Places API
//   (New)" must be enabled on the project AND added to that key's API
//   restrictions in Google Cloud Console, otherwise this returns 502.

// Inline guard (same as api/directions.js): Vercel does not bundle sibling
// `_`-prefixed helper files on this project, so nothing is imported.
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

const PLACE_ID_RE = /^[A-Za-z0-9_-]{10,200}$/

function componentOf(components, type) {
  const c = (components || []).find(x => (x.types || []).includes(type))
  return c?.longText || ''
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
          'X-Goog-FieldMask': 'id,displayName,formattedAddress,addressComponents,nationalPhoneNumber,websiteUri',
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
