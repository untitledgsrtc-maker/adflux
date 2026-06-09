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
// QR fallback = the campaign WhatsApp number — a scan must ALWAYS land in
// WhatsApp, NEVER the app login. (Dynamic per-account lookup runs first; this
// is the absolute last resort if no account row is configured.)
const FALLBACK = 'https://wa.me/919581578261?text=Hi'

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

  let target = ''
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
    // Unknown / deleted code, or a board with no wa link → open WhatsApp on the
    // campaign number anyway (generic), NEVER the app login page. A QR scan must
    // always land in WhatsApp, not a sign-in screen.
    if (!target) {
      const { data: acct } = await admin.from('whatsapp_accounts')
        .select('display_number').eq('is_active', true)
        .order('created_at', { ascending: true }).limit(1).maybeSingle()
      const d = String(acct?.display_number || '').replace(/\D/g, '')
      const wa = d.length === 10 ? '91' + d : d
      if (wa.length >= 11) target = `https://wa.me/${wa}?text=${encodeURIComponent('Hi')}`
    }
  } catch {
    /* lookup/log failed — still redirect to the resolved target / fallback */
  }

  if (!target) target = FALLBACK   // absolute last resort (no active number configured)

  // Return a tiny redirect PAGE (not a bare 302). Embedded in-app browsers (the
  // phone-camera preview, social-app cameras) don't always follow a 302 to a
  // wa.me / app-launch URL — a meta-refresh + JS replace + a visible "Open
  // WhatsApp" button covers every case. no-store stops a stale redirect from
  // being cached. NEVER renders the app login.
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store, max-age=0')
  return res.end(
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta http-equiv="refresh" content="0;url=' + esc(target) + '">' +
    '<title>Opening WhatsApp…</title>' +
    '<script>location.replace(' + JSON.stringify(target) + ')</script>' +
    '<style>html,body{height:100%}body{margin:0;font-family:-apple-system,system-ui,"Segoe UI",Roboto,sans-serif;' +
    'background:#0b1220;color:#f5f7fb;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px}' +
    'a{background:#25D366;color:#0b1220;font-weight:700;padding:14px 24px;border-radius:12px;text-decoration:none;display:inline-block;margin-top:16px}</style>' +
    '</head><body><div><div style="font-size:15px;opacity:.85">Opening WhatsApp…</div>' +
    '<a href="' + esc(target) + '">Open WhatsApp</a></div></body></html>'
  )
}
