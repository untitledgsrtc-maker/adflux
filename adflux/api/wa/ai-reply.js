// api/wa/ai-reply.js — EDGE runtime (Phase 246 — WhatsApp AI auto-responder).
// ─────────────────────────────────────────────────────────────────────────
// Dispatched ASYNC by the Phase 246 pg_net trigger (wa_ai_reply_dispatch) when
// a customer messages an ai_enabled number. It reads the thread, asks Claude
// for a helpful reply grounded in our real GSRTC LED context, and sends it back
// on WhatsApp. It NEVER quotes a final price or confirms a booking (that stays
// human), and it goes silent the moment a human replies (ai_paused).
//
// WHY EDGE: the Vercel Hobby plan caps a deploy at 12 Node functions and we're
// at the limit (§219). Edge fns don't count → raw fetch to Supabase REST +
// Anthropic + the Graph API, no supabase-js.
//
// SECURITY: called only by our own DB trigger, authenticated by a shared secret
// header (x-ai-secret == AI_REPLY_SECRET). Every gate is re-checked server-side
// (ai_enabled, ai_paused, 24h window, newest message is inbound) so a stray call
// can't make it spam. It only ever sends ONE reply to a real, opted-in thread.
//
// Env: SUPABASE_URL (||VITE_) + SUPABASE_SERVICE_ROLE_KEY + CAMPAIGN_WA_TOKEN
//   + ANTHROPIC_API_KEY + AI_REPLY_SECRET [+ ANTHROPIC_MODEL].
// ─────────────────────────────────────────────────────────────────────────

export const config = { runtime: 'edge' }

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const WA_TOKEN     = process.env.CAMPAIGN_WA_TOKEN
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY
const AI_SECRET    = process.env.AI_REPLY_SECRET
const MODEL        = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5'
const GRAPH        = 'https://graph.facebook.com/v21.0'
const ANTHROPIC    = 'https://api.anthropic.com/v1/messages'

const ok  = (obj = {}) => new Response(JSON.stringify({ ok: true, ...obj }), { status: 200, headers: { 'content-type': 'application/json' } })
const nope = (reason, status = 200) => new Response(JSON.stringify({ ok: false, reason }), { status, headers: { 'content-type': 'application/json' } })

const sb = (path, init = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  ...init,
  headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json', ...(init.headers || {}) },
})

// The default persona + grounding. Overridable per-account via
// whatsapp_accounts.ai_system_prompt. Facts here are the REAL network — the
// model must not invent beyond them, must not quote a final total, must not
// confirm a booking, and must keep the calm Untitled voice (§20).
const DEFAULT_SYSTEM = `You are the WhatsApp assistant for Untitled Advertising, which runs a network of LED advertising screens across Gujarat's GSRTC (state bus) stations.

WHAT WE OFFER (facts — do not invent anything beyond these):
- 264 LED screens across 20 major GSRTC bus stations in Gujarat.
- ~29 lakh impressions per month (~95,000 per day) from real travellers.
- Audience is measured with AI analytics (gender, age band) — advertisers get real proof of who saw the ad, plus QR scans that turn viewers into trackable leads. This measurable, scan-proof reporting is our main differentiator vs ordinary hoardings.
- Stations/cities include Surat, Anand, Gandhinagar, Vadodara, Bhavnagar, Veraval, Junagadh, Jamnagar, Porbandar, Botad, Morbi and more.
- Indicative screen rates are roughly Rs 650 to Rs 850 per screen depending on grade/size (43" / 55"). These are indicative only.
- Full details, video and a live map: https://app.untitledad.in/led

YOUR JOB:
- Reply helpfully and briefly (this is WhatsApp — 2 to 5 short sentences).
- Answer questions about the network, coverage, audience and how it works.
- Share the link https://app.untitledad.in/led when it helps.
- Gently find out what they need: which city/stations, what brand or product, and rough timeline — so our team can prepare a tailored quote.
- Reply in the customer's own language (English, Hindi or Gujarati) matching how they wrote.

HARD RULES:
- Do NOT quote a final or total price, and do NOT confirm any booking. If they ask for exact pricing or want to book, say our team will share a tailored quote shortly and ask for their requirement (city, brand, dates).
- Do NOT invent screens, cities, guarantees, or numbers that aren't listed above.
- Be calm, precise and professional — never pushy or salesy, and avoid heavy emoji. It's completely fine if they don't book; just be genuinely helpful.
- If they ask to stop or unsubscribe, apologise briefly and tell them they won't be messaged further.
- Keep it human and short. Do not mention that you are an AI unless asked directly.`

export default async function handler(req) {
  if (req.method !== 'POST') return nope('method_not_allowed', 405)
  if (!SUPABASE_URL || !SERVICE_KEY || !WA_TOKEN || !ANTHROPIC_KEY || !AI_SECRET) return nope('not_configured', 503)
  if (String(req.headers.get('x-ai-secret') || '') !== AI_SECRET) return nope('forbidden', 403)

  let body
  try { body = await req.json() } catch { return nope('bad_body', 400) }
  const convId = String(body?.conversation_id || '')
  // UUID only → the id is interpolated into PostgREST filters below, so reject
  // anything that could inject query params (&, =, operators).
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(convId)) return nope('bad_conversation')

  // ── load conversation + account ──
  const conv = (await (await sb(`whatsapp_conversations?id=eq.${convId}&select=id,customer_wa_id,whatsapp_account_id,window_expires_at,ai_paused&limit=1`)).json())?.[0]
  if (!conv) return nope('conv_not_found')
  if (conv.ai_paused) return nope('ai_paused')                                   // a human took over
  if (conv.window_expires_at && new Date(conv.window_expires_at).getTime() < Date.now()) return nope('window_closed')  // 24h policy window

  const acct = (await (await sb(`whatsapp_accounts?id=eq.${conv.whatsapp_account_id}&select=phone_number_id,ai_enabled,ai_system_prompt&limit=1`)).json())?.[0]
  if (!acct?.ai_enabled) return nope('ai_disabled')
  if (!acct.phone_number_id) return nope('no_sending_number')

  // ── recent thread (newest first) ──
  const rows = (await (await sb(`whatsapp_messages?conversation_id=eq.${convId}&order=at.desc&limit=16&select=direction,type,body,at`)).json()) || []
  if (!rows.length) return nope('no_messages')
  // Idempotency + don't-talk-over-human: only act when the NEWEST message is
  // inbound. If we (or a human) already replied after the last inbound, stop.
  if (rows[0].direction !== 'in') return nope('already_handled')

  // Per-conversation rate cap (cost + anti-spam) — bail if this thread already
  // saw many outbound in the last hour. Uses the already-fetched window.
  const hourAgo = Date.now() - 3600_000
  if (rows.filter((m) => m.direction === 'out' && new Date(m.at).getTime() > hourAgo).length >= 10) return nope('rate_capped')

  // Build Claude turns oldest→newest: in→user, out→assistant. Represent a media
  // message by a short tag so a turn is never empty. Collapse consecutive
  // same-role turns and ensure it starts with a user turn (API requirement).
  const turns = []
  for (const m of rows.slice().reverse()) {
    const role = m.direction === 'in' ? 'user' : 'assistant'
    let textPart = (m.body && String(m.body).trim()) || (m.type && m.type !== 'text' ? `[${m.type}]` : '')
    if (!textPart) continue
    if (turns.length && turns[turns.length - 1].role === role) turns[turns.length - 1].content += `\n${textPart}`
    else turns.push({ role, content: textPart })
  }
  while (turns.length && turns[0].role !== 'user') turns.shift()
  if (!turns.length) return nope('nothing_to_answer')

  // ── ask Claude ──
  let reply = ''
  try {
    const ar = await fetch(ANTHROPIC, {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 400, system: acct.ai_system_prompt || DEFAULT_SYSTEM, messages: turns }),
    })
    if (!ar.ok) return nope('claude_' + ar.status, 502)
    const data = await ar.json()
    reply = (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim()
  } catch (e) { return nope('claude_error', 502) }
  if (!reply) return nope('empty_reply')

  // ── backstop the two HARD rules (no final price, no booking confirmation) ──
  // The system prompt is the primary guard; this catches a jailbreak BEFORE it
  // goes out on the live brand number. On a hit, swap in a safe hand-off line
  // and pause the AI so a human closes. Indicative rates are 3-digit (650-850);
  // any 4+-digit rupee figure or a commitment word is treated as out-of-bounds.
  const risky =
    /(₹|rs\.?|inr)\s?[\d][\d,]{3,}/i.test(reply) ||
    /\b(confirmed|guarantee[d]?|booked)\b/i.test(reply) ||
    /\bbooking\s+(is\s+)?(confirm|done|complete)/i.test(reply) ||
    /\b(final|total)\s+(price|cost|amount|quote)\b/i.test(reply)
  if (risky) {
    reply = 'Thanks for your interest! For exact pricing and to book, our team will share a tailored quote. Could you tell me the city/stations, the brand, and your rough timeline?'
    try { await sb(`whatsapp_conversations?id=eq.${convId}`, { method: 'PATCH', body: JSON.stringify({ ai_paused: true }) }) } catch { /* hand-off is best-effort */ }
  }

  // Narrow the double-reply race: re-check right before sending — if an outbound
  // landed while Claude was thinking, bail (another dispatch/human handled it).
  const fresh = (await (await sb(`whatsapp_messages?conversation_id=eq.${convId}&order=at.desc&limit=1&select=direction`)).json())?.[0]
  if (fresh && fresh.direction !== 'in') return nope('superseded')

  // ── send on WhatsApp ──
  let wamid = null
  try {
    const gr = await fetch(`${GRAPH}/${acct.phone_number_id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WA_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: conv.customer_wa_id, type: 'text', text: { body: reply } }),
    })
    const gd = await gr.json().catch(() => ({}))
    if (!gr.ok) return nope('send_failed:' + (gd?.error?.message || gr.status), 502)
    wamid = gd?.messages?.[0]?.id || null
  } catch (e) { return nope('send_error', 502) }

  // ── log the outbound so it shows in the inbox (best-effort) ──
  const atIso = new Date().toISOString()
  try {
    await sb('whatsapp_messages', { method: 'POST', body: JSON.stringify({ conversation_id: convId, wamid, direction: 'out', type: 'text', body: reply, at: atIso }) })
    await sb(`whatsapp_conversations?id=eq.${convId}`, { method: 'PATCH', body: JSON.stringify({ updated_at: atIso }) })
  } catch { /* the message was sent; a log failure is non-fatal */ }

  return ok({ wamid })
}
