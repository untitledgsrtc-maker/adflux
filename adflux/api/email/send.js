// api/email/send.js — EDGE runtime (Phase 235)
// ─────────────────────────────────────────────────────────────────────────
// Send an email from the app via Resend (CLAUDE.md §99).
//   • HR offer  (kind='offer') → from hr@untitledad.in
//   • Client quote (kind='quote') → from quotes@untitledad.in
// reply-to + CC = the sending user's own email (server-derived from their JWT,
// so it can't be spoofed). The client's PDF rides as a base64 attachment; the
// branded link goes in the html body (both — §99). Every send is logged to
// email_log.
//
// WHY EDGE, not Node serverless: the Vercel Hobby plan caps a deployment at 12
// *Serverless* Functions and this project is already at 12 (§219 / §99). Edge
// Functions don't count against that cap, so a Node fn here would break every
// deploy. Raw fetch to Supabase REST (no @supabase/supabase-js) — nothing
// Node-only to bundle (§35).
//
// SECURITY / §45:
//   • Auth REQUIRED — verifies the caller's Supabase JWT; any authenticated
//     user may send (owner decision "everyone can send", §99).
//   • from is SERVER-CONTROLLED by `kind` (client can't send from an arbitrary
//     address); reply-to + cc = the AUTHED user's email (not client-supplied).
//   • ONE-TO-ONE ONLY — `to` must be a single valid email. Arrays / comma lists
//     are rejected (no bulk blast — §99 guardrail; bulk needs unsubscribe+consent).
//   • Soft per-user rate limit (in-memory; resets on cold start — fine as a
//     runaway guard, not a billing control).
//   • Writes ONLY to the new email_log table (service role). No live-table touch.
//
// Env: SUPABASE_URL (||VITE_) + SUPABASE_SERVICE_ROLE_KEY + SUPABASE_ANON_KEY
//   (||VITE_) + RESEND_API_KEY (all in Vercel).
// ─────────────────────────────────────────────────────────────────────────

export const config = { runtime: 'edge' }

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON_KEY     = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
const RESEND_KEY   = process.env.RESEND_API_KEY

// from-addresses per kind (server-controlled — the client CANNOT choose these).
const FROM = {
  offer: 'Untitled Advertising <hr@untitledad.in>',
  quote: 'Untitled Advertising <quotes@untitledad.in>',
}

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/

// in-memory per-user soft rate limit (Edge instance memory; best-effort).
const seen = new Map()
const WINDOW_MS = 10 * 60_000
const MAX_PER_WINDOW = 40
function rateLimited(uid) {
  const now = Date.now()
  const arr = (seen.get(uid) || []).filter((t) => now - t < WINDOW_MS)
  if (arr.length >= MAX_PER_WINDOW) { seen.set(uid, arr); return true }
  arr.push(now)
  seen.set(uid, arr)
  if (seen.size > 2000) { for (const [k, v] of seen) if (!v.some((t) => now - t < WINDOW_MS)) seen.delete(k) }
  return false
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } })

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'server_not_configured' }, 500)
  if (!RESEND_KEY) return json({ error: 'resend_key_missing', detail: 'RESEND_API_KEY is not set in Vercel.' }, 503)

  // ── auth: verify the caller's Supabase JWT, get their id + email ──
  const token = String(req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return json({ error: 'no_auth' }, 401)
  let user
  try {
    const ur = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY || SERVICE_KEY, Authorization: `Bearer ${token}` },
    })
    if (!ur.ok) return json({ error: 'bad_auth' }, 401)
    user = await ur.json()
  } catch {
    return json({ error: 'auth_unreachable' }, 502)
  }
  const uid = user?.id
  const senderEmail = String(user?.email || '').trim()
  if (!uid || !senderEmail) return json({ error: 'bad_auth' }, 401)
  if (rateLimited(uid)) return json({ error: 'rate_limited', detail: 'Too many emails just now — wait a few minutes.' }, 429)

  // ── body ──
  let body
  try { body = await req.json() } catch { body = {} }
  const kind = body?.kind === 'offer' ? 'offer' : 'quote'
  const to = String(body?.to || '').trim()
  const subject = String(body?.subject || '').trim()
  const html = String(body?.html || '').trim()
  const pdfBase64 = body?.pdfBase64 ? String(body.pdfBase64) : ''
  const pdfName = String(body?.pdfName || 'document.pdf').trim() || 'document.pdf'
  const relatedId = body?.related_id ? String(body.related_id) : null

  // ONE-TO-ONE ONLY — a single valid recipient (no bulk; §99).
  if (!EMAIL_RE.test(to)) return json({ error: 'bad_recipient', detail: 'Enter one valid email address.' }, 400)
  if (!subject) return json({ error: 'subject_required' }, 400)
  if (!html) return json({ error: 'body_required' }, 400)

  // ── build + send via Resend ──
  const payload = {
    from: FROM[kind],
    to: [to],
    cc: [senderEmail],          // §99 — the sending user gets a visible copy
    reply_to: senderEmail,      // replies come back to the real sender
    subject,
    html,
  }
  if (pdfBase64) payload.attachments = [{ filename: pdfName, content: pdfBase64 }]

  let resendId = null, status = 'sent', errDetail = null
  try {
    const rr = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const rdata = await rr.json().catch(() => ({}))
    if (!rr.ok) {
      status = 'failed'
      errDetail = rdata?.message || rdata?.error?.message || `Resend error (HTTP ${rr.status})`
    } else {
      resendId = rdata?.id || null
    }
  } catch (e) {
    status = 'failed'
    errDetail = String(e?.message || e)
  }

  // ── log every attempt (best-effort; never blocks the response) ──
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/email_log`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        sent_by: uid, to_email: to, subject, kind,
        related_id: relatedId, resend_id: resendId, status,
      }),
    })
  } catch { /* logging is best-effort */ }

  if (status === 'failed') return json({ error: 'send_failed', detail: errDetail }, 502)
  return json({ ok: true, id: resendId })
}
