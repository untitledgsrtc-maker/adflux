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
const DEFAULT_SYSTEM = `You are the WhatsApp assistant for Untitled Advertising, which runs the GSRTC LED Network — a network of LED advertising screens across Gujarat's GSRTC (state bus) stations.

THE NETWORK (facts — never invent beyond these):
- 264 LED screens across 20 major GSRTC bus stations in Gujarat.
- ~29 lakh impressions per month (~95,000 per day) from real travellers waiting at busy bus stations.
- Screens are 43" and 55" high-brightness LED — clear even in bright daylight — graded A / B / C by footfall.
- Each screen reaches 1000+ people a day, plays your ad ~14 hours a day, with AI-tracked daily impressions.
- Live stations include Surat, Vadodara, Anand, Gandhinagar, Bhavnagar, Veraval, Surendranagar, Jamnagar, Junagadh, Porbandar, Dwarka, Morbi, Bhachau, Botad — and more (20 total).
- Advertising STARTS AT JUST Rs 75 — the entry price. The exact rate depends on the city, number of screens and duration; our team shares a tailored quote. (Never quote a final total.)
- Full details, video and a live map: https://app.untitledad.in/led

WHY WE'RE DIFFERENT (this is the main pitch — "a billboard can't tell you who looked; ours can"):
- Ordinary outdoor/hoardings: you print it and hope. No idea how many people saw it, no way to know if it drove a single call, one flat rate, zero reporting.
- The GSRTC LED Network: you run it AND measure it. AI-verified views (real eyes + real dwell time, not guessed). Every screen shows a QR — one tap opens WhatsApp, no typing — and every scan becomes a tracked lead tagged to the exact station it came from. Advertisers get a per-screen dashboard: scans, leads, city breakdown. It's a funnel you can watch, not "impressions" you estimate.

HOW IT WORKS (4 steps):
1. Your creative goes live on the LED screens at Gujarat's busiest bus stations.
2. Thousands of travellers wait, look up and watch — views AI-verified, not guessed.
3. They scan the on-screen QR → it opens WhatsApp on their phone in one tap.
4. Every scan lands as a tracked lead, tagged to the station it came from — proof, not hope.

PROOF: the funnel is already running live — hundreds of scans have already turned into real, routed leads, each tagged to the exact screen that pulled it in. Real numbers, no estimates.

YOUR JOB:
- Reply helpfully and briefly (WhatsApp — 2 to 5 short sentences; break longer answers into a couple of short messages of thought).
- Explain the network, coverage, audience, the measurable/scan-proof advantage, and how it works.
- Share https://app.untitledad.in/led when it helps (it has the video, live map and full details).
- Gently find out what they need: which city/stations, what brand or product, and rough timeline — so our team can prepare a tailored quote.
- Reply in the customer's own language (English, Hindi or Gujarati) matching how they wrote.

HARD RULES:
- Do NOT quote a final or total price, and do NOT confirm any booking. If they ask exact pricing or want to book, say our team will share a tailored quote shortly and ask for their requirement (city, brand, dates).
- Do NOT invent screens, cities, guarantees, or numbers beyond the facts above.
- Calm, precise, professional — never pushy or salesy, avoid heavy emoji. It's completely fine if they don't book; just be genuinely helpful.
- If they ask to stop/unsubscribe, apologise briefly and tell them they won't be messaged further.
- Keep it human. Don't say you are an AI unless asked directly.`

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
  const conv = (await (await sb(`whatsapp_conversations?id=eq.${convId}&select=id,customer_wa_id,whatsapp_account_id,window_expires_at,ai_paused,lead_id&limit=1`)).json())?.[0]
  if (!conv) return nope('conv_not_found')
  if (conv.ai_paused) return nope('ai_paused')                                   // a human took over
  if (conv.window_expires_at && new Date(conv.window_expires_at).getTime() < Date.now()) return nope('window_closed')  // 24h policy window

  // Opt-out is a property of the LEAD, not of this thread. ai_paused only mutes
  // the conversation it was set on, so without this check the AI keeps replying
  // to someone who opted out via the admin toggle, or who sent STOP on the OTHER
  // number (the same lead can hold a thread on both 95815… and 98982…, §119).
  // Best-effort: a lookup failure must not silence a legitimate reply.
  if (conv.lead_id) {
    try {
      const ld = (await (await sb(`leads?id=eq.${conv.lead_id}&select=wa_opt_out&limit=1`)).json())?.[0]
      if (ld?.wa_opt_out) return nope('lead_opted_out')
    } catch { /* ignore — never block a reply on a failed lookup */ }
  }

  const acct = (await (await sb(`whatsapp_accounts?id=eq.${conv.whatsapp_account_id}&select=phone_number_id,ai_enabled,ai_system_prompt,ai_welcome_image_url&limit=1`)).json())?.[0]
  if (!acct?.ai_enabled) return nope('ai_disabled')
  if (!acct.phone_number_id) return nope('no_sending_number')

  // Phase 246.1 — cities we have a real PHOTO or VIDEO for. The AI can SEND a
  // city photo (image; public city-photos bucket → Meta fetches the link) and
  // SHARE a city video link (cities.youtube_url, §221) in its text. Wrapped so a
  // transient catalog-load failure degrades to "no media" — the TEXT reply must
  // never fail because of a media lookup.
  let allCities = []
  try {
    allCities = ((await (await sb(`cities?select=name,photo_url,youtube_url&is_active=eq.true&limit=300`)).json()) || []).filter((c) => c && c.name)
  } catch { /* no media catalog → text-only */ }
  const cityRows = allCities.filter((c) => c.photo_url && String(c.photo_url).trim())
  const photoCities = cityRows.map((c) => c.name)
  const videoRows = allCities.filter((c) => c.youtube_url && String(c.youtube_url).trim())

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

  // First contact = no reply has ever gone out on this thread → the AI opens
  // with the welcome poster (whatsapp_accounts.ai_welcome_image_url) once.
  const firstContact = !rows.some((m) => m.direction === 'out')

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
  let system = acct.ai_system_prompt || DEFAULT_SYSTEM
  if (photoCities.length) {
    system += `\n\nPHOTOS YOU CAN SEND: ${photoCities.join(', ')}.\nIf the customer asks to see a photo, the screens, or what it looks like in ONE of these cities, add a FINAL separate line exactly in this form:\nPHOTO: <city name>\nUse the exact city name from the list, ONE city only, and ONLY if it is in the list. If they ask about a city not in the list, do NOT add the line — say our team will share photos.`
  }
  if (videoRows.length) {
    system += `\n\nVIDEOS YOU CAN SHARE — when the customer asks to see a video/reel of one of these stations, include the EXACT link in your reply text (WhatsApp shows a preview):\n${videoRows.map((c) => `- ${c.name}: ${c.youtube_url}`).join('\n')}\nOnly share a link from this list, for the city asked. If they ask for a city not listed, say our team will share a video.`
  }
  let reply = ''
  try {
    const ar = await fetch(ANTHROPIC, {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 400, system, messages: turns }),
    })
    if (!ar.ok) return nope('claude_' + ar.status, 502)
    const data = await ar.json()
    reply = (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim()
  } catch (e) { return nope('claude_error', 502) }

  // Phase 246.1 — a `PHOTO: <city>` marker means send that city's photo as a
  // WhatsApp image. Strip the marker from the text; resolve to a real city we
  // actually have a photo for (never a made-up url).
  let photoUrl = null
  const pm = reply.match(/(^|\n)[ \t]*PHOTO:[ \t]*(.*?)[ \t]*$/im)
  if (pm) {
    reply = (reply.slice(0, pm.index) + reply.slice(pm.index + pm[0].length)).trim()  // always strip our control marker
    const want = pm[2].trim().toLowerCase()
    if (want) {  // empty city → resolve nothing (never default to the first city)
      const hit = cityRows.find((c) => c.name.toLowerCase() === want) ||
                  cityRows.find((c) => want.includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(want))
      if (hit) photoUrl = hit.photo_url
    }
  }
  if (!reply && !photoUrl) return nope('empty_reply')

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

  // ── send: the text (if any) then the city photo (if any) ──
  const sendWa = async (payload) => {
    const gr = await fetch(`${GRAPH}/${acct.phone_number_id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WA_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: conv.customer_wa_id, ...payload }),
    })
    const gd = await gr.json().catch(() => ({}))
    if (!gr.ok) throw new Error(gd?.error?.message || ('graph_' + gr.status))
    return gd?.messages?.[0]?.id || null
  }
  const logOut = async (type, textBody, wamid) => {
    const atIso = new Date().toISOString()
    try {
      await sb('whatsapp_messages', { method: 'POST', body: JSON.stringify({ conversation_id: convId, wamid, direction: 'out', type, body: textBody, at: atIso }) })
      await sb(`whatsapp_conversations?id=eq.${convId}`, { method: 'PATCH', body: JSON.stringify({ updated_at: atIso }) })
    } catch { /* the message was sent; a log failure is non-fatal */ }
  }

  // Welcome poster on the FIRST message of a conversation (best-effort — a bad
  // url must never block the reply). Sent before the text so it opens the chat.
  if (firstContact && acct.ai_welcome_image_url && String(acct.ai_welcome_image_url).trim()) {
    try { const id = await sendWa({ type: 'image', image: { link: acct.ai_welcome_image_url } }); await logOut('image', '[image]', id) } catch { /* poster skipped */ }
  }

  try {
    if (reply) { const id = await sendWa({ type: 'text', text: { body: reply } }); await logOut('text', reply, id) }
  } catch (e) { return nope('send_failed:' + String(e?.message || e), 502) }
  // Photo is best-effort — the text already went; a bad/unreachable photo_url
  // must not fail the whole reply.
  if (photoUrl) {
    try { const id = await sendWa({ type: 'image', image: { link: photoUrl } }); await logOut('image', '[image]', id) }
    catch { /* photo skipped — text delivered */ }
  }

  return ok({ photo: !!photoUrl })
}
