// api/wa/templates.js
// ─────────────────────────────────────────────────────────────────────────
// Campaign — manage Meta message templates from INSIDE the app (so the owner
// never has to open business.facebook.com).
//
//   GET  → list this WABA's templates + their approval status.
//   POST → create + submit a template to Meta (status starts PENDING; Meta
//          reviews; GET reflects the new status).
//
// Auth: caller's Supabase JWT, must be admin / co_owner (mirrors api/wa/send).
// The WABA id comes from the active campaign account's waba_id row; the token
// is CAMPAIGN_WA_TOKEN (server-side only). Self-contained (supabase-js + global
// fetch), no `_`-prefixed helper → Vercel-bundle safe (§35). Touches no
// live-app table (§45).
// ─────────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const WA_TOKEN     = process.env.CAMPAIGN_WA_TOKEN
const GRAPH = 'https://graph.facebook.com/v21.0'

export default async function handler(req, res) {
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'server not configured' })
  if (!WA_TOKEN) return res.status(503).json({ error: 'token_missing', detail: 'CAMPAIGN_WA_TOKEN not set in Vercel.' })

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

  // ── auth: verify JWT, require admin / co_owner ──
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return res.status(401).json({ error: 'no_auth' })
  const { data: ures, error: uerr } = await admin.auth.getUser(token)
  const uid = ures?.user?.id
  if (uerr || !uid) return res.status(401).json({ error: 'bad_auth' })
  const { data: me } = await admin.from('users').select('role').eq('id', uid).maybeSingle()
  if (!me || !['admin', 'co_owner'].includes(me.role)) return res.status(403).json({ error: 'not_allowed' })

  // ── resolve the WABA id from the active campaign account ──
  // Phase 200 — require a COMPLETE account (both ids), same as broadcast.js, so
  // the template list + the send always resolve the SAME account.
  const { data: acct } = await admin.from('whatsapp_accounts')
    .select('waba_id').eq('is_active', true)
    .not('waba_id', 'is', null).not('phone_number_id', 'is', null)
    .order('created_at', { ascending: true }).limit(1).maybeSingle()
  const wabaId = acct?.waba_id
  if (!wabaId) return res.status(409).json({ error: 'no_waba', detail: 'No WhatsApp Business Account id on file yet.' })

  // ── GET: list templates ──
  if (req.method === 'GET') {
    const r = await fetch(`${GRAPH}/${wabaId}/message_templates?fields=name,status,category,language,components&limit=200`, {
      headers: { Authorization: `Bearer ${WA_TOKEN}` },
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return res.status(502).json({ error: 'meta_error', detail: j?.error?.message || `HTTP ${r.status}` })
    return res.status(200).json({ ok: true, templates: j.data || [] })
  }

  // ── POST: create + submit a template ──
  if (req.method === 'POST') {
    let body = req.body
    if (typeof body === 'string') { try { body = JSON.parse(body) } catch { body = {} } }
    const name = String(body?.name || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 60)
    const bodyText = String(body?.body_text || '').trim()
    const category = String(body?.category || 'MARKETING').toUpperCase()
    const language = String(body?.language || 'en')
    const example = String(body?.example || 'Rajesh').trim() || 'Rajesh'
    // Phase 199 — optional media header (image/video/document). header_handle
    // comes from api/wa/media-sample (Meta resumable upload of a sample file).
    const headerFormat = String(body?.header_format || '').trim().toUpperCase()
    const headerHandle = String(body?.header_handle || '').trim()
    if (!name || !bodyText) return res.status(400).json({ error: 'bad_input', detail: 'Name + body required.' })
    if (!['MARKETING', 'UTILITY'].includes(category)) return res.status(400).json({ error: 'bad_category' })
    if (bodyText.length > 1024) return res.status(400).json({ error: 'too_long', detail: 'Body max 1024 chars.' })
    if (headerFormat && !['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerFormat)) {
      return res.status(400).json({ error: 'bad_header', detail: 'Header must be IMAGE, VIDEO or DOCUMENT.' })
    }
    if (headerFormat && !headerHandle) {
      return res.status(400).json({ error: 'no_sample', detail: 'A sample file is required for a media header.' })
    }

    // {{1}} in the body → Meta needs a sample value.
    const hasVar = /\{\{\s*1\s*\}\}/.test(bodyText)
    const components = []
    // A media HEADER (if chosen) must come FIRST in the components array.
    if (headerFormat) {
      components.push({ type: 'HEADER', format: headerFormat, example: { header_handle: [headerHandle] } })
    }
    components.push({
      type: 'BODY',
      text: bodyText,
      ...(hasVar ? { example: { body_text: [[example]] } } : {}),
    })

    const r = await fetch(`${GRAPH}/${wabaId}/message_templates`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, category, language, components }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) {
      return res.status(502).json({ error: 'meta_error', detail: j?.error?.error_user_msg || j?.error?.message || `HTTP ${r.status}` })
    }
    return res.status(200).json({ ok: true, id: j.id || null, status: j.status || 'PENDING', name })
  }

  return res.status(405).json({ error: 'method not allowed' })
}
