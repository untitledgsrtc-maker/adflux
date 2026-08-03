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
- The 20 live stations: Anand, Ankleshwar, Bhachau, Bhavnagar, Botad, Chikhli, Dahod, Dwarka, Gandhinagar, Godhra, Himmatnagar, Jamnagar, Junagadh, Kheda, Morbi, Porbandar, Surat, Surendranagar, Valsad, Veraval. NO other city has screens today — Vadodara, Ahmedabad and Rajkot are NOT covered (Vadodara is only our office city).
- Advertising STARTS AT JUST Rs 75 — the entry price. The exact rate depends on the city, number of screens and duration; our team shares a tailored quote. (Never quote a final total.)
- Full details, video and a live map: https://app.untitledad.in/led

WHY WE'RE DIFFERENT (BACKGROUND — share the ONE relevant point only if they ask, never all of it. "a billboard can't tell you who looked; ours can"):
- Ordinary outdoor/hoardings: you print it and hope. No idea how many people saw it, no way to know if it drove a single call, one flat rate, zero reporting.
- The GSRTC LED Network: you run it AND measure it. AI-verified views (real eyes + real dwell time, not guessed). Every screen shows a QR — one tap opens WhatsApp, no typing — and every scan becomes a tracked lead tagged to the exact station it came from. Advertisers get a per-screen dashboard: scans, leads, city breakdown. It's a funnel you can watch, not "impressions" you estimate.

HOW IT WORKS (4 steps):
1. Your creative goes live on the LED screens at Gujarat's busiest bus stations.
2. Thousands of travellers wait, look up and watch — views AI-verified, not guessed.
3. They scan the on-screen QR → it opens WhatsApp on their phone in one tap.
4. Every scan lands as a tracked lead, tagged to the station it came from — proof, not hope.

PROOF: the funnel is already running live — hundreds of scans have already turned into real, routed leads, each tagged to the exact screen that pulled it in. Real numbers, no estimates.

YOUR JOB — keep it SHORT (this is WhatsApp, not email):
- Every reply is 2-3 short lines MAX, ONE message. No paragraphs, no lists, no dumping the whole pitch.
- Answer ONLY what they asked. A first reply covers just: what it is (LED ad screens at Gujarat bus stations), that it starts at just Rs 75, and the link https://app.untitledad.in/led.
- Ask ONE simple question at a time (e.g. "Which city are you looking at?") — never two questions in one message.
- Everything above (why we're different, how it works, proof, stations) is BACKGROUND — share ONE relevant point only if they ask, never all of it.
- Reply in the customer's own language (English, Hindi or Gujarati) matching how they wrote.
- Add 1-2 light, natural WhatsApp emoji where they fit (e.g. 📍 for a city, 👍 to acknowledge) — warm and human, never spammy.
- FOOTFALL IS NOT A PRICE. When you mention how many people see a station, say it clearly as the daily AUDIENCE — e.g. "about 7,500 people see it there every day" — NEVER a bare "~7,500/day" that a customer could mistake for a cost. The ONLY price is "starts at just Rs 75"; never write any other number next to Rs, and never frame audience/footfall as money.
- Plain WhatsApp text ONLY. Do NOT use markdown — no ** for bold, no *, no #, no bullets/asterisks (WhatsApp shows the asterisks literally). Just plain sentences.

HARD RULES:
- Do NOT quote a final or total price, and do NOT confirm any booking. If they ask exact pricing or want to book, say our team will share a tailored quote shortly and ask for their requirement (city, brand, dates).
- Do NOT invent screens, cities, guarantees, or numbers beyond the facts above.
- Calm, warm and human — never pushy or salesy. 1-2 light emoji are welcome; don't overdo it. It's completely fine if they don't book; just be genuinely helpful.
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
  if (conv.window_expires_at && new Date(conv.window_expires_at).getTime() < Date.now()) return nope('window_closed')  // 24h policy window

  // Opt-out is a property of the LEAD, not of this thread. ai_paused only mutes
  // the conversation it was set on, so without this check the AI keeps replying
  // to someone who opted out via the admin toggle, or who sent STOP on the OTHER
  // number (the same lead can hold a thread on both 95815… and 98982…, §119).
  // NOT best-effort on a PAUSED thread: the auto-unpause below must never fire
  // without a confirmed non-opted-out lead, so a failed lookup fails CLOSED
  // there; on an active thread a lookup failure still never silences a reply.
  let leadOptedOut = null   // true / false / null = unknown
  if (conv.lead_id) {
    try {
      const ld = (await (await sb(`leads?id=eq.${conv.lead_id}&select=wa_opt_out&limit=1`)).json())?.[0]
      leadOptedOut = !!ld?.wa_opt_out
      if (leadOptedOut) return nope('lead_opted_out')
    } catch { /* unknown — active threads proceed; the unpause below won't */ }
  }

  // A human took over (manual reply / post-call template) — the AI stays out of
  // the thread. Phase 253 (§124 finding 1): but "out" used to mean FOREVER.
  // A customer who answered days later got silence from BOTH sides — the AI was
  // paused and the human had moved on ("haa sir", unanswered for 5 days). So:
  // if NOTHING outbound has gone on this thread for 48h (while paused, every
  // outbound is human/template), the human has abandoned it → the AI takes the
  // thread back and answers this inbound.
  //
  // Guard rails: only a LEAD-linked thread with a CONFIRMED non-opted-out lead
  // may auto-resume. A bare paused conversation stays paused forever — for a
  // conversation with no lead row, the pause may BE its only opt-out record
  // (honourStopKeyword pauses bare threads on STOP, §120).
  if (conv.ai_paused) {
    if (!conv.lead_id || leadOptedOut !== false) return nope('ai_paused')
    let lastOut = null
    try {
      lastOut = (await (await sb(
        `whatsapp_messages?conversation_id=eq.${convId}&direction=eq.out&select=at&order=at.desc&limit=1`
      )).json())?.[0]
    } catch { return nope('ai_paused') /* unknown history → stay silent */ }
    const idleMs = lastOut?.at ? Date.now() - new Date(lastOut.at).getTime() : Infinity
    // Phase 257.7 (owner, 22 Jul): after 7:30 PM IST the team is offline — a
    // paused thread whose last outbound is >60 min old gets answered by the AI
    // so a night customer isn't left hanging till morning. Daytime keeps the
    // 48h abandoned-thread rule (§126). Guard rails above still apply: only a
    // lead-linked thread with a CONFIRMED non-opted-out lead may auto-resume.
    const istMin = (Math.floor(Date.now() / 60000) + 330) % 1440   // minutes into the IST day
    const offHours = istMin >= 19 * 60 + 30 || istMin < 9 * 60 + 30  // 19:30 → 09:30 IST
    const takeoverMs = offHours ? 3600_000 : 48 * 3600 * 1000
    if (idleMs < takeoverMs) return nope('ai_paused')
    try {
      await sb(`whatsapp_conversations?id=eq.${convId}`, {
        method: 'PATCH', body: JSON.stringify({ ai_paused: false }),
      })
    } catch { /* flag write failed — still answer this one; next inbound retries */ }
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
    allCities = ((await (await sb(`cities?select=name,photo_url,youtube_url,impressions_day,impressions_month&is_active=eq.true&limit=300`)).json()) || []).filter((c) => c && c.name)
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

  // Phase 257.7 — the AUTHORITATIVE coverage list + real measured audience,
  // injected LIVE from the cities master (§71 one source — same rows that feed
  // the deck, CPM and /led). Kills the "Vadodara is a live station" class of
  // hallucination: the model must never claim coverage beyond this list, and
  // when a covered city comes up it shares that city's real daily audience.
  if (allCities.length) {
    const lakh = (n) => (n >= 100000 ? `~${(n / 100000).toFixed(1)} lakh/month` : `~${Number(n).toLocaleString('en-IN')}/month`)
    system += `\n\nSTATION COVERAGE — these are the ONLY cities with our screens, with REAL measured audience:\n${allCities
      .map((c) => {
        const d = Number(c.impressions_day) || 0
        const m = Number(c.impressions_month) || 0
        const aud = d ? ` — ~${d.toLocaleString('en-IN')} people/day${m ? ` (${lakh(m)})` : ''}` : ''
        return `- ${c.name}${aud}`
      })
      .join('\n')}\nCOVERAGE HARD RULES:\n- A city NOT on this list has NO screens today (Vadodara, Ahmedabad, Rajkot are NOT covered). Say so honestly, suggest the nearest covered stations, and offer that our team can discuss options — NEVER claim or imply coverage beyond the list.\n- When a covered city is being discussed, mention its real daily audience number from the list (these are measured, not estimates).`
  } else {
    system += `\n\nNOTE: the live station list could not be loaded right now — do NOT name or confirm specific covered cities; say the team will confirm coverage for their city.`
  }

  if (photoCities.length) {
    system += `\n\nPHOTOS YOU CAN SEND: ${photoCities.join(', ')}.\nIf the customer asks to see a photo, the screens, or what it looks like in ONE of these cities, add a FINAL separate line exactly in this form:\nPHOTO: <city name>\nUse the exact city name from the list, ONE city only, and ONLY if it is in the list. If they ask about a city not in the list, do NOT add the line — say our team will share photos.`
  }
  if (videoRows.length) {
    system += `\n\nVIDEOS YOU CAN SHARE — when the customer asks to see a video/reel of one of these stations, include the EXACT link in your reply text (WhatsApp shows a preview):\n${videoRows.map((c) => `- ${c.name}: ${c.youtube_url}`).join('\n')}\nOnly share a link from this list, for the city asked. If they ask for a city not listed, say our team will share a video.`
  }

  // Phase 275 — WhatsApp policy compliance (the marketing number is under a Meta
  // "sending spam" warning; the enforcement ladder is template-block → all-message
  // block → account lock → permanent disable). Meta scores by RECIPIENT block/
  // report rate + messaging non-opted-in people. The top trigger is a cold
  // QR-scan first-contact getting a sales pitch (§133). So on the customer's VERY
  // FIRST message, force a minimal, warm, NON-salesy reply — no pitch, no feature
  // list, no photo — and (below) append an opt-out line. The full AI engages only
  // once the person replies again (proof of genuine intent).
  if (firstContact) {
    system += `\n\nThis is the customer's VERY FIRST message to us. Reply in 1-2 short, warm lines ONLY. Do NOT pitch, do NOT list features or numbers, do NOT push, do NOT send a price. Just greet warmly, answer only what they actually asked (if anything), and — if they gave no detail — ask which city they are interested in. Keep it human and brief. Do NOT add a PHOTO line on this first reply.`
  }

  // Phase 264 — Meta ad context. If this chat came from a Click-to-WhatsApp ad,
  // open relevant to the ad they clicked. Best-effort separate query so a missing
  // ad_headline column (pre-SQL) can never break the reply (§45). The ad is
  // SOMETIMES the LED screens and SOMETIMES a different offer the AI has no facts
  // for — so LED ad → pitch LED; other offer → acknowledge + hand to the team.
  let adHeadline = null
  try {
    const ah = await (await sb(`whatsapp_conversations?id=eq.${convId}&select=ad_headline&limit=1`)).json()
    if (Array.isArray(ah)) adHeadline = ah[0]?.ad_headline || null
  } catch { /* column not added yet — no ad context */ }
  if (adHeadline) {
    system += `\n\nAD CONTEXT — this person clicked a Facebook/Instagram ad titled: "${String(adHeadline).slice(0, 200)}". Open relevant to THAT ad:\n- If the ad is about our GSRTC LED bus-station screens → help them with that using the facts above.\n- If the ad is about a DIFFERENT offer (e.g. social media marketing / ad management / anything that is NOT the LED screens) → warmly acknowledge their interest in THAT, say our team will share the details shortly, and ask one simple question (their business + what they need). Do NOT invent details about that offer, and do NOT pivot to pitching the LED screens.`
  }

  let reply = ''
  try {
    const ar = await fetch(ANTHROPIC, {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 300, system, messages: turns }),
    })
    if (!ar.ok) return nope('claude_' + ar.status, 502)
    const data = await ar.json()
    reply = (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim()
  } catch (e) { return nope('claude_error', 502) }

  // Phase 246.1 — a `PHOTO: <city>` marker means send that city's photo as a
  // WhatsApp image. Strip the marker from the text; resolve to a real city we
  // actually have a photo for (never a made-up url).
  let photoUrl = null
  let photoCity = null
  const pm = reply.match(/(^|\n)[ \t]*PHOTO:[ \t]*(.*?)[ \t]*$/im)
  if (pm) {
    reply = (reply.slice(0, pm.index) + reply.slice(pm.index + pm[0].length)).trim()  // always strip our control marker
    const want = pm[2].trim().toLowerCase()
    if (want) {  // empty city → resolve nothing (never default to the first city)
      const hit = cityRows.find((c) => c.name.toLowerCase() === want) ||
                  cityRows.find((c) => want.includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(want))
      if (hit) { photoUrl = hit.photo_url; photoCity = hit.name }
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

  // Phase 275 — on the FIRST reply: append an opt-out (an opt-out is neutral to
  // Meta's quality score; a block/report is not — this converts would-be reporters
  // into clean opt-outs, which honourStopKeyword honors), and send NO image
  // (unsolicited media to a cold first-contact is the top spam trigger, §133).
  // Both only on message #1 — normal replies stay unchanged.
  if (firstContact) {
    photoUrl = null
    if (reply && !/\bstop\b/i.test(reply)) reply = `${reply}\n\nReply STOP to opt out.`
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
  const logOut = async (type, textBody, wamid, mediaUrl) => {
    const atIso = new Date().toISOString()
    const row = { conversation_id: convId, wamid, direction: 'out', type, body: textBody, at: atIso }
    if (mediaUrl) row.media_url = mediaUrl   // Phase 263 — so the inbox renders the sent image
    try {
      const r = await sb('whatsapp_messages', { method: 'POST', body: JSON.stringify(row) })
      // Deploy-order safety: if the media_url column isn't present yet, retry
      // WITHOUT it so the message still logs (the url just isn't stored until
      // supabase_campaign_media_url_column.sql is run).
      if (r && r.ok === false && mediaUrl) {
        delete row.media_url
        await sb('whatsapp_messages', { method: 'POST', body: JSON.stringify(row) })
      }
      await sb(`whatsapp_conversations?id=eq.${convId}`, { method: 'PATCH', body: JSON.stringify({ updated_at: atIso }) })
    } catch { /* the message was sent; a log failure is non-fatal */ }
  }

  // Phase 261 (2026-07-27) — auto welcome-POSTER on first contact REMOVED to
  // protect the marketing number's WhatsApp quality rating. Meta flagged
  // 98982 73686 for "sending spam" (07-27): the number does 200-327 auto-
  // messages/day from cold QR-scan first-contacts, and an unsolicited IMAGE
  // before the person says a word is the top block/report trigger. The AI now
  // opens with TEXT ONLY (its reply already shares the app.untitledad.in/led
  // link, which carries the poster + video + map). The poster/photo is still
  // sent CONTEXTUALLY below — only when the customer asks to see a specific
  // city (the engagement-gated `photoUrl` path). `firstContact` (line ~183) is
  // retained for a possible future "send poster once they reply" gate.
  // DO NOT re-add an auto-image on firstContact without owner sign-off — it is
  // the exact signal this removal exists to stop (§115 live-AI change).

  try {
    if (reply) { const id = await sendWa({ type: 'text', text: { body: reply } }); await logOut('text', reply, id) }
  } catch (e) { return nope('send_failed:' + String(e?.message || e), 502) }
  // Photo is best-effort — the text already went; a bad/unreachable photo_url
  // must not fail the whole reply.
  if (photoUrl) {
    try { const id = await sendWa({ type: 'image', image: { link: photoUrl } }); await logOut('image', photoCity ? `📷 ${photoCity} station` : '📷 Photo', id, photoUrl) }
    catch { /* photo skipped — text delivered */ }
  }

  return ok({ photo: !!photoUrl })
}
