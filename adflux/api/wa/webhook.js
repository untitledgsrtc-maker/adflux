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
const WA_TOKEN     = process.env.CAMPAIGN_WA_TOKEN   // C7 auto-reply send (server-side only)
const GRAPH        = 'https://graph.facebook.com/v21.0'

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
    m.image?.caption ??
    m.video?.caption ??
    m.document?.caption ??
    m.document?.filename ??
    m.button?.text ??
    m.interactive?.button_reply?.title ??
    m.interactive?.list_reply?.title ??
    null
  )
}

// Media (image/video/audio/document/sticker) carries a Meta media id; capture
// it + the mime so api/wa/media can fetch the bytes on demand for the Inbox.
function mediaInfo(m) {
  const o = m && m.type ? m[m.type] : null
  return (o && typeof o === 'object' && o.id)
    ? { id: String(o.id), mime: o.mime_type || null }
    : { id: null, mime: null }
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
  const autoReplied = new Set()   // C7 — one auto-reply per conversation per webhook call
  let botRules = null             // chatbot rules, lazy-loaded once per webhook call
  async function getBotRules() {
    if (botRules) return botRules
    // Phase 203 — pull media_url/type too, tolerant when the columns aren't run.
    let { data, error } = await admin.from('campaign_bot_rules')
      .select('keywords, reply, media_url, media_type, is_active, display_order').order('display_order', { ascending: true })
    if (error && /media_url|media_type|could not find|column/i.test(error.message || '')) {
      ;({ data } = await admin.from('campaign_bot_rules')
        .select('keywords, reply, is_active, display_order').order('display_order', { ascending: true }))
    }
    botRules = (data || []).filter((r) => r.is_active !== false)
    return botRules
  }
  // Log a bot-sent outbound (tagged via_bot so it never counts as a human
  // reply). Tolerant: retry without via_bot if the chatbot SQL isn't run yet.
  async function logBotOut(cid, wamid, text) {
    const row = { conversation_id: cid, wamid: wamid || null, direction: 'out', type: 'text', body: text, status: 'sent', at: new Date().toISOString(), via_bot: true }
    const r = await admin.from('whatsapp_messages').insert(row)
    if (r.error && /via_bot|could not find|column/i.test(r.error.message || '')) {
      const { via_bot, ...rest } = row   // eslint-disable-line no-unused-vars
      await admin.from('whatsapp_messages').insert(rest)
    }
  }
  // Phase 203 — replace {{1}} / {{name}} with the customer's WhatsApp name
  // (falls back to "there" when the profile name is hidden).
  function personalize(text, name) {
    const n = (name && String(name).trim()) || 'there'
    return String(text || '').replace(/\{\{\s*1\s*\}\}/g, n).replace(/\{\{\s*name\s*\}\}/gi, n)
  }
  // Phase 203 — send a bot message: media (image/video/document) with a caption
  // when a media URL is set, else plain text. Bot replies are free service
  // messages, so a media link is allowed (no template/approval needed).
  async function botSend(pnid, to, text, mediaUrl, mediaType) {
    const mt = String(mediaType || '').toLowerCase()
    let payload
    if (mediaUrl && ['image', 'video', 'document'].includes(mt)) {
      const obj = { link: mediaUrl }
      if (text) obj.caption = text
      if (mt === 'document') obj.filename = 'document.pdf'
      payload = { messaging_product: 'whatsapp', to, type: mt, [mt]: obj }
    } else {
      payload = { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }
    }
    return fetch(`${GRAPH}/${pnid}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  }
  // Phase 204 — greeting tap-buttons. Cached per webhook call; tolerant when the
  // table isn't run yet (falls back to no buttons → plain text/media greeting).
  let botButtons = null
  async function getButtons(accountId) {
    if (botButtons) return botButtons
    const { data, error } = await admin.from('campaign_bot_buttons')
      .select('id, label, position, action, reply_text, media_url, media_type, is_active')
      .eq('whatsapp_account_id', accountId).order('position', { ascending: true })
    botButtons = error ? [] : (data || []).filter((b) => b.is_active !== false)
    return botButtons
  }
  // Send the greeting as a WhatsApp interactive message: 1-3 buttons = reply
  // buttons (media header allowed); 4-10 = a list message (text header only).
  async function botSendButtons(pnid, to, bodyText, buttons, headerUrl, headerType) {
    const rows = (buttons || []).slice(0, 10)
    const mt = String(headerType || '').toLowerCase()
    let interactive
    if (rows.length <= 3) {
      interactive = {
        type: 'button',
        body: { text: bodyText || '…' },
        action: { buttons: rows.map((b) => ({ type: 'reply', reply: { id: `btn_${b.id}`, title: String(b.label || '').slice(0, 20) } })) },
      }
      if (headerUrl && ['image', 'video', 'document'].includes(mt)) {
        interactive.header = mt === 'document'
          ? { type: 'document', document: { link: headerUrl, filename: 'document.pdf' } }
          : { type: mt, [mt]: { link: headerUrl } }
      }
    } else {
      interactive = {
        type: 'list',
        body: { text: bodyText || '…' },
        action: { button: 'Choose', sections: [{ title: 'Options', rows: rows.map((b) => ({ id: `btn_${b.id}`, title: String(b.label || '').slice(0, 24) })) }] },
      }
    }
    return fetch(`${GRAPH}/${pnid}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'interactive', interactive }),
    })
  }
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const v = change.value || {}
      const meta = v.metadata || {}
      const phoneNumberId = meta.phone_number_id || null

      // Delivery-status callbacks (sent/delivered/read/failed) — Meta sends
      // these for OUTBOUND messages. Match the wamid to a broadcast recipient
      // (the funnel) and/or an inbox message (the ✓✓ ticks). Best-effort;
      // terminal 'read'/'failed' are never downgraded by a late callback.
      for (const s of (v.statuses || [])) {
        const swamid = s && s.id; const sstatus = s && s.status
        if (!swamid || !sstatus) continue
        try {
          await admin.from('broadcast_recipients').update({ status: sstatus })
            .eq('wamid', swamid).not('status', 'in', '(read,failed)')
          await admin.from('whatsapp_messages').update({ status: sstatus })
            .eq('wamid', swamid).not('status', 'in', '(read,failed)')
        } catch { /* best-effort — status capture must never break receive */ }
      }

      const inbound = v.messages || []
      if (!phoneNumberId || inbound.length === 0) continue

      // C11 — capture each sender's WhatsApp profile name (value.contacts[]).
      const nameByWa = {}
      for (const c of (v.contacts || [])) {
        if (c && c.wa_id && c.profile && c.profile.name) {
          nameByWa[String(c.wa_id).replace(/\D/g, '')] = String(c.profile.name)
        }
      }

      // Resolve (or self-provision) the receiving account by phone_number_id.
      // The phone_number_id UNIQUE index is PARTIAL (`WHERE phone_number_id IS
      // NOT NULL`) and PostgREST upsert can't target a partial index (Postgres
      // 42P10) — so SELECT-then-INSERT, never .upsert(onConflict). The INSERT
      // tolerates a concurrent-insert 23505 by re-selecting. Never overwrites
      // an existing row → an owner-set default_telecaller_id (C4.5 routing) is
      // preserved; the auto-created row has none → C4.5 safely error-queues.
      // select('*') so the C7 auto-reply config (auto_reply_text / _enabled)
      // comes through when present, and never errors when the C7 SQL is unrun.
      let acct = (await admin.from('whatsapp_accounts')
        .select('*').eq('phone_number_id', phoneNumberId).maybeSingle()).data
      if (!acct) {
        const ins = await admin.from('whatsapp_accounts')
          .insert({ provider: 'cloud_api', phone_number_id: phoneNumberId, display_number: meta.display_phone_number || null })
          .select('id').maybeSingle()
        if (ins.error && ins.error.code !== '23505') {
          return { ok: false, error: 'account insert: ' + ins.error.message, stored }
        }
        acct = ins.data
          || (await admin.from('whatsapp_accounts').select('*').eq('phone_number_id', phoneNumberId).maybeSingle()).data
      }
      const accountId = acct?.id
      if (!accountId) continue

      const nowIso = new Date().toISOString()
      const windowIso = new Date(Date.now() + 24 * 3600 * 1000).toISOString()

      for (const m of inbound) {
        if (stored >= STORE_CAP) return { ok: true, stored }
        const customerWaId = m.from
        if (!customerWaId) continue
        const customerName = nameByWa[String(customerWaId).replace(/\D/g, '')] || null

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
        if (customerName) convRow.customer_name = customerName
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

        // C7 — detect a NEW conversation (the customer's first-ever message)
        // BEFORE the upsert creates it, so the auto-reply fires exactly once.
        const preConv = await admin.from('whatsapp_conversations')
          .select('id, window_expires_at').eq('whatsapp_account_id', accountId)
          .eq('customer_wa_id', customerWaId).maybeSingle()
        const isNewConv = !preConv.data
        // Phase 202 — also greet a RETURNING lead whose 24h service window had
        // already closed before this message (re-engagement). Won't spam an
        // active chat (window still open → no re-greet).
        const windowWasClosed = !!preConv.data?.window_expires_at
          && new Date(preConv.data.window_expires_at) < new Date(nowIso)

        let conv = await admin.from('whatsapp_conversations').upsert(
          convRow,
          { onConflict: 'whatsapp_account_id,customer_wa_id' },
        ).select('id').maybeSingle()
        // C11 customer_name column not added yet → retry WITHOUT it so the
        // conversation store never breaks on an optional column (§45).
        if (conv.error && /customer_name|could not find|column/i.test(conv.error.message || '')) {
          const { customer_name, ...rest } = convRow   // eslint-disable-line no-unused-vars
          conv = await admin.from('whatsapp_conversations').upsert(
            rest,
            { onConflict: 'whatsapp_account_id,customer_wa_id' },
          ).select('id').maybeSingle()
        }
        if (conv.error) return { ok: false, error: 'conversation: ' + conv.error.message, stored }
        const convId = conv.data?.id
        if (!convId) continue

        // Message: the wamid UNIQUE index is also PARTIAL → plain INSERT and
        // tolerate the duplicate (23505) for Meta-retry idempotency, not upsert.
        const atIso = m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : nowIso
        const media = mediaInfo(m)
        const baseRow = {
          conversation_id: convId,
          wamid: m.id || null,
          direction: 'in',
          type: m.type || 'text',
          body: messageBody(m),
          at: atIso,
        }
        let msg = await admin.from('whatsapp_messages')
          .insert({ ...baseRow, media_id: media.id, media_mime: media.mime })
        // media_id/media_mime columns not added yet → retry WITHOUT them so the
        // store NEVER breaks regardless of when the C5 media SQL is run (§45).
        if (msg.error && /media_id|media_mime|could not find|column/i.test(msg.error.message || '')) {
          msg = await admin.from('whatsapp_messages').insert(baseRow)
        }
        if (msg.error && msg.error.code !== '23505') {
          return { ok: false, error: 'message: ' + msg.error.message, stored }
        }
        stored++
        let repliedThisMsg = false

        // C7 — auto-reply once on a new customer's first message. Free-form is
        // allowed (their inbound just opened the 24h service window) and free.
        // Best-effort: a send failure NEVER affects the store or the 200 to Meta.
        if ((isNewConv || windowWasClosed) && convId && !autoReplied.has(convId) && autoReplied.size < 25
            && WA_TOKEN && acct && acct.auto_reply_enabled && acct.auto_reply_text) {
          autoReplied.add(convId)
          try {
            const wtext = personalize(acct.auto_reply_text, customerName)
            const btns = await getButtons(accountId)   // Phase 204 — tap-buttons
            const r = btns.length
              ? await botSendButtons(phoneNumberId, customerWaId, wtext, btns, acct.auto_reply_media_url, acct.auto_reply_media_type)
              : await botSend(phoneNumberId, customerWaId, wtext, acct.auto_reply_media_url, acct.auto_reply_media_type)
            if (r.ok) {
              const j = await r.json().catch(() => ({}))
              await logBotOut(convId, j?.messages?.[0]?.id || null, wtext)
              repliedThisMsg = true
            }
          } catch { /* best-effort — auto-reply must never break receive */ }
        }

        // Phase 204 — the customer TAPPED a greeting button → run that button's
        // action (send a reply/media, or hand off to a human). Takes priority
        // over keyword matching. Always allowed (a tap is an explicit request).
        if (!repliedThisMsg && m.type === 'interactive' && convId && WA_TOKEN && acct) {
          const ir = m.interactive || {}
          const btnId = String(ir.button_reply?.id || ir.list_reply?.id || '')
          if (btnId.startsWith('btn_')) {
            try {
              const btns = await getButtons(accountId)
              const b = btns.find((x) => `btn_${x.id}` === btnId)
              if (b && b.action === 'handoff') {
                const hmsg = 'Thanks! Connecting you with our team — someone will reply shortly.'
                const hr = await botSend(phoneNumberId, customerWaId, hmsg)
                if (hr.ok) { const hj = await hr.json().catch(() => ({})); await logBotOut(convId, hj?.messages?.[0]?.id || null, hmsg) }
                repliedThisMsg = true
              } else if (b && (b.reply_text || b.media_url)) {
                const rtext = personalize(b.reply_text, customerName)
                const rr = await botSend(phoneNumberId, customerWaId, rtext, b.media_url, b.media_type)
                if (rr.ok) { const rj = await rr.json().catch(() => ({})); await logBotOut(convId, rj?.messages?.[0]?.id || null, rtext || '[media]') }
                repliedThisMsg = true
              }
            } catch { /* best-effort — button action must never break receive */ }
          }
        }

        // Chatbot — keyword auto-responder. Runs only when the bot is ON, this
        // message wasn't just auto-replied, and NO human (telecaller) has yet
        // replied in this chat → the bot pauses the moment a human takes over.
        // Best-effort: a failure NEVER affects the store or the 200 to Meta.
        if (!repliedThisMsg && convId && WA_TOKEN && acct && acct.bot_enabled) {
          try {
            const { data: humanOut } = await admin.from('whatsapp_messages')
              .select('id').eq('conversation_id', convId).eq('direction', 'out')
              .not('via_bot', 'is', true).limit(1)
            if (!humanOut || !humanOut.length) {
              const text = String(messageBody(m) || '').toLowerCase()
              const rules = await getBotRules()
              const hit = rules.find((rule) => (rule.keywords || []).some((k) => k && text.includes(String(k).toLowerCase())))
              if (hit && (hit.reply || hit.media_url)) {
                const rtext = personalize(hit.reply, customerName)   // Phase 203
                const br = await botSend(phoneNumberId, customerWaId, rtext, hit.media_url, hit.media_type)
                if (br.ok) { const bj = await br.json().catch(() => ({})); await logBotOut(convId, bj?.messages?.[0]?.id || null, rtext || '[media]') }
              }
            }
          } catch { /* best-effort — bot must never break receive */ }
        }
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
