// api/wa/webhook.js
// ─────────────────────────────────────────────────────────────────────────
// Campaign module — C4: WhatsApp Cloud API RECEIVE-ONLY webhook.
//
// What it does
//   GET  → Meta webhook verification handshake (echoes hub.challenge when
//          the verify token matches).
//   POST → inbound message / status events. Verifies the Meta
//          X-Hub-Signature-256 HMAC against the App Secret, writes a
//          PII-stripped audit row to `webhook_event_log`, THEN (C4-store)
//          persists the conversation + inbound message to the new campaign
//          tables, and replies 200.
//
// What it deliberately does NOT do (yet)
//   NO lead write, NO auto-reply, NO outbound send. Lead creation is C4.5
//   (guarded: P0-1 dedup + P0-2 routing); reply is C5 (needs the token).
//   C4-store writes ONLY to new Phase-C2 tables (whatsapp_accounts /
//   whatsapp_conversations / whatsapp_messages) — zero touch to `leads` or
//   any live/§28 table, so it runs on production with zero risk to a live
//   lead or hot path (CLAUDE.md §45 + §46).
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

// Pull the human-readable text out of a Meta inbound message across the
// common types. Media (image/doc/audio) carries no text → null body, the
// `type` column still records what arrived.
function messageBody(m) {
  return (
    m.text?.body ??
    m.button?.text ??
    m.interactive?.button_reply?.title ??
    m.interactive?.list_reply?.title ??
    null
  )
}

// C8 — pull the QR board code from a pre-filled scan message, e.g.
// "Hi, saw your screen at MG Road [RR-AHM-01]". The first [bracketed] token
// of letters/digits/hyphens, uppercased for the case-insensitive
// campaign_locations lookup. null when none (a manually-typed message).
function extractCampaignCode(body) {
  if (!body) return null
  const m = String(body).match(/\[([A-Za-z0-9][A-Za-z0-9-]{0,39})\]/)
  return m ? m[1].toUpperCase() : null
}

// ── C4-store ──────────────────────────────────────────────────────────────
// Persist the conversation + inbound message to the NEW campaign tables
// (whatsapp_accounts / whatsapp_conversations / whatsapp_messages). This is
// the data layer the Inbox (C5) reads. It writes ONLY to new Phase-C2 tables
// via the service role — zero touch to `leads` or any live/§28 table. Lead
// creation is C4.5 (separate, guarded). Best-effort: any failure is swallowed
// so the 200 to Meta is never blocked (a dropped message is re-sent by Meta;
// the wamid UNIQUE makes the retry idempotent).
async function storeInbound(payload) {
  if (!SUPABASE_URL || !SERVICE_KEY) return { ok: false, error: 'no supabase creds', stored: 0 }
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  // Defensive cap on total messages stored per request — mirrors the
  // webhook_event_log 500-row clamp (§13 #4 DoS guard). Only a valid-HMAC
  // sender (Meta) reaches here and Meta batches modestly, but never let one
  // verified payload fan out into hundreds of serial writes.
  let stored = 0
  const STORE_CAP = 200
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const v = change.value || {}
      const meta = v.metadata || {}
      const phoneNumberId = meta.phone_number_id || null
      const inbound = v.messages || []
      if (!phoneNumberId || inbound.length === 0) continue

      // Resolve (or self-provision) the receiving account by phone_number_id.
      // The phone_number_id UNIQUE index is PARTIAL (`WHERE phone_number_id IS
      // NOT NULL`) and PostgREST upsert can't target a partial index (Postgres
      // 42P10) — so SELECT-then-INSERT, never .upsert(onConflict). The INSERT
      // tolerates a concurrent-insert 23505 by re-selecting. Never overwrites
      // an existing row → an owner-set default_telecaller_id (C4.5 routing) is
      // preserved; the auto-created row has none → C4.5 safely error-queues.
      let acct = (await admin.from('whatsapp_accounts')
        .select('id').eq('phone_number_id', phoneNumberId).maybeSingle()).data
      if (!acct) {
        const ins = await admin.from('whatsapp_accounts')
          .insert({ provider: 'cloud_api', phone_number_id: phoneNumberId, display_number: meta.display_phone_number || null })
          .select('id').maybeSingle()
        if (ins.error && ins.error.code !== '23505') {
          return { ok: false, error: 'account insert: ' + ins.error.message, stored }
        }
        acct = ins.data
          || (await admin.from('whatsapp_accounts').select('id').eq('phone_number_id', phoneNumberId).maybeSingle()).data
      }
      const accountId = acct?.id
      if (!accountId) continue

      const nowIso = new Date().toISOString()
      const windowIso = new Date(Date.now() + 24 * 3600 * 1000).toISOString()

      for (const m of inbound) {
        if (stored >= STORE_CAP) return { ok: true, stored }
        const customerWaId = m.from
        if (!customerWaId) continue

        // Conversation: the (account, customer) UNIQUE index is NOT partial →
        // upsert(onConflict) is valid here. This object updates ONLY these
        // columns on conflict — lead_id / assigned_to (set by C4.5 later) are
        // NOT in it, so they survive.
        const convRow = {
          whatsapp_account_id: accountId,
          customer_wa_id: customerWaId,
          last_inbound_at: nowIso,
          window_expires_at: windowIso,
          status: 'open',
          updated_at: nowIso,
        }
        // C8 — QR board attribution. The QR pre-fills "[CODE]" in the scan
        // text; match campaign_locations → stamp campaign_id + location_id so
        // C4.5 routes by that campaign + tags the lead with the board. Only
        // set when a code matches (so a later non-coded message can't blank an
        // already-attributed conversation).
        const code = extractCampaignCode(messageBody(m))
        if (code) {
          const { data: loc } = await admin.from('campaign_locations')
            .select('id, campaign_id').ilike('code', code).maybeSingle()
          if (loc?.id) {
            convRow.campaign_id = loc.campaign_id
            convRow.location_id = loc.id
          }
        }

        const conv = await admin.from('whatsapp_conversations').upsert(
          convRow,
          { onConflict: 'whatsapp_account_id,customer_wa_id' },
        ).select('id').maybeSingle()
        if (conv.error) return { ok: false, error: 'conversation: ' + conv.error.message, stored }
        const convId = conv.data?.id
        if (!convId) continue

        // Message: the wamid UNIQUE index is also PARTIAL → plain INSERT and
        // tolerate the duplicate (23505) for Meta-retry idempotency, not upsert.
        const atIso = m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : nowIso
        const msg = await admin.from('whatsapp_messages').insert({
          conversation_id: convId,
          wamid: m.id || null,
          direction: 'in',
          type: m.type || 'text',
          body: messageBody(m),
          at: atIso,
        })
        if (msg.error && msg.error.code !== '23505') {
          return { ok: false, error: 'message: ' + msg.error.message, stored }
        }
        stored++
      }
    }
  }
  return { ok: true, stored }
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

  // C4-store — persist the conversation + inbound message to the new campaign
  // tables (the Inbox/C5 data layer). Best-effort; a failure never blocks the
  // 200 to Meta (Meta re-sends; the wamid UNIQUE keeps the retry idempotent).
  let storeResult = null
  try {
    storeResult = await storeInbound(payload)
  } catch (e) {
    storeResult = { ok: false, error: 'threw: ' + (e?.message || String(e)), stored: 0 }
    try { console.error('[wa/webhook] store failed') } catch { /* noop */ }
  }

  await logEvents(rows)
  const out = { received: true, count: rows.length }
  // ?debug=1 surfaces the store outcome in the reply — gated behind the HMAC
  // (only a valid-signature caller reaches here) and Meta never sends it, so
  // production replies are unchanged. Used by scripts/test-wa-webhook.sh.
  if (req.query && req.query.debug === '1') out.store = storeResult
  return res.status(200).json(out)
}
