// api/wa/send.js
// ─────────────────────────────────────────────────────────────────────────
// Campaign — WhatsApp outbound reply (free-form, inside the 24h window).
//
// A rep types in the campaign inbox → POST here → Meta Cloud API send → we
// log the outbound message (mirrors the inbound row shape from the webhook).
//
// Phase 254 — attachments inside the open 24h window (free-form media is
// allowed by Meta then; outside the window templates are still the only way):
//   • { media_url, media_type: 'image'|'video'|'document', filename? } —
//     sends the media with `text` as its caption. media_url is allow-listed
//     to OUR hosts only (Supabase storage / app.untitledad.in) so a tampered
//     request can't make the business number deliver an arbitrary URL.
//   • { quote_id } — the server resolves the quote's stored PDF
//     (quote-pdfs/<ref>.pdf, §44.9) to a fresh short-lived SIGNED url and
//     sends it as a document. Deliberately NOT the branded /pdf/<ref>?t=
//     302 link — Meta fetches the media server-side and a direct signed URL
//     removes the redirect variable. If the quote has no uploaded PDF yet
//     (never shared once), we 409 with quote_pdf_missing — honest, no
//     server-side render here.
//   Authz for quote_id: the quote must belong to this conversation's lead
//   OR be created by the caller (admin bypasses). All existing gates
//   (role, ownership, window, throttle-free path) unchanged.
//
// Auth: the caller's Supabase JWT is verified and MUST be admin / co_owner
// (the campaign module is privileged). Free-form text is allowed ONLY inside
// the 24h customer-service window; outside it Meta requires an approved
// template, so we 409 early with a clear reason.
//
// Isolation (CLAUDE.md §45)
//   • NEW endpoint, writes ONLY to whatsapp_conversations / whatsapp_messages
//     (campaign tables). No leads / live-table touch. No lead_activities →
//     can't move a score (§33).
//   • Self-contained (supabase-js + global fetch) — no `_`-prefixed helper →
//     Vercel-bundling safe (§35).
//
// Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + CAMPAIGN_WA_TOKEN (the
//   WhatsApp access token — test-number temp token OR the edigiexpert
//   permanent one). The SENDING phone_number_id comes from the conversation's
//   whatsapp_accounts row, not from env.
// ─────────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const WA_TOKEN     = process.env.CAMPAIGN_WA_TOKEN
const GRAPH = 'https://graph.facebook.com/v21.0'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'server not configured' })
  if (!WA_TOKEN) return res.status(503).json({ error: 'token_missing', detail: 'CAMPAIGN_WA_TOKEN is not set in Vercel yet.' })

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // ── auth: verify JWT, require admin / co_owner ──
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return res.status(401).json({ error: 'no_auth' })
  const { data: ures, error: uerr } = await admin.auth.getUser(token)
  const uid = ures?.user?.id
  if (uerr || !uid) return res.status(401).json({ error: 'bad_auth' })
  const { data: me } = await admin.from('users').select('role').eq('id', uid).maybeSingle()
  if (!me) return res.status(403).json({ error: 'not_allowed' })
  const isAdmin = ['admin', 'co_owner'].includes(me.role)   // Phase 205

  // ── body ──
  let body = req.body
  if (typeof body === 'string') { try { body = JSON.parse(body) } catch { body = {} } }
  const conversationId = body?.conversation_id
  const text = String(body?.text || '').trim()
  // Phase 254 — optional attachment (direct media OR a quote's PDF).
  const quoteId   = body?.quote_id ? String(body.quote_id) : null
  let   mediaUrl  = body?.media_url ? String(body.media_url) : null
  let   mediaType = body?.media_type ? String(body.media_type) : null
  let   filename  = body?.filename ? String(body.filename).slice(0, 120) : null
  const hasAttach = !!(mediaUrl || quoteId)
  if (!conversationId || (!text && !hasAttach)) {
    return res.status(400).json({ error: 'conversation_id + text or attachment required' })
  }
  // WhatsApp caps: 4096 chars for a text message, 1024 for a media caption.
  if (!hasAttach && text.length > 4096) return res.status(400).json({ error: 'too_long', detail: 'Max 4096 characters.' })
  if (hasAttach && text.length > 1024) return res.status(400).json({ error: 'too_long', detail: 'Max 1024 characters with an attachment.' })
  if (mediaUrl) {
    if (!['image', 'video', 'document'].includes(mediaType)) {
      return res.status(400).json({ error: 'bad_media_type', detail: 'media_type must be image, video or document.' })
    }
    // Allow-list: only OUR hosts (same class of guard as §101 pdfUrl). Meta
    // fetches this URL server-side — never let a tampered request point the
    // business number at an arbitrary file.
    let host = ''
    try { const u = new URL(mediaUrl); if (u.protocol !== 'https:') throw new Error('not https'); host = u.host } catch {
      return res.status(400).json({ error: 'bad_media_url' })
    }
    let supaHost = ''
    try { supaHost = new URL(SUPABASE_URL).host } catch { /* checked above */ }
    if (host !== supaHost && host !== 'app.untitledad.in') {
      return res.status(400).json({ error: 'bad_media_url', detail: 'Attachment must be hosted on our storage.' })
    }
  }

  // ── conversation → recipient + window + account ──
  const { data: conv } = await admin.from('whatsapp_conversations')
    .select('id, customer_wa_id, window_expires_at, whatsapp_account_id, assigned_to, lead_id')
    .eq('id', conversationId).maybeSingle()
  if (!conv) return res.status(404).json({ error: 'conversation_not_found' })

  // Phase 205 — a non-admin may reply ONLY to a chat assigned to them (or on a
  // lead they own). Admin/co_owner reply to any. Server-enforced — the send runs
  // as service-role, so this gate IS the access control, not the RLS.
  if (!isAdmin) {
    let ok = conv.assigned_to === uid
    if (!ok && conv.lead_id) {
      const { data: ld } = await admin.from('leads').select('assigned_to, telecaller_id').eq('id', conv.lead_id).maybeSingle()
      ok = !!ld && (ld.assigned_to === uid || ld.telecaller_id === uid)
    }
    if (!ok) return res.status(403).json({ error: 'not_allowed', detail: 'This chat is not assigned to you.' })
  }

  const windowOpen = conv.window_expires_at && new Date(conv.window_expires_at).getTime() > Date.now()
  if (!windowOpen) {
    return res.status(409).json({ error: 'window_closed', detail: 'The 24-hour reply window is closed. An approved template is needed to re-open it.' })
  }

  const { data: acct } = await admin.from('whatsapp_accounts')
    .select('phone_number_id').eq('id', conv.whatsapp_account_id).maybeSingle()
  const phoneNumberId = acct?.phone_number_id
  if (!phoneNumberId) return res.status(409).json({ error: 'no_sending_number', detail: 'This conversation has no WhatsApp number on file.' })

  // ── Phase 254: resolve a quote's PDF to a fresh signed URL ──
  if (quoteId) {
    const { data: q, error: qErr } = await admin.from('quotes')
      .select('id, quote_number, lead_id, created_by')
      .eq('id', quoteId).maybeSingle()
    if (qErr || !q) return res.status(404).json({ error: 'quote_not_found' })
    // The quote must be tied to THIS chat's lead, or be the caller's own.
    const tiedToConv = !!conv.lead_id && q.lead_id === conv.lead_id
    if (!tiedToConv && q.created_by !== uid && !isAdmin) {
      return res.status(403).json({ error: 'not_allowed', detail: 'That quote is not linked to this chat.' })
    }
    // The stored PDF is the artifact (§44.9: uploadQuotePDFHtml writes
    // quote-pdfs/<safeRef>.pdf). Exists only once the quote was shared at
    // least once — no PDF yet is an honest 409, not a silent link.
    const safeRef = String(q.quote_number || '').replace(/[^A-Za-z0-9_-]/g, '_')
    if (!safeRef) return res.status(409).json({ error: 'quote_pdf_missing' })
    const { data: signed, error: signErr } = await admin.storage
      .from('quote-pdfs').createSignedUrl(`${safeRef}.pdf`, 600)
    if (signErr || !signed?.signedUrl) {
      return res.status(409).json({
        error: 'quote_pdf_missing',
        detail: 'This quote has no PDF yet — open the quote and share it once to generate it, then retry.',
      })
    }
    mediaUrl = signed.signedUrl
    mediaType = 'document'
    filename = `${q.quote_number}.pdf`
  }

  // ── Meta Cloud API send ──
  // Free-form media is allowed inside the open service window (same rule as
  // free text) — the AI responder already sends city photos this way.
  let payload
  if (mediaUrl) {
    const media = { link: mediaUrl }
    if (text) media.caption = text
    if (mediaType === 'document' && filename) media.filename = filename
    payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: conv.customer_wa_id,
      type: mediaType,
      [mediaType]: media,
    }
  } else {
    payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: conv.customer_wa_id,
      type: 'text',
      text: { preview_url: false, body: text },
    }
  }
  let metaData
  try {
    const resp = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    metaData = await resp.json().catch(() => ({}))
    if (!resp.ok) {
      const detail = metaData?.error?.message || `Meta send failed (HTTP ${resp.status})`
      return res.status(502).json({ error: 'meta_error', detail })
    }
  } catch (e) {
    return res.status(502).json({ error: 'meta_unreachable', detail: String(e?.message || e) })
  }

  // ── log the outbound message (same shape the webhook writes for inbound) ──
  // Phase 254: an attachment logs its marker in the body (§125.1 pattern —
  // log what the customer actually received, text AND attachment) so the
  // inbox never reads as "attachment missing".
  const wamid = metaData?.messages?.[0]?.id || null
  const atIso = new Date().toISOString()
  const logType = mediaUrl ? mediaType : 'text'
  const logBody = mediaUrl
    ? `${text ? `${text}\n\n` : ''}(${mediaType}: ${filename || 'attachment'})`
    : text
  const { data: inserted, error: logErr } = await admin.from('whatsapp_messages').insert({
    conversation_id: conv.id, wamid, direction: 'out', type: logType, body: logBody, at: atIso,
  }).select('id, direction, type, body, status, at').maybeSingle()
  if (logErr) console.error('[wa/send] outbound message logged to Meta but DB insert failed:', logErr.message)
  // bump the thread so it sorts to the top of the inbox
  await admin.from('whatsapp_conversations').update({ updated_at: atIso }).eq('id', conv.id)
  // Phase 246 — a human just replied → pause the AI auto-responder on this
  // thread so it never talks over the rep. SEPARATE update + tolerant so a
  // missing ai_paused column (before the Phase 246 SQL is run) can NEVER break
  // the thread-bump above (§45 no-regression). Result intentionally unchecked.
  try { await admin.from('whatsapp_conversations').update({ ai_paused: true }).eq('id', conv.id) } catch { /* column may be unrun */ }

  return res.status(200).json({
    ok: true, wamid,
    message: inserted || { conversation_id: conv.id, direction: 'out', type: logType, body: logBody, at: atIso },
  })
}
