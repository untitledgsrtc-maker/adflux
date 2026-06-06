// api/wa/webhook.js
// ─────────────────────────────────────────────────────────────────────────
// Campaign module — C4: WhatsApp Cloud API RECEIVE-ONLY webhook.
//
// What it does
//   GET  → Meta webhook verification handshake (echoes hub.challenge when
//          the verify token matches).
//   POST → inbound message / status events. Verifies the Meta
//          X-Hub-Signature-256 HMAC against the App Secret, then writes a
//          PII-stripped audit row to `webhook_event_log` and replies 200.
//
// What it deliberately does NOT do (yet)
//   NO lead write, NO conversation/message store, NO reply. That is C4.5 /
//   C5. This file only proves the pipe: Meta → us, signature valid,
//   idempotent-ish audit. Keeping the first deploy lead-free means it can
//   run on production with zero risk to a live lead (CLAUDE.md §45 + §46).
//
// Isolation (CLAUDE.md §45 — live app is untouchable)
//   • Brand-new endpoint. No existing code calls it.
//   • Writes ONLY to `webhook_event_log` (a new Phase-C2 table) via the
//     service role. Touches no existing table, trigger, or hot path.
//   • Replies fast: a single tiny insert, no joins, no existing-table reads.
//
// Env (Vercel, untitled-os) — set in Project Settings → Environment Variables
//   CAMPAIGN_WEBHOOK_VERIFY_TOKEN — the verify token you also paste into Meta
//   CAMPAIGN_APP_SECRET           — your Meta app's App Secret (HMAC key)
//   SUPABASE_URL                  — already set (used by /api/pdf)
//   SUPABASE_SERVICE_ROLE_KEY     — already set (used by /api/pdf)
// ─────────────────────────────────────────────────────────────────────────

import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'

// Raw body is required for an exact HMAC match, so disable Vercel's JSON
// body parser and read the stream ourselves.
export const config = { api: { bodyParser: false } }

const VERIFY_TOKEN = process.env.CAMPAIGN_WEBHOOK_VERIFY_TOKEN
const APP_SECRET   = process.env.CAMPAIGN_APP_SECRET
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

// Last 4 digits only — never log a full phone number (PII minimization).
function last4(s) {
  const d = String(s || '').replace(/\D/g, '')
  return d ? '…' + d.slice(-4) : '?'
}

// Best-effort audit write. Never throws into the request path — the 200
// reply to Meta matters more than the log row.
async function logEvents(rows) {
  if (!SUPABASE_URL || !SERVICE_KEY) return
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    await admin.from('webhook_event_log').insert(rows)
  } catch {
    // Best-effort: never block the 200 to Meta. Surface a bare signal in
    // Vercel logs (no row content, no key) so a broken audit pipe is visible.
    try { console.error('[wa/webhook] audit insert failed') } catch { /* noop */ }
  }
}

// Clamp a Meta enum string going into the `note` column (defensive — these
// are short enums in practice, but never let a verified payload bloat a row).
function clip(s) {
  return String(s ?? '?').slice(0, 40)
}

export default async function handler(req, res) {
  // ── GET: Meta verification handshake ──
  if (req.method === 'GET') {
    const q = req.query || {}
    const mode      = q['hub.mode']
    const token     = q['hub.verify_token']
    const challenge = q['hub.challenge']
    if (mode === 'subscribe' && VERIFY_TOKEN && token === VERIFY_TOKEN) {
      res.setHeader('Content-Type', 'text/plain')
      return res.status(200).send(String(challenge ?? ''))
    }
    return res.status(403).json({ error: 'verify token mismatch' })
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' })
  }

  // ── POST: inbound events ──
  let raw
  try {
    raw = await readRawBody(req)
  } catch {
    return res.status(400).json({ error: 'could not read body' })
  }

  // Verify X-Hub-Signature-256 (format: "sha256=<hex>") against the App
  // Secret. Constant-time compare. Reject anything that doesn't match —
  // an unauthenticated POST never reaches the audit table as "ok".
  let signatureOk = false
  const sigHeader = String(req.headers['x-hub-signature-256'] || '')
  if (APP_SECRET && sigHeader.startsWith('sha256=')) {
    const expected =
      'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(raw).digest('hex')
    try {
      const a = Buffer.from(sigHeader)
      const b = Buffer.from(expected)
      signatureOk = a.length === b.length && crypto.timingSafeEqual(a, b)
    } catch {
      signatureOk = false
    }
  }

  if (!signatureOk) {
    await logEvents([{
      provider: 'whatsapp',
      event_id: null,
      signature_ok: false,
      http_status: 401,
      note: 'bad or missing signature',
    }])
    return res.status(401).json({ error: 'bad signature' })
  }

  // Signature valid — parse the payload and log each event (PII-stripped).
  let payload = {}
  try {
    payload = JSON.parse(raw.toString('utf8'))
  } catch {
    /* malformed JSON from a verified sender — still log + 200 below */
  }

  const rows = []
  try {
    for (const entry of payload.entry || []) {
      for (const change of entry.changes || []) {
        const v = change.value || {}
        for (const m of v.messages || []) {
          rows.push({
            provider: 'whatsapp',
            event_id: m.id || null, // wamid — the per-message idempotency key (used at C4.5)
            signature_ok: true,
            http_status: 200,
            note: `inbound ${clip(m.type)} from ${last4(m.from)}`,
          })
        }
        for (const st of v.statuses || []) {
          rows.push({
            provider: 'whatsapp',
            event_id: st.id || null,
            signature_ok: true,
            http_status: 200,
            note: `status ${clip(st.status)} ${last4(st.recipient_id)}`,
          })
        }
      }
    }
  } catch {
    /* unexpected shape — fall through, still 200 so Meta stops retrying */
  }

  if (rows.length === 0) {
    rows.push({
      provider: 'whatsapp',
      event_id: null,
      signature_ok: true,
      http_status: 200,
      note: 'verified payload, no messages/statuses',
    })
  }

  // Bound worst-case insert size. Only a valid-HMAC sender (Meta) reaches
  // here and Meta batches modestly, but cap defensively all the same.
  if (rows.length > 500) rows.length = 500

  await logEvents(rows)
  return res.status(200).json({ received: true, count: rows.length })
}
