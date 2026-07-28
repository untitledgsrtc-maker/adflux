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
// Phase 263 — a shared contact card (m.contacts[]) has no proxiable media;
// format its name + phone so the inbox shows the details, not a bare [contacts].
function contactsToText(contacts) {
  if (!Array.isArray(contacts) || !contacts.length) return null
  const parts = contacts.map((c) => {
    const nm = c?.name?.formatted_name
      || [c?.name?.first_name, c?.name?.last_name].filter(Boolean).join(' ')
      || ''
    const ph = c?.phones?.[0]?.phone || c?.phones?.[0]?.wa_id || ''
    return [nm, ph].filter(Boolean).join(' ')
  }).filter(Boolean)
  return parts.length ? 'Contact shared: ' + parts.join('; ') : 'Contact shared'
}

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
    contactsToText(m.contacts) ??
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

// Honour an inbound opt-out keyword.
//
// WhatsApp's own "Stop promotions" affordance sends exactly this text, and Meta
// counts continuing to message someone who sent it against the number's quality
// rating. Until now NOTHING in the app ingested it — wa_opt_out was only ever
// set by an admin toggling it by hand.
//
// WHOLE-MESSAGE exact match only (trimmed, case- and space-insensitive, length
// capped) so conversational uses never trigger it — "don't stop the campaign"
// must NOT opt a paying client out of their own thread.
//
// Also pauses the AI on that thread: without it the responder cheerfully replies
// to "STOP". The AI dispatch trigger fires on the message INSERT, so this can
// race and let one reply through — it still stops every subsequent one.
//
// Called FIRE-AND-FORGET (not awaited) → zero pre-200 latency. Self-contained
// try/catch → never rejects, so an un-awaited call is safe (§46).
const STOP_WORDS = new Set([
  'STOP', 'STOP ALL', 'STOP PROMOTIONS', 'UNSUBSCRIBE', 'OPT OUT', 'OPTOUT',
])
// Natural-language refusals. A real customer almost never types "STOP" — they
// write "don't call me again", which the exact-match set above missed entirely
// (owner caught this on a live thread). These are matched as a SUBSTRING, but
// only inside a SHORT message: a refusal is terse, whereas the same words
// inside a long business reply are usually conversational
// ("...we don't want to stop the campaign, but...").
//
// Kept to phrasings with no innocent reading. Deliberately EXCLUDES "not
// interested" — that is standard negotiation talk and auto-muting a lead the
// rep could still work would do more harm than good. It belongs to the Lost
// outcome, which the rep chooses.
const STOP_PHRASES = [
  'DONT CALL ME', 'DO NOT CALL ME', 'STOP CALLING', 'DONT CONTACT ME',
  'DO NOT CONTACT ME', 'DONT MESSAGE ME', 'DO NOT MESSAGE ME',
  'REMOVE MY NUMBER', 'DONT SEND ME', 'DO NOT SEND ME', 'LEAVE ME ALONE',
]
async function honourStopKeyword(admin, convId, text) {
  try {
    if (!admin || !convId) return
    const t = String(text || '').trim().toUpperCase().replace(/\s+/g, ' ')
    if (!t) return
    // Strip apostrophes so don't / dont / don’t all normalise to DONT.
    const flat = t.replace(/['‘’]/g, '')
    const exact = t.length <= 20 && STOP_WORDS.has(t)
    const phrase = flat.length <= 120 && STOP_PHRASES.some((p) => flat.includes(p))
    if (!exact && !phrase) return
    const { data: c } = await admin.from('whatsapp_conversations')
      .select('lead_id').eq('id', convId).maybeSingle()
    // Pause the AI regardless of whether a lead is linked — a bare
    // conversation can still be mid-AI-thread.
    await admin.from('whatsapp_conversations')
      .update({ ai_paused: true }).eq('id', convId)
    if (!c?.lead_id) return
    if (exact && !phrase) {
      // Bare STOP / Stop promotions = a MARKETING opt-out (WhatsApp's own
      // affordance). Mute WhatsApp only — the rep may still call.
      await admin.from('leads').update({ wa_opt_out: true }).eq('id', c.lead_id)
      return
    }
    // Phase 253 (§124 finding 3) — a natural-language refusal ("don't call
    // me", "stop calling", "leave me alone") is a FULL contact refusal, not a
    // marketing preference. Before this, D M Joshi said "Don't call me" and
    // got 20 more call attempts with his callback still booked: wa_opt_out
    // went true but do_not_call stayed false and the open follow-up survived.
    // cadence_paused is LOAD-BEARING here (guardian P0): closing a due
    // quote_chase seq-3 row below fires followup_after_done, whose QuoteSent→
    // Nurture de-stage would make lead_stage_change_cadence SPAWN a fresh
    // 30-day nurture follow-up on this DNC'd lead — the exact "still getting
    // chased" incident this fix exists for. The pause gate in BOTH functions
    // runs first and blocks that chain.
    await admin.from('leads').update({
      wa_opt_out: true,
      do_not_call: true,
      dnc_reason: 'WhatsApp: customer asked not to be contacted',
      dnc_at: new Date().toISOString(),
      cadence_paused: true,
    }).eq('id', c.lead_id)
    // Cancel the lead's open follow-ups so no callback resurfaces the number.
    // nurture / lost_nurture cadence rows are DELETEd, not closed — closing
    // them via is_done fires followup_after_done which RESPAWNS the cadence
    // (§60 close→respawn re-leak). Everything else closes with a §175
    // isSystemClose marker so dashboards don't count it as rep work.
    await admin.from('follow_ups').delete()
      .eq('lead_id', c.lead_id).eq('is_done', false)
      .in('cadence_type', ['nurture', 'lost_nurture'])
    await admin.from('follow_ups').update({
      is_done: true,
      done_at: new Date().toISOString(),
      done_note: '[closed: auto] customer asked not to be contacted (WhatsApp)',
    }).eq('lead_id', c.lead_id).eq('is_done', false)
  } catch { /* best-effort — never breaks the webhook */ }
}

// Phase 245 — download an inbound media object to OUR storage while Meta still
// has the bytes (Meta deletes media after a few days). Called FIRE-AND-FORGET
// from the webhook (NOT awaited) → zero pre-200 latency, never delays the bot
// reply (§46). Self-contained try/catch → never rejects, so an un-awaited call
// is safe. The 7s abort caps the Graph fetches if the serverless fn stays alive;
// if it freezes before finishing, the /api/wa/media proxy lazy-caches the bytes
// on first view — THAT is the guaranteed capture, this is the fast-path bonus.
async function storeInboundMedia(admin, mediaId, mime) {
  if (!admin || !mediaId || !WA_TOKEN) return
  if (!/^[0-9]{5,}$/.test(String(mediaId))) return   // match the proxy — numeric Meta ids only; never a weird storage key
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 7000)
  try {
    // Skip if we already have it (idempotent on Meta webhook retries).
    const existing = await admin.storage.from('campaign-inbound-media').list('', { search: String(mediaId), limit: 1 })
    if (existing?.data?.some((f) => f.name === String(mediaId))) return
    const metaRes = await fetch(`${GRAPH}/${mediaId}`, { headers: { Authorization: `Bearer ${WA_TOKEN}` }, signal: ctl.signal })
    if (!metaRes.ok) return
    const meta = await metaRes.json()
    if (!meta?.url) return
    const binRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${WA_TOKEN}` }, signal: ctl.signal })
    if (!binRes.ok) return
    const buf = Buffer.from(await binRes.arrayBuffer())
    await admin.storage.from('campaign-inbound-media').upload(String(mediaId), buf, {
      contentType: meta.mime_type || mime || 'application/octet-stream',
      upsert: true,
    })
  } catch { /* tolerant — proxy lazy-cache backstop covers a miss */ }
  finally { clearTimeout(timer) }
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

  // ── Phase C — flow runtime ──────────────────────────────────────────
  // When an account has a PUBLISHED flow (campaign_bot_flows.published_flow +
  // is_published) AND the bot is ON, the flow graph drives the bot end-to-end
  // (greeting via start->first node, buttons, keyword branches, handoff) and
  // the flat C7/204/keyword logic is skipped for that message. With NO
  // published flow the runtime no-ops and the flat bot is 100% unchanged (§45).
  // Every send is awaited; the call site try/catches — a flow bug can never
  // break the 200 to Meta.
  let _flowCache
  async function getFlow(accountId) {
    if (_flowCache !== undefined) return _flowCache
    let f = null
    try {
      // C14 — a number can hold several flows; run ONLY the Live (published)
      // one. The partial unique index guarantees at most one is_published per
      // account, so maybeSingle is safe. None published -> null -> flat bot.
      const { data, error } = await admin.from('campaign_bot_flows')
        .select('published_flow').eq('account_id', accountId).eq('is_published', true).maybeSingle()
      if (!error && data && data.published_flow
          && Array.isArray(data.published_flow.nodes) && data.published_flow.nodes.length) {
        f = data.published_flow
      }
    } catch { f = null }
    _flowCache = f
    return f
  }
  async function readBotNode(convId) {
    try {
      const { data, error } = await admin.from('whatsapp_conversations').select('bot_node_id').eq('id', convId).maybeSingle()
      return error ? null : (data?.bot_node_id || null)
    } catch { return null }
  }
  async function writeBotNode(convId, nodeId) {
    try { await admin.from('whatsapp_conversations').update({ bot_node_id: nodeId }).eq('id', convId) } catch { /* column may be unrun — degrade, never throw */ }
  }
  async function flowSend(pnid, to, convId, text, mUrl, mType) {
    const r = await botSend(pnid, to, text, mUrl, mType)
    if (r.ok) { const j = await r.json().catch(() => ({})); await logBotOut(convId, j?.messages?.[0]?.id || null, text || '[media]') }
  }
  // A flow "buttons" node -> WhatsApp interactive. Button ids encode the source
  // node + index: `flow~<nodeId>~<i>`. 1-3 = reply buttons (media rides as a
  // header); 4-10 = a list (WhatsApp lists allow only a TEXT header, so the
  // media is sent as a SEPARATE message first — the image-attach fix).
  async function sendFlowButtons(pnid, to, convId, node, name) {
    const body = personalize(node.data?.text || '…', name)
    const btns = (node.data?.buttons || []).slice(0, 10)
    const mUrl = node.data?.media_url, mType = String(node.data?.media_type || '').toLowerCase()
    if (!btns.length) { await flowSend(pnid, to, convId, body, mUrl, mType); return }
    let interactive
    if (btns.length <= 3) {
      interactive = { type: 'button', body: { text: body },
        action: { buttons: btns.map((b, i) => ({ type: 'reply', reply: { id: `flow~${node.id}~${i}`, title: String(b.label || `Option ${i + 1}`).slice(0, 20) } })) } }
      if (mUrl && ['image', 'video', 'document'].includes(mType)) {
        interactive.header = mType === 'document'
          ? { type: 'document', document: { link: mUrl, filename: 'document.pdf' } }
          : { type: mType, [mType]: { link: mUrl } }
      }
    } else {
      if (mUrl && ['image', 'video', 'document'].includes(mType)) { await botSend(pnid, to, '', mUrl, mType) }
      interactive = { type: 'list', body: { text: body },
        action: { button: 'Choose', sections: [{ title: 'Options', rows: btns.map((b, i) => ({ id: `flow~${node.id}~${i}`, title: String(b.label || `Option ${i + 1}`).slice(0, 24) })) }] } }
    }
    const r = await fetch(`${GRAPH}/${pnid}/messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'interactive', interactive }),
    })
    if (r.ok) { const j = await r.json().catch(() => ({})); await logBotOut(convId, j?.messages?.[0]?.id || null, body) }
  }
  // Execute the graph for one inbound message. bot_enabled + published already
  // checked by the caller. Best-effort; caller wraps in try/catch.
  async function runFlow(flow, ctx) {
    const { pnid, to, convId, m, name, isNew } = ctx
    // Pause the moment a human (telecaller) has replied in this chat.
    const { data: humanOut } = await admin.from('whatsapp_messages')
      .select('id').eq('conversation_id', convId).eq('direction', 'out').not('via_bot', 'is', true).limit(1)
    if (humanOut && humanOut.length) return
    const nodes = flow.nodes || [], edges = flow.edges || []
    const byId = {}; for (const n of nodes) byId[n.id] = n
    const target = (nodeId, handle) => {
      const e = edges.find((x) => x.source === nodeId && (handle == null ? true : (x.sourceHandle || null) === handle))
      return e ? byId[e.target] : null
    }
    const state = await readBotNode(convId)
    if (state === '__handoff__') return   // already handed to a human -> silent
    const text = String(messageBody(m) || '').toLowerCase().trim()
    const tapId = m.type === 'interactive' ? String(m.interactive?.button_reply?.id || m.interactive?.list_reply?.id || '') : ''

    let entry = null
    if (tapId.startsWith('flow~')) {
      const parts = tapId.split('~'); const nodeId = parts[1]; const idx = Number(parts[2])
      entry = target(nodeId, `btn_${idx}`)
      if (!entry) {   // unwired button -> inline reply, then clear
        const b = byId[nodeId]?.data?.buttons?.[idx]
        if (b && (b.reply_text || b.media_url)) await flowSend(pnid, to, convId, personalize(b.reply_text, name), b.media_url, b.media_type)
        await writeBotNode(convId, null); return
      }
    } else if (state && byId[state]?.type === 'buttons') {   // typed a button label
      const bn = byId[state]; const idx = (bn.data?.buttons || []).findIndex((b) => String(b.label || '').toLowerCase().trim() === text)
      if (idx >= 0) {
        entry = target(bn.id, `btn_${idx}`)
        if (!entry) { const b = bn.data.buttons[idx]; if (b && (b.reply_text || b.media_url)) await flowSend(pnid, to, convId, personalize(b.reply_text, name), b.media_url, b.media_type); await writeBotNode(convId, null); return }
      }
    }
    if (!entry) {   // global keyword branch (any inbound)
      const kw = nodes.find((n) => n.type === 'keyword' && (n.data?.keywords || []).some((k) => k && text.includes(String(k).toLowerCase())))
      if (kw) entry = kw
    }
    if (!entry && (isNew || !state)) {   // first message / fresh -> start
      const start = nodes.find((n) => n.type === 'start')
      entry = start ? target(start.id, null) : null
    }
    if (!entry) return   // no match mid-flow -> stay silent

    // Traverse: auto-advance through message/keyword/action(send) nodes; stop
    // at a buttons node (wait) or a handoff (terminal). Hop cap guards cycles.
    let cur = entry, hops = 0, wait = null
    while (cur && hops < 12) {
      hops++
      if (cur.type === 'buttons') { await sendFlowButtons(pnid, to, convId, cur, name); wait = cur.id; break }
      if (cur.type === 'handoff' || (cur.type === 'action' && cur.data?.kind === 'handoff')) {
        const h = (cur.data?.text && personalize(cur.data.text, name)) || 'Connecting you with our team — someone will reply shortly.'
        await flowSend(pnid, to, convId, h, cur.data?.media_url, cur.data?.media_type); wait = '__handoff__'; break
      }
      const txt = personalize(cur.data?.reply ?? cur.data?.text ?? '', name)
      if (txt || cur.data?.media_url) await flowSend(pnid, to, convId, txt, cur.data?.media_url, cur.data?.media_type)
      cur = target(cur.id, null)
    }
    await writeBotNode(convId, wait)
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
          // Phase 253 — keep Meta's failure REASON, not just the word 'failed'.
          // SEPARATE tolerant update: if the error_detail column's SQL hasn't
          // run yet this update just errors quietly and the ticks above are
          // untouched (§45 — never let an add-on break the live status path).
          if (sstatus === 'failed') {
            const e = (s.errors && s.errors[0]) || null
            const detail = e
              ? [e.code, e.title, e.message || (e.error_data && e.error_data.details)]
                  .filter(Boolean).join(' · ').slice(0, 500)
              : null
            if (detail) {
              await admin.from('whatsapp_messages').update({ error_detail: detail })
                .eq('wamid', swamid)
            }
          }
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
        // Phase 264 — Meta Click-to-WhatsApp attribution. A chat opened from an
        // Instagram/Facebook ad carries m.referral (the ad's headline + platform)
        // on the FIRST message only. Attach the active Meta campaign so C4.5
        // routes the lead to that campaign's telecaller (Dhara) + tags source
        // 'Social Media'. A QR board (above) wins — it's the more specific source.
        if (!convRow.campaign_id && m.referral) {
          // Prefer a Meta campaign tied to THIS number; else any active one.
          let metaCamp = (await admin.from('campaigns')
            .select('id').eq('source_type', 'meta').eq('is_active', true)
            .eq('whatsapp_account_id', accountId)
            .order('created_at', { ascending: false }).limit(1).maybeSingle()).data
          if (!metaCamp) {
            metaCamp = (await admin.from('campaigns')
              .select('id').eq('source_type', 'meta').eq('is_active', true)
              .order('created_at', { ascending: false }).limit(1).maybeSingle()).data
          }
          if (metaCamp?.id) {
            convRow.campaign_id = metaCamp.id
            const headline = String(m.referral.headline || m.referral.body || '').slice(0, 300)
            if (headline) convRow.ad_headline = headline
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
        // C11 customer_name / Phase 264 ad_headline optional columns not added
        // yet → retry WITHOUT them so the conversation store never breaks on an
        // optional column (§45). campaign_id/location_id are core → kept.
        if (conv.error && /customer_name|ad_headline|could not find|column/i.test(conv.error.message || '')) {
          const { customer_name, ad_headline, ...rest } = convRow   // eslint-disable-line no-unused-vars
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
        // Phase 245 — persist inbound media to our storage while Meta still has
        // the bytes (deleted after days). FIRE-AND-FORGET (no await) → ZERO
        // pre-200 latency, never delays the store or the bot reply (§46). Best-
        // effort; the /api/wa/media proxy lazy-caches on first view as the
        // guaranteed backstop. storeInboundMedia never rejects (self-contained).
        if (media.id) { void storeInboundMedia(admin, media.id, media.mime) }
        // Opt-out keyword — same fire-and-forget contract as the media capture.
        if (convId) { void honourStopKeyword(admin, convId, messageBody(m)) }
        let repliedThisMsg = false

        // Phase C — a PUBLISHED flow (+ bot ON) drives the bot end-to-end and
        // replaces the flat C7/204/keyword logic for this message. No published
        // flow -> flowActive stays false and the flat bot below runs unchanged.
        let flowActive = false
        if (convId && WA_TOKEN && acct && acct.bot_enabled) {
          try {
            const flow = await getFlow(accountId)
            if (flow) {
              flowActive = true; repliedThisMsg = true
              await runFlow(flow, { pnid: phoneNumberId, to: customerWaId, convId, m, name: customerName, isNew: isNewConv || windowWasClosed })
            }
          } catch { /* best-effort — flow must never break receive */ }
        }

        // C7 — auto-reply once on a new customer's first message. Free-form is
        // allowed (their inbound just opened the 24h service window) and free.
        // Best-effort: a send failure NEVER affects the store or the 200 to Meta.
        if (!flowActive && (isNewConv || windowWasClosed) && convId && !autoReplied.has(convId) && autoReplied.size < 25
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
