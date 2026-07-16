// api/wa/send.js
// ─────────────────────────────────────────────────────────────────────────
// Campaign — WhatsApp outbound reply (free-form text, inside the 24h window).
//
// A rep types in the campaign inbox → POST here → Meta Cloud API send → we
// log the outbound message (mirrors the inbound row shape from the webhook).
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
  if (!conversationId || !text) return res.status(400).json({ error: 'conversation_id + text required' })
  if (text.length > 4096) return res.status(400).json({ error: 'too_long', detail: 'Max 4096 characters.' })

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

  // ── Meta Cloud API send ──
  let metaData
  try {
    const resp = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: conv.customer_wa_id,
        type: 'text',
        text: { preview_url: false, body: text },
      }),
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
  const wamid = metaData?.messages?.[0]?.id || null
  const atIso = new Date().toISOString()
  const { data: inserted, error: logErr } = await admin.from('whatsapp_messages').insert({
    conversation_id: conv.id, wamid, direction: 'out', type: 'text', body: text, at: atIso,
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
    message: inserted || { conversation_id: conv.id, direction: 'out', type: 'text', body: text, at: atIso },
  })
}
