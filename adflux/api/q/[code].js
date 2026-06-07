// api/q/[code].js
// ─────────────────────────────────────────────────────────────────────────
// Campaign — QR scan redirect + log.
//
// A board QR encodes  https://app.untitledad.in/api/q/<CODE>  (not wa.me
// directly). When scanned: look up the board by code, log ONE qr_scans row
// (so the QR page can show "Scans"), then 302-redirect to the board's stored
// wa.me link — WhatsApp opens on the customer's phone exactly as before.
//
// Isolation (CLAUDE.md §45)
//   • Brand-new public endpoint. No existing code calls it.
//   • Reads campaign_locations (by the public board code) + writes qr_scans
//     (a new table) via the service role. Touches no existing/live table.
//   • The redirect is the product; the log is best-effort and never changes
//     the destination. A bad/deleted code → safe fallback to the app.
//   • Same-visitor dedup (UA+IP hash, 8s) so one scan ≈ one row, not a row
//     per redirect retry. No raw IP / UA stored — only a 16-char hash.
//
// Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (already set, same as /api/pdf).
// ─────────────────────────────────────────────────────────────────────────

import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const FALLBACK = 'https://app.untitledad.in'

// In-memory same-visitor dedup (resets on cold start — fine for a vanity count).
const seen = new Map()
const DEDUPE_MS = 8000
function recentlySeen(key) {
  const now = Date.now()
  if (seen.size > 5000) { for (const [k, t] of seen) if (now - t > DEDUPE_MS) seen.delete(k) }
  const prev = seen.get(key)
  seen.set(key, now)
  return prev !== undefined && (now - prev) < DEDUPE_MS
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405
    return res.end('method not allowed')
  }

  const code = String((req.query && req.query.code) || '').trim()
  if (!code || !SUPABASE_URL || !SERVICE_KEY) {
    res.writeHead(302, { Location: FALLBACK })
    return res.end()
  }

  let target = FALLBACK
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: loc } = await admin.from('campaign_locations')
      .select('id, qr_text').ilike('code', code).maybeSingle()
    if (loc?.qr_text) target = loc.qr_text
    if (loc?.id) {
      const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
      const ua = String(req.headers['user-agent'] || '')
      const uaHash = crypto.createHash('sha256').update(ip + '|' + ua).digest('hex').slice(0, 16)
      if (!recentlySeen(loc.id + ':' + uaHash)) {
        try { await admin.from('qr_scans').insert({ location_id: loc.id, ua_hash: uaHash }) } catch { /* best-effort */ }
      }
    }
  } catch {
    /* lookup/log failed — still redirect to the resolved target / fallback */
  }

  res.writeHead(302, { Location: target })
  return res.end()
}
