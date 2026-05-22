// Vercel dynamic route: /api/pdf/<ref>?t=<token>
//
// Phase 85.1 — signed-URL flow for quote PDFs.
//
// Audit 24 May 2026 (P0): the quote-pdfs bucket is public-read +
// the file path is the sequential quote ref (UA-2026-NNNN.pdf).
// Anyone could enumerate every PDF you ever sent.
//
// This route gates access behind a `?t=TOKEN` query param backed
// by the `pdf_share_tokens` table (Phase 85.1 SQL). The token is
// generated at upload time, 90-day expiry, opaque random string.
//
// Successful flow:
//   GET /api/pdf/UA-2026-0057?t=Abc123...
//   → DB lookup: token valid, not expired, matches quote ref
//   → service role issues 60-second signed URL for the bucket file
//   → 302 redirect to that signed URL
//
// Failure modes:
//   • Missing token       → 401
//   • Unknown token       → 401
//   • Expired token       → 410 Gone
//   • Token-quote mismatch → 403
//   • Quote not found     → 404
//   • Service role missing → 500
//
// Env required:
//   SUPABASE_URL                — server-side, no VITE_ prefix
//   SUPABASE_SERVICE_ROLE_KEY   — bypasses RLS for the read +
//                                 signed-URL generation. NEVER
//                                 ship to browser. Set in Vercel
//                                 dashboard → Settings → Env vars.
//
// vercel.json was previously rewriting `/pdf/(.*)` directly to the
// Supabase public storage URL (Phase 81.4.1). For tokens to be
// validated, that rewrite must NOT bypass the API. Solution:
// `/pdf/<ref>?t=...` matches this dynamic route (Next/Vercel
// file-based routing). Backward-compat for the old direct rewrite
// (no `?t=`) keeps working through Phase 85.1b transition window.

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

export default async function handler(req, res) {
  const ref   = req.query?.ref
  const token = req.query?.t

  if (!ref || typeof ref !== 'string') {
    return res.status(400).json({ error: 'Missing quote ref' })
  }
  if (!token || typeof token !== 'string' || token.length < 16) {
    return res.status(401).json({ error: 'Missing or malformed share token' })
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({ error: 'Server PDF auth not configured (SUPABASE_SERVICE_ROLE_KEY missing)' })
  }

  // Service-role client bypasses RLS for the validation lookup +
  // signed-URL generation. This client MUST stay server-side.
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // 1. Validate token + expiry + match to a real quote with this ref.
  const { data: row, error: lookupErr } = await admin
    .from('pdf_share_tokens')
    .select('id, quote_id, expires_at, quotes:quote_id(quote_number)')
    .eq('token', token)
    .maybeSingle()

  if (lookupErr) {
    return res.status(500).json({ error: 'Token lookup failed' })
  }
  if (!row) {
    return res.status(401).json({ error: 'Invalid share token' })
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return res.status(410).json({ error: 'Share link expired. Ask the rep for a fresh link.' })
  }
  const dbRef = row.quotes?.quote_number
  if (!dbRef) {
    return res.status(404).json({ error: 'Quote no longer exists' })
  }
  // Mismatch protects against an attacker reusing a token from
  // one quote with a different ref in the URL.
  if (dbRef !== ref) {
    return res.status(403).json({ error: 'Token does not match this quote ref' })
  }

  // 2. Issue a short-lived signed URL. 60s is plenty for the 302
  // redirect to complete; the browser follows immediately and the
  // signature is never re-validated.
  const safeRef  = ref.replace(/[^A-Za-z0-9_-]/g, '_')
  const filePath = `${safeRef}.pdf`
  const { data: signed, error: signErr } = await admin
    .storage
    .from('quote-pdfs')
    .createSignedUrl(filePath, 60)

  if (signErr || !signed?.signedUrl) {
    return res.status(404).json({ error: 'PDF file not in storage. Regenerate the quote PDF.' })
  }

  // 3. Redirect.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
  res.setHeader('Location', signed.signedUrl)
  return res.status(302).end()
}
