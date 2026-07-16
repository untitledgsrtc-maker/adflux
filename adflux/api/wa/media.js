// api/wa/media.js
//
// Campaign C5 — proxy an inbound WhatsApp media id to its real bytes so the
// Inbox can render photos. The inbox uses:
//     <img src="/api/wa/media?id=<media_id>">
//
// Flow:
//   1) confirm <media_id> is one we ACTUALLY received (lookup in
//      whatsapp_messages with the service role) — so arbitrary ids can't be
//      fetched through our token.
//   2) resolve the id to a short-lived Meta download URL (GET /{id}).
//   3) download the bytes (the CDN url ALSO needs the token) and stream them
//      back with the right Content-Type.
//
// Same-origin gated (mirrors the §34 proxy pattern). Read-only; touches no
// live-app table (§45). The token never leaves the server.
//
// Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + CAMPAIGN_WA_TOKEN.

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const WA_TOKEN     = process.env.CAMPAIGN_WA_TOKEN
const GRAPH = 'https://graph.facebook.com/v21.0'

// <img> requests carry a Referer; allow only our own origins.
function sameOrigin(req) {
  const ref = req.headers.referer || req.headers.origin || ''
  try {
    const { protocol, host } = new URL(ref)
    return `${protocol}//${host}` === 'https://app.untitledad.in' || /\.vercel\.app$/.test(host)
  } catch { return false }
}

// Best-effort per-instance rate-limit (mirrors §34 — 120/IP/min; generous so a
// thread of photos loads fine, bounded so a same-origin caller can't fan out
// Graph fetches on our token). In-memory; resets on cold start by design.
const HITS = new Map()
function rateLimited(req) {
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown'
  const now = Date.now()
  if (HITS.size > 5000) HITS.clear()
  const rec = HITS.get(ip)
  if (!rec || now - rec.start > 60_000) { HITS.set(ip, { start: now, n: 1 }); return false }
  rec.n += 1
  return rec.n > 120
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })
  if (!WA_TOKEN || !SUPABASE_URL || !SERVICE_KEY) return res.status(503).json({ error: 'not_configured' })
  if (!sameOrigin(req)) return res.status(403).json({ error: 'forbidden' })
  if (rateLimited(req)) return res.status(429).json({ error: 'rate_limited' })

  const id = String(req.query.id || '').trim()
  if (!/^[0-9]{5,}$/.test(id)) return res.status(400).json({ error: 'bad_id' })  // Meta media ids are numeric

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  // Gate: only media we actually stored can be proxied.
  const { data: row, error } = await admin
    .from('whatsapp_messages').select('media_mime').eq('media_id', id).limit(1).maybeSingle()
  if (error || !row) return res.status(404).json({ error: 'not_found' })

  try {
    const metaRes = await fetch(`${GRAPH}/${id}`, { headers: { Authorization: `Bearer ${WA_TOKEN}` } })
    if (!metaRes.ok) {
      // Surface Meta's actual error so a 502 is diagnosable (expired media vs a
      // token/permission problem) instead of an opaque failure (§236 loud).
      let detail = null, code = null
      try { const e = (await metaRes.json())?.error; detail = e?.message || null; code = e?.code ?? null } catch { /* noop */ }
      return res.status(502).json({ error: 'meta_lookup_failed', status: metaRes.status, code, detail })
    }
    const meta = await metaRes.json()
    if (!meta?.url) return res.status(404).json({ error: 'no_url' })

    const binRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${WA_TOKEN}` } })
    if (!binRes.ok) return res.status(502).json({ error: 'download_failed', status: binRes.status })

    const buf = Buffer.from(await binRes.arrayBuffer())
    const mime = meta.mime_type || row.media_mime || binRes.headers.get('content-type') || 'application/octet-stream'
    res.setHeader('Content-Type', mime)
    res.setHeader('Cache-Control', 'private, max-age=86400') // media is immutable per id
    return res.status(200).send(buf)
  } catch {
    return res.status(502).json({ error: 'proxy_error' })
  }
}
