// src/utils/sendEmail.js
//
// Phase 235 — client helper for the app's Resend email endpoint (§99).
// Attaches the caller's Supabase JWT (the endpoint verifies it + derives the
// sender's email for reply-to + cc). The endpoint controls the from-address by
// `kind`, so the client only supplies the recipient + content + PDF reference.
//
// Attachment: pass pdfUrl (the branded /pdf link) — Resend fetches it
// server-side (no browser CORS) — OR pdfBase64 for an in-memory PDF.

import { supabase } from '../lib/supabase'

/**
 * Escape user text for safe insertion into the email HTML body.
 */
function esc(s) {
  return String(s || '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

/**
 * Build a simple branded HTML body from plain text + an optional PDF link.
 * Newlines → <br>. The link renders as a button + a plain URL fallback.
 */
export function buildEmailHtml(bodyText, pdfLink) {
  const body = esc(bodyText).replace(/\n/g, '<br>')
  const linkBlock = pdfLink
    ? `<p style="margin:22px 0 6px">
         <a href="${esc(pdfLink)}" style="background:#FFE600;color:#0b1220;font-weight:700;text-decoration:none;padding:12px 20px;border-radius:10px;display:inline-block">View / download the PDF</a>
       </p>
       <p style="margin:0;font-size:12px;color:#6a7590;word-break:break-all">${esc(pdfLink)}</p>`
    : ''
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0b1220">
    <div>${body}</div>
    ${linkBlock}
    <hr style="border:none;border-top:1px solid #e3e6ee;margin:26px 0 14px">
    <div style="font-size:12px;color:#6a7590">Untitled Advertising · Gujarat</div>
  </div>`
}

/**
 * Send an email through /api/email/send. Returns { ok, id } or throws with a
 * readable message. `kind` = 'quote' | 'offer' (picks the from-address + logs).
 */
export async function sendAppEmail({ kind, to, subject, html, pdfUrl, pdfBase64, pdfName, relatedId }) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) throw new Error('You are signed out — sign in again.')
  const res = await fetch('/api/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ kind, to, subject, html, pdfUrl, pdfBase64, pdfName, related_id: relatedId }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data?.ok) {
    throw new Error(data?.detail || data?.error || `Email failed (HTTP ${res.status})`)
  }
  return data
}
