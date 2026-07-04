// api/wa/media-sample.js
// ─────────────────────────────────────────────────────────────────────────
// Campaign — upload a SAMPLE image/video/PDF to Meta and return the
// `header_handle` needed to CREATE a media-header template in-app.
//
// Meta's media-header templates can't take a plain URL for the approval
// sample — they need a handle from the App-level Resumable Upload API:
//   1) POST /{APP_ID}/uploads?file_length&file_type   -> { id: "upload:..." }
//   2) POST /{upload_session_id}  (Authorization: OAuth, file_offset: 0, body=bytes)
//                                                       -> { h: "<header_handle>" }
// The handle then goes into templates.js create as
//   components:[{type:'HEADER',format:'IMAGE',example:{header_handle:[h]}}]
//
// POST body: { media_url, mime_type }  (media_url = campaign-media public URL)
// Auth: admin / co_owner JWT (mirrors templates.js). Token = CAMPAIGN_WA_TOKEN.
// App id = CAMPAIGN_APP_ID (defaults to the "Waba" app; not a secret). Self-
// contained, no `_`-prefixed helper (§35). Touches no live-app table (§45).
// ─────────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const WA_TOKEN     = process.env.CAMPAIGN_WA_TOKEN
const APP_ID       = process.env.CAMPAIGN_APP_ID || '1443324144491532'
const GRAPH = 'https://graph.facebook.com/v21.0'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' })
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'server not configured' })
  if (!WA_TOKEN) return res.status(503).json({ error: 'token_missing', detail: 'CAMPAIGN_WA_TOKEN not set in Vercel.' })

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

  // ── auth: admin / co_owner ──
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return res.status(401).json({ error: 'no_auth' })
  const { data: ures, error: uerr } = await admin.auth.getUser(token)
  const uid = ures?.user?.id
  if (uerr || !uid) return res.status(401).json({ error: 'bad_auth' })
  const { data: me } = await admin.from('users').select('role').eq('id', uid).maybeSingle()
  if (!me || !['admin', 'co_owner'].includes(me.role)) return res.status(403).json({ error: 'not_allowed' })

  // ── input ──
  let body = req.body
  if (typeof body === 'string') { try { body = JSON.parse(body) } catch { body = {} } }
  const mediaUrl = String(body?.media_url || '').trim()
  const mime     = String(body?.mime_type || '').trim()
  if (!mediaUrl || !mime) return res.status(400).json({ error: 'bad_input', detail: 'media_url + mime_type required.' })

  try {
    // 1) fetch the sample bytes from the (public) campaign-media URL
    const fileRes = await fetch(mediaUrl)
    if (!fileRes.ok) return res.status(502).json({ error: 'fetch_failed', detail: `Could not read the uploaded file (HTTP ${fileRes.status}).` })
    const bytes = Buffer.from(await fileRes.arrayBuffer())
    if (!bytes.length) return res.status(400).json({ error: 'empty_file' })

    // 2) open a resumable upload session
    const startUrl = `${GRAPH}/${APP_ID}/uploads?file_length=${bytes.length}` +
      `&file_type=${encodeURIComponent(mime)}&access_token=${encodeURIComponent(WA_TOKEN)}`
    const startRes = await fetch(startUrl, { method: 'POST' })
    const startJson = await startRes.json().catch(() => ({}))
    if (!startRes.ok || !startJson.id) {
      return res.status(502).json({ error: 'meta_error', detail: startJson?.error?.message || `upload start failed (HTTP ${startRes.status})` })
    }

    // 3) transfer the bytes → get the header handle `h`
    const upRes = await fetch(`${GRAPH}/${startJson.id}`, {
      method: 'POST',
      headers: {
        Authorization: `OAuth ${WA_TOKEN}`,
        file_offset: '0',
        'Content-Type': mime,
      },
      body: bytes,
    })
    const upJson = await upRes.json().catch(() => ({}))
    if (!upRes.ok || !upJson.h) {
      return res.status(502).json({ error: 'meta_error', detail: upJson?.error?.message || `upload transfer failed (HTTP ${upRes.status})` })
    }

    return res.status(200).json({ ok: true, header_handle: upJson.h })
  } catch (e) {
    return res.status(500).json({ error: 'server', detail: String(e?.message || e) })
  }
}
