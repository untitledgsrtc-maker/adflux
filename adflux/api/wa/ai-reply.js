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
// AI real-PDF — the headless-Chromium render service (a 2nd Vercel project).
// When QUOTE_RENDER_URL is set, the AI sends the REAL branded 3-page PDF (the
// exact rep-download format). Unset → the pdf-lib fallback below fires, so
// nothing changes for the customer until the owner deploys the service +
// sets the env (zero-regression deploy order).
const QUOTE_RENDER_URL  = process.env.QUOTE_RENDER_URL || ''
const RENDER_SECRET     = process.env.RENDER_SECRET || ''
// Fallback — the Edge pdf-lib text renderer (same deploy). Reuses AI_REPLY_SECRET.
const PDFLIB_RENDER_URL = 'https://app.untitledad.in/api/quote/render'

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
- A city is sold as its FULL screen combo — all of that station's screens together, for the months chosen (we do not sell a partial handful of a station's screens). The exact package price is shared only in a formal quote, NEVER stated in chat. To show VALUE, talk in CPM — the cost to put an ad in front of 1,000 people — which is a fraction of a hoarding or newspaper (per-city figures are given below). Never state a package total in chat.
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
- Answer ONLY what they asked. A first reply covers just: what it is (LED ad screens at Gujarat bus stations) and the link https://app.untitledad.in/led. Do NOT state a price or a starting rate in chat.
- Ask ONE simple question at a time (e.g. "Which city are you looking at?") — never two questions in one message.
- Everything above (why we're different, how it works, proof, stations) is BACKGROUND — share ONE relevant point only if they ask, never all of it.
- Reply in the customer's own language (English, Hindi or Gujarati) matching how they wrote.
- Add 1-2 light, natural WhatsApp emoji where they fit (e.g. 📍 for a city, 👍 to acknowledge) — warm and human, never spammy.
- FOOTFALL IS NOT A PRICE. When you mention how many people see a station, say it clearly as the daily AUDIENCE — e.g. "about 7,500 people see it there every day" — NEVER a bare "~7,500/day" that a customer could mistake for a cost. Do NOT put a package price or starting rate in chat at all (that lives only in the formal quote/PDF). The ONLY rupee figure allowed in chat is an explicit CPM — "about Rs X to reach 1,000 people" — taken from the CPM list; never write any other number next to Rs, and never frame audience/footfall as money.
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
  const conv = (await (await sb(`whatsapp_conversations?id=eq.${convId}&select=id,customer_wa_id,whatsapp_account_id,window_expires_at,ai_paused,lead_id,location_id&limit=1`)).json())?.[0]
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
    allCities = ((await (await sb(`cities?select=name,photo_url,youtube_url,impressions_day,impressions_month,offer_rate,screens&is_active=eq.true&limit=300`)).json()) || []).filter((c) => c && c.name)
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

  // Phase 2 — per-city CPM (cost to reach 1,000 people), DB-COMPUTED (never model math) so the
  // AI can justify value without stating a package total (owner: price only in the quote/PDF).
  // CPM = round((offer_rate × screens) / impressions_month × 1000). Shown ONLY in a sane band
  // [1..500] — this self-guards the impressions_month interpretation: if the column turns out to
  // be per-SCREEN (→ an absurd <Rs 1 CPM) the figure is DROPPED, never shown as nonsense.
  // ⚠ SMOKE-VERIFY on the live number: confirm a real city's "about Rs X to reach 1,000 people"
  // reads sane (a competitive Rs ~10-40), which also confirms impressions_month is per-CITY.
  const cpmRows = allCities
    .map((c) => {
      const rate = Number(c.offer_rate) || 0
      const scr  = Math.max(Number(c.screens) || 0, 0)
      const im   = Number(c.impressions_month) || 0
      if (rate <= 0 || scr <= 0 || im <= 0) return null
      const cpm = Math.round((rate * scr) / im * 1000)
      return cpm >= 1 && cpm <= 500 ? { name: c.name, cpm } : null
    })
    .filter(Boolean)
  if (cpmRows.length) {
    system += `\n\nCPM — VALUE (cost to reach 1,000 people; a LOWER number is better; ours is a fraction of a hoarding/newspaper). Use ONLY the exact per-city figure below, ONLY to justify value; frame it as cost-efficiency, NOT a package price, and never add/multiply it into a total or reveal it as "the cost":\n${cpmRows.map((c) => `- ${c.name}: about Rs ${c.cpm} to reach 1,000 people`).join('\n')}`
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
    system += `\n\nThis is the customer's VERY FIRST message to us. Reply in 1-2 short, warm lines ONLY. Do NOT pitch, do NOT list features or numbers, do NOT push, do NOT send a price. Just greet warmly, answer only what they actually asked (if anything), and — if they gave no detail — ask which city they are interested in. Keep it human and brief. Do NOT add a PHOTO line on this first reply. Do NOT add a QUOTE line on this first reply — never build or send a quote before the customer has engaged.`
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

  // Phase 324 — hot-lead routing. Teach the AI to flag real buying intent with a
  // hidden control marker (same mechanism as PHOTO). The endpoint parses + strips it,
  // flags the lead hot, and drops a HOT task on the owning rep (docs/PLAN_hot_lead_routing).
  system += `\n\nBUYING-INTENT SIGNAL (hidden — for our team only, the customer NEVER sees this):\n- If the customer asks for a PRICE, a QUOTE, rates, or specific booking details → add, as the VERY LAST line, exactly: HOT: quote  (and keep helping/warming them normally — you still NEVER state a final price).\n- If the customer EXPLICITLY asks to TALK TO A PERSON / your team / a callback / "connect me" → add, as the VERY LAST line, exactly: HOT: human  (and tell them our team will contact them shortly). Do NOT use HOT: human for a PRIVATE customer who simply gave you a city + duration — that is a QUOTE (step 5 below), which our system AUTO-SENDS; only hand off when they clearly want a human, or it is a GOVERNMENT body.\n- Add AT MOST ONE such line, only when the intent is clear, always as the final line. It is stripped before sending — never mention it, never explain it.`

  // Phase 2 — AI standard-rate quote. UNDERSTAND → EXPLAIN → CPM → whole-city combo →
  // multi-city QUOTE marker → govt gate. PRIVATE only; GOVERNMENT handed to the team (§4).
  // The DB builds + the endpoint renders + auto-SENDS a formal PDF — the AI never states a price.
  system += `\n\nSTANDARD QUOTE (private customers only) — follow this order:\n1. UNDERSTAND the need first, ONE warm question at a time: what are they promoting (their business / product)? what is the goal (awareness / a launch / an offer / footfall)? which area or cities?\n2. EXPLAIN briefly what the screens are + why they are measurable, and — when it helps — the CPM value for the city they care about (cost to reach 1,000 people, from the CPM list above). Never state a package total.\n3. QUALIFY: are they a PRIVATE business (company / shop / proprietor / individual) or a GOVERNMENT department / body?\n   - GOVERNMENT → do NOT quote. Say our government team will prepare it properly, and add the final line: HOT: human. Never give a government body a price.\n4. A city is booked as its FULL screen combo — the customer NEVER picks a number of screens. If they ask for only some of a city's screens (e.g. "7 of Surat's 20"), explain warmly that a station is taken as its complete screen network, not a partial few.\n5. PRIVATE customer, once you know which CITY (or cities) + how many MONTHS → add, as the VERY LAST line, exactly: QUOTE: cities=<City1,City2>; months=<M>  (comma-separate the cities they chose; NO screen count). Our system then builds the real quote at our standard rate and AUTO-SENDS a formal PDF instantly — so keep YOUR text short and warm ("Let me prepare your detailed quote — sending it across now"). CRITICAL: for a PRIVATE customer who has told you a CITY + MONTHS, emitting the QUOTE marker is the ONLY correct action. Do NOT hand off — NEVER say "I'll pass this to our team", "our team will share a quote", or add HOT: human — the SYSTEM sends the PDF, not a human. And do NOT state any price/rate/total yourself. The marker is stripped before sending; never mention it.`

  // Be DECISIVE toward the quote — don't over-qualify or stall a price-ready customer.
  system += `\n\nMOVE TOWARD THE QUOTE — do NOT stall a customer who wants a price. When a private customer signals price intent ("price please", "how much", "send rates") and names an AREA or region instead of exact stations (e.g. "cities near Vadodara", "somewhere in Saurashtra"), do NOT ask them to re-pick — PROPOSE the specific covered stations you have near there (name 2-4 from the coverage list) and ask for the ONE thing still missing, usually just: for how many months? Ask ONE question, never two. The moment you have the covered cities + months, emit the QUOTE marker and let the system send the PDF. Never leave a price-ready customer waiting on a vague open question.`

  // QR-scan customers are a LOCAL Gujarati audience → always Gujarati, AND the city is
  // already known (the station they scanned) → quote fast, don't re-qualify (owner rule).
  if (conv.location_id) {
    system += `\n\nLANGUAGE OVERRIDE — this customer reached us by scanning a QR code at one of our GSRTC bus stations, so they are a LOCAL Gujarati audience. ALWAYS reply in GUJARATI (ગુજરાતી), warm and natural, no matter what language they wrote in. This OVERRIDES the language-matching rule above.`
    system += `\n\nQR SCAN — the customer scanned the QR AT a specific station; their FIRST message names it (e.g. "Bhavnagar bus station"). That station's CITY is the city they want — you ALREADY know it, so do NOT ask "which city?". Move fast: reply warmly, and as soon as you know how many MONTHS, emit QUOTE: cities=<that station's city>; months=<M> and let the system send the PDF. If months are not clear yet, ask ONLY "for how many months would you like it?" — nothing else. A religious mission / temple / trust / NGO / charity is a PRIVATE customer → quote them normally; ONLY an actual GOVERNMENT department or body is treated as government (hand-off, no quote).`
  }

  // Phase 2 (WhatsApp Agent v2) — OBJECTIONS, HESITATION, CLOSE + a hidden lead-note marker.
  system += `\n\nOBJECTIONS & HESITATION — answer warmly, never hand off or discount:\n- "Too expensive" / "costly" → do NOT apologise or offer a discount. Reframe to value using the CPM ("about Rs X to put your ad in front of 1,000 people — a fraction of a hoarding you can't even measure"), and that they pay to actually REACH people and can SEE it working. Rates are standard and shared only in the quote.\n- "Does it really work?" / trust → the proof: AI-verified views, and every screen's QR turns a viewer into a tracked lead with a per-screen dashboard. A funnel you watch, not impressions you guess.\n- "Will my ad actually run?" → each screen plays ~14 hours a day with AI-tracked daily impressions.\n- "Just looking" / "I'll think about it" / "let me discuss" → warm, zero pressure ("totally fine 👍"). Offer ONE small next step only — a city photo, or "I can prepare a quote so you have the exact numbers to decide" — then let it rest.\n- Discount / "can you do better" → the quote is our standard rate; a bigger/volume plan our team can discuss. Never promise a discount or a lower number yourself.`
  system += `\n\nMOVE TO THE QUOTE — you do NOT need their business type or goal to quote; a covered CITY + how many MONTHS is enough. As soon as a private customer gives the city + months, emit the QUOTE marker. After the quote PDF is sent, add ONE soft closing line on the next turn: "Shall I have our team reserve these screens for you?" — a yes is strong intent (you may add HOT: human so a person closes). Never state a price yourself.`
  system += `\n\nLEAD NOTE (hidden — our team only, the customer NEVER sees it): once you understand what they want, add as a line exactly: SUMMARY: <one short line — what they promote, the city/cities, months, any key detail>. Example: SUMMARY: garba event organiser, Gandhinagar, 1 month, wants launch reach. Add at most one; it is stripped before sending; never mention it.`

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

  // Phase 261.1 — keep the model's raw text so a control marker (PHOTO/HOT/QUOTE) that
  // strips the reply to empty can NEVER silently ghost the customer (§133 "not responding
  // to everyone" — the AI went dark at the private-qualify turn when the model emitted a
  // bare QUOTE marker). If rawReply was non-empty but reply is empty after stripping, we
  // fall back to a warm line below instead of returning empty_reply.
  const rawReply = reply

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

  // Phase 324 — HOT buying-intent marker. Strip it, flag the lead hot (best-effort,
  // EXCEPTION-wrapped RPC → never blocks the reply), and on `human` hand the thread to
  // the rep (ai_paused). Reuses leads.heat='hot' (§71) + the §106 follow-up push.
  const hm = reply.match(/(^|\n)[ \t]*HOT:[ \t]*(quote|human)[ \t]*$/im)
  if (hm) {
    const hotKind = hm[2].toLowerCase()
    reply = reply.replace(/(^|\n)[ \t]*HOT:[ \t]*(quote|human)[ \t]*$/gim, '').trim()  // strip EVERY marker line — never leak a stray HOT: to the customer
    if (conv.lead_id) {
      const p_reason = hotKind === 'human' ? 'wants to talk to the team' : 'asked for a quote'
      try {
        await sb('rpc/flag_lead_hot_from_wa', { method: 'POST', body: JSON.stringify({ p_lead_id: conv.lead_id, p_reason }) })
      } catch { /* hot-flag is best-effort — never block the reply */ }
    }
    if (hotKind === 'human') {
      // hand the thread to the rep: this reply (the hand-off line) still sends; ai_paused
      // just stops FUTURE AI replies so a human closes.
      try { await sb(`whatsapp_conversations?id=eq.${convId}`, { method: 'PATCH', body: JSON.stringify({ ai_paused: true }) }) } catch { /* best-effort */ }
    }
  }

  // Phase 2 (WhatsApp Agent v2) — SUMMARY marker → persist a one-line brief to the lead so a rep
  // who picks up a hot AI lead sees WHY without reading the whole chat. Strip it always. Best-effort,
  // and it NEVER overwrites a rep's own note (only writes when notes are empty or a prior [AI] note).
  const sm2 = reply.match(/(^|\n)[ \t]*SUMMARY:[ \t]*(.+?)[ \t]*$/im)
  if (sm2) {
    reply = reply.replace(/(^|\n)[ \t]*SUMMARY:[ \t]*.+$/gim, '').trim()  // strip every SUMMARY line
    const note = sm2[2].trim().slice(0, 300)
    if (note && conv.lead_id) {
      try {
        const cur = (await (await sb(`leads?id=eq.${conv.lead_id}&select=notes&limit=1`)).json())?.[0]?.notes
        if (!cur || /^\[AI\]/.test(String(cur).trim())) {
          await sb(`leads?id=eq.${conv.lead_id}`, { method: 'PATCH', body: JSON.stringify({ notes: `[AI] ${note}` }) })
        }
      } catch { /* best-effort — a note write must never block the reply */ }
    }
  }

  // Phase 2 — QUOTE marker (MULTI-CITY, whole-city combo — NO screen count). Extract
  // {cities[], months} + strip it. The build + render + send is DEFERRED to after the main
  // reply sends (below) so a superseded/failed reply never mints an orphan quote. Screens +
  // rate come only from the DB rate card (cities.screens / cities.offer_rate), never the AI.
  let quoteReq = null
  const qm = reply.match(/(^|\n)[ \t]*QUOTE:[ \t]*(.+?)[ \t]*$/im)
  if (qm) {
    reply = reply.replace(/(^|\n)[ \t]*QUOTE:[ \t]*.+$/gim, '').trim()  // strip every QUOTE marker
    const spec = qm[2]
    const citiesRaw = (spec.match(/cities?\s*=\s*([^;]+)/i) || [])[1] || ''
    const months = parseInt((spec.match(/months?\s*=\s*(\d+)/i) || [])[1], 10)
    // Dedup case-insensitively — a repeated city (Surat,Surat or Surat,SURAT) would
    // otherwise double-charge the quote + list the city twice on the PDF (the RPC
    // dedups too, but keep the marker clean at the source).
    const seen = new Set()
    const cities = citiesRaw.split(',').map((s) => s.trim()).filter(Boolean)
      .filter((c) => { const k = c.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true })
      .slice(0, 8)
    if (cities.length && months > 0) quoteReq = { cities, months }
  }

  // Phase 261.1 — NEVER GHOST. A control marker (PHOTO/HOT/QUOTE) can strip the
  // model's whole reply to empty. If there's still an action to send (a photo or a
  // deferred quote) OR the model actually produced text that got stripped, send a
  // warm line so the customer never gets silence (§133 — the AI went dark at the
  // private-qualify turn on a bare QUOTE marker). A genuinely empty rawReply with no
  // action still falls through to the empty_reply return below.
  if (!reply && (quoteReq || photoUrl || rawReply)) {
    reply = quoteReq
      ? 'One moment — I\'m putting your quote together and will send it across right away.'
      : 'Sharing that with you now.'
  }

  if (!reply && !photoUrl && !quoteReq) return nope('empty_reply')

  // ── backstop the two HARD rules (no final price, no booking confirmation) ──
  // The system prompt is the primary guard; this catches a jailbreak BEFORE it
  // goes out on the live brand number. On a hit, swap in a safe hand-off line
  // and pause the AI so a human closes. Indicative rates are 3-digit (650-850);
  // any 4+-digit rupee figure or a commitment word is treated as out-of-bounds.
  // HARD out-of-bounds: a real 4+-digit rupee figure or a booking-confirmation. The
  // package price lives ONLY in the PDF and the AI never confirms a booking, so this is
  // caught on EVERY turn — INCLUDING a quote turn (a leaked price must never go out on
  // the brand number, even while the real quote PDF is being sent).
  const hardLeak =
    /(₹|rs\.?|inr)\s?[\d][\d,]{3,}/i.test(reply) ||
    /\b(confirmed|guarantee[d]?|booked)\b/i.test(reply) ||
    /\bbooking\s+(is\s+)?(confirm|done|complete)/i.test(reply)
  // Phase 2 (WhatsApp Agent v2) — the SOFT "(final|total) price" phrase was tripping when the AI
  // CORRECTLY declines ("I can't share the final price here, but the value works out to…") on a
  // NON-quote turn → it discarded a useful reply AND paused the thread mid-price-conversation.
  // Only a HARD leak (a real 4+-digit rupee figure or a booking confirmation) now swaps + pauses;
  // hardLeak already catches any actual leaked NUMBER, so the benign phrase no longer kills the chat.
  if (hardLeak) {
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
    quoteReq = null   // never auto-build/send a quote PDF to a cold first-contact (unsolicited media → spam, §133/§275)
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

  // Phase 261 (2026-07-27) — auto welcome-POSTER on first contact was REMOVED to protect the
  // marketing number's quality rating (Meta flagged 98982 73686 for "sending spam" 07-27: an
  // unsolicited IMAGE before the person engages is the top block/report trigger). RE-ENABLED
  // 23-08-2026 on explicit owner sign-off (§224) — see the firstContact welcome-image send above,
  // gated on ai_welcome_image_url (text-first + opt-out line; kill switch = unset the URL). The
  // spam risk that drove the removal STANDS; the URL gate is the instant off. The contextual
  // city photo (`photoUrl`, engagement-gated) is still suppressed on firstContact.

  try {
    if (reply) { const id = await sendWa({ type: 'text', text: { body: reply } }); await logOut('text', reply, id) }
  } catch (e) { return nope('send_failed:' + String(e?.message || e), 502) }
  // Phase 2 (WhatsApp Agent v2, owner sign-off 23-08-2026, §224) — send ONE generic welcome poster
  // on the customer's FIRST message. Controlled entirely by whatsapp_accounts.ai_welcome_image_url:
  // set = on, unset = off (instant kill switch, no deploy). Text (carrying the STOP opt-out line)
  // is sent FIRST so a would-be reporter can opt out cleanly. Best-effort — a bad url never fails
  // the reply. ⚠ SPAM RISK: an unsolicited first-message image is the top block/report trigger that
  // got 98982 flagged twice (§133); owner accepted it — WATCH the quality rating, unset the URL if it dips.
  if (firstContact && acct.ai_welcome_image_url) {
    try { const id = await sendWa({ type: 'image', image: { link: acct.ai_welcome_image_url } }); await logOut('image', '📷 GSRTC LED poster', id, acct.ai_welcome_image_url) }
    catch { /* welcome poster skipped — text already delivered */ }
  }
  // Photo is best-effort — the text already went; a bad/unreachable photo_url
  // must not fail the whole reply.
  if (photoUrl) {
    try { const id = await sendWa({ type: 'image', image: { link: photoUrl } }); await logOut('image', photoCity ? `📷 ${photoCity} station` : '📷 Photo', id, photoUrl) }
    catch { /* photo skipped — text delivered */ }
  }

  // Phase 2 — build + render + auto-SEND the standard quote PDF (deferred here so a
  // superseded/failed reply never mints an orphan quote). Best-effort: the warm reply already
  // went; a quote failure just means no PDF this turn (the AI re-engages next turn). The RPC is
  // the §4 hard-gate (refuses GOVERNMENT) + the ONLY source of the price (cities rate card);
  // NO price is ever put in chat — it lives only in the PDF (owner: price via quote, not chat).
  let quoteSent = false
  let quoteHandled = false   // a graceful hand-off already went (e.g. govt) — don't double-send
  if (quoteReq && conv.lead_id) {
    try {
      const qr = await (await sb('rpc/ai_build_quote', { method: 'POST', body: JSON.stringify({ p_lead_id: conv.lead_id, p_cities: quoteReq.cities, p_months: quoteReq.months }) })).json()
      if (qr && qr.ok && qr.ref) {
        // render the PDF server-side → short-lived signed URL.
        let pdfUrl = null
        // PRIMARY: the REAL branded PDF via the headless-Chromium render service
        // (2nd Vercel project). Only when QUOTE_RENDER_URL is configured.
        if (QUOTE_RENDER_URL) {
          try {
            const rr = await (await fetch(QUOTE_RENDER_URL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-render-secret': RENDER_SECRET }, body: JSON.stringify({ ref: qr.ref }) })).json()
            if (rr && rr.ok && rr.url) pdfUrl = rr.url
          } catch { /* real render is best-effort — fall through to the pdf-lib fallback */ }
        }
        // FALLBACK: the pdf-lib text renderer (Edge, api/quote/render). The AI
        // never ghosts — if the Chromium service is down/unset, the plain PDF sends.
        if (!pdfUrl) {
          try {
            const rr = await (await fetch(PDFLIB_RENDER_URL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-render-secret': AI_SECRET }, body: JSON.stringify({ ref: qr.ref }) })).json()
            if (rr && rr.ok && rr.url) pdfUrl = rr.url
          } catch { /* render is best-effort */ }
        }
        if (pdfUrl) {
          try {
            const id = await sendWa({ type: 'document', document: { link: pdfUrl, filename: `${qr.ref}.pdf`, caption: 'Your GSRTC LED quotation' } })
            await logOut('document', `📄 Quotation ${qr.ref}`, id, pdfUrl)
            quoteSent = true
          } catch { /* document send failed — the quote still exists in the pipeline for the rep */ }
        }
        // NO priced summary in chat — the package price lives only in the PDF.
      } else if (qr && qr.error === 'govt_blocked') {
        // §4 — a government lead slipped past the AI's question; hand to the team, go silent.
        const handoff = 'Thank you! For a government project our dedicated team will prepare this properly and reach out to you shortly.'
        const id = await sendWa({ type: 'text', text: { body: handoff } })
        await logOut('text', handoff, id)
        try { await sb(`whatsapp_conversations?id=eq.${convId}`, { method: 'PATCH', body: JSON.stringify({ ai_paused: true }) }) } catch { /* best-effort */ }
        quoteHandled = true
      }
      // city_not_found / no_rate / no_owner / internal → handled by the graceful fallback below.
    } catch { /* quote is best-effort — the reply already went */ }
  }

  // NEVER GHOST a promised quote (§133). The customer was just told the quote is coming.
  // If we could NOT send it — an unresolved/bad city, no rate, no owner, no linked lead,
  // or the render/send failed — send ONE warm hand-off + pause so a human closes. A quote
  // that DID build is already a QuoteSent+hot lead in the rep's queue.
  if (quoteReq && !quoteSent && !quoteHandled) {
    try {
      const h = 'Thank you! Let me get our team to prepare and share your detailed quote with you shortly.'
      const id = await sendWa({ type: 'text', text: { body: h } })
      await logOut('text', h, id)
      await sb(`whatsapp_conversations?id=eq.${convId}`, { method: 'PATCH', body: JSON.stringify({ ai_paused: true }) })
    } catch { /* best-effort — never break the turn */ }
  }

  return ok({ photo: !!photoUrl, quote: quoteSent })
}
