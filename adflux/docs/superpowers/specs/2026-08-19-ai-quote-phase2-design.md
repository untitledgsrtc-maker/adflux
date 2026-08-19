# Phase 2 — AI standard-rate quote (WhatsApp) · Design

**Owner:** Brijesh Solanki · **Date:** 2026-08-19 · **Status:** design approved-pending; Phase 1 (hot routing) shipped (§209).

Supersedes the earlier Phase 2 sketch (single-city, priced-text-in-chat) — reworked per the
owner's 2026-08-19 direction.

## Goal
On WhatsApp, the AI first **understands the customer's need**, **explains the GSRTC LED
screens + the CPM value** (in simple language), then **auto-sends a formal quote PDF** at the
published standard rate. Private customers only; government is handed to the team (§4).

## Owner decisions (LOCKED — do not re-litigate)
1. **No "₹75 starts at" framing** — removed from the AI's knowledge base entirely.
2. **Understand the need FIRST** — the AI asks (one at a time, warmly): what are you promoting? ·
   what's the goal (awareness / launch / offer / footfall)? · which area or cities? — THEN
   recommends cities + explains value.
3. **Price only via the quote, NOT chat** — the AI never states the total deal price in chat.
   BUT the **CPM efficiency number (₹ per 1000 people) IS stated in chat** (owner's explicit
   choice) to justify value. The total package price lives only in the auto-sent quote PDF.
4. **Whole-city combo pricing** — a city is sold as ALL its screens together (e.g. all 20 in
   Surat, never 7). The screen count is NOT a customer input; it is `cities.screens`.
5. **Multiple cities in one quote** — the AI recommends cities for the need; the customer picks
   which; one quote sums each city's full combo.
6. **AI auto-sends the formal quote PDF itself** (not the rep). Requires a server-side renderer.
7. **Consolidate an existing function to free a Vercel slot** (free plan, not Pro upgrade).
8. **Ship it all together** — nothing goes live until the renderer + slot are done; the AI
   auto-sends the PDF from the very first customer.

## The conversation flow (ai-reply.js system prompt)
1. **Understand** — business + goal + area (§decision 2).
2. **Explain the screens** (plain words): 264 LED screens · 20 GSRTC bus stations · captive
   commuter audience 14 hrs/day · **AI cameras count real viewers** (measured, not a guess).
3. **CPM in simple language** — the number is DB-computed (never the model's arithmetic) and
   injected into the prompt per city as "about ₹X per 1000 people":
   > "A hoarding — you pay fixed rent whether 100 or 10,000 pass, nobody counts. Our screens:
   > AI cameras count the real people who see your ad. In **Surat** that's about **[X]/day** →
   > around **[Y] measured views a month**, only about **₹[Z] per 1000 people** — that's CPM.
   > A hoarding or newspaper costs many times more per thousand."
4. **Recommend cities** for the need → customer picks cities + months.
5. **Govt gate** — the AI asks government vs private FIRST. Government → does NOT quote; says the
   govt team will prepare it; adds `HOT: human`. Private → proceeds.
6. Once {private + cities + months} → the AI adds a hidden final line
   `QUOTE: cities=Surat,Rajkot; months=3` (NO screen count — whole-city combo). The AI's own
   text stays short/warm ("Let me prepare your detailed quote") and states NO total price.

## Components

### 1. `quotes.source` column (P0 — it does not exist today)
`ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS source text;` (nullable). Shipped in the
phase325 SQL with a VERIFY. Without it the RPC throws 42703 on every call (the review's P0).

### 2. `ai_build_quote(p_lead_id uuid, p_cities text[], p_months integer)` — SECURITY DEFINER RPC
- Resolve lead: segment, owner `COALESCE(telecaller_id, assigned_to)`, name/company/phone.
- **§4 hard-gate**: `segment='GOVERNMENT'` → return `govt_blocked` BEFORE any insert.
- NULL owner → `no_owner` (never an orphan quote). Clamp months 1..12.
- For EACH city in `p_cities`: **exact case-insensitive match only** on `cities.name`
  (`is_active`) — the review's mis-price fix: NO fuzzy fallback; an unmatched city → refuse the
  whole quote (`city_not_found`) rather than mis-price. Line = the city's FULL combo:
  `screens = cities.screens`, `offered_rate = cities.offer_rate`,
  `campaign_total = round(offer_rate × cities.screens × p_months)`. Refuse a ₹0-rate city.
- `subtotal = Σ campaign_total`; `gst = round(subtotal × 0.18)`; `total = subtotal + gst`.
- INSERT `quotes`: segment='PRIVATE', media_type='LED_OTHER', rate_type='AGENCY',
  **source='ai_quote'**, status='sent', revenue_type='new', client_* from the lead,
  created_by=owner, sales_person_name=owner name, lead_id, duration_months, subtotal,
  gst_rate=0.18, gst_amount, total_amount. OMIT quote_number → the BEFORE-INSERT trigger stamps
  `UA-2026-NNNN` (media_type=LED_OTHER branch).
- INSERT one `quote_cities` per city (city_id, city_name, screens=cities.screens, grade,
  listed_rate=monthly_rate, offered_rate, campaign_total, duration_months, impressions_*,
  slot_seconds=10, slots_per_day=100; ref_kind defaults 'CITY'; GST line-cols NULL).
- §12 client upsert: dedup by `(btrim(phone), created_by)` (review P3 — btrim to match syncClient).
- §11: `UPDATE leads SET stage='QuoteSent', quote_id=<new>, heat='hot'` — does NOT touch
  `cadence_paused` (§53).
- **Idempotency**: a partial UNIQUE index on the identical config prevents a concurrent
  double-insert (review P2) — `(lead_id, source, p_months)` + a same-10-min guard; a genuinely
  different config later = a new quote.
- Posture: `search_path=public,pg_temp`, whole body EXCEPTION-wrapped → returns
  `{ok:false,error:'internal'}`, never raises (§45/§46). **REVOKE PUBLIC/anon/authenticated +
  GRANT service_role.** Add `ai_build_quote` to the **§211 re-lock list** (review P2).
- Returns jsonb: `{ok, ref, cities:[{name,screens,rate,total}], subtotal, gst, total}`.

### 3. Server-side PDF renderer (`@react-pdf`, Node — the long pole)
- A Node module `renderQuotePdfBuffer(quote, cityRows)` using `@react-pdf/renderer`'s
  `renderToBuffer` (already a dependency; runs in Node, NO browser/Chromium). Resurrect a
  private-LED quote `Document` (the dropped QuotePDF §88.5) with the current brand palette (§9
  day-theme), the multi-city line table, GST, total-in-words (§18), bank/company from the
  `companies` row (segment=PRIVATE, §4 — never hardcode), and a **CPM justification block**
  (per-city measured views → ₹ per 1000 → vs a hoarding).
- A Node endpoint (the freed slot) `POST /api/quote/render {ref | quote_id, secret}`:
  loads the quote + quote_cities + company row → renders the buffer → uploads to
  `quote-pdfs/<ref>.pdf` (upsert) → returns ok. Secret-gated (like ai-reply's ta-secret),
  service-role only.
- **Visual note (accepted v1):** this @react-pdf PDF differs from the rep's html2canvas
  `QuotePDFHtml`. The stored `quote-pdfs/<ref>.pdf` is what the AI attaches; if a rep later
  opens+shares, `uploadQuotePDFHtml` overwrites it with the html2canvas version. Unify later.

### 4. Free a Vercel function slot (consolidate)
Identify two SMALL adjacent Node endpoints and merge into one (an internal `?action=` branch),
freeing a slot so the render endpoint is the 12th not the 13th (§219). Build task: enumerate
`api/*` Node vs Edge, pick two safe-to-merge, test both paths before/after.

### 5. ai-reply.js QUOTE flow (rework)
- System prompt: the understand→explain→CPM→combo→govt-gate instructions (above); remove ₹75;
  inject per-city CPM (₹/1000) + impressions.
- Parse `QUOTE: cities=…; months=…` (comma city list, no screens), strip it (global, §324
  pattern). On {cities, months} + `conv.lead_id`, DEFERRED to after the main reply sends:
  call `ai_build_quote` → on ok, POST `/api/quote/render` → attach the document via `sendWa`
  ({type:'document', document:{link: signed quote-pdfs URL, filename: '<ref>.pdf'}}). On
  `govt_blocked` → hand-off text + `ai_paused`. Other errors → nothing (AI re-engages).
- The total price is NEVER in the AI's text; the CPM ₹/1000 IS (DB-injected). §115 risky
  backstop still guards the AI's own reply (CPM is 2-digit, won't trip).

## Testing / acceptance
1. Private customer: understand → explain → CPM stated in chat → picks Surat+Rajkot, 3 months →
   receives a formal PDF quote (all screens of each city, correct rate/GST/total) from the brand
   number. A real `UA-2026-NNNN` quote appears in the pipeline (source='ai_quote', Rima-owned,
   lead=QuoteSent+hot).
2. Government customer: AI never quotes; says the govt team will prepare it; goes silent
   (ai_paused). The RPC refuses a GOVERNMENT-tagged lead (govt_blocked) even if reached.
3. No total price ever in chat; the CPM ₹/1000 IS in chat; no "₹75".
4. A partial-screen ask ("7 of Surat's 20") → the AI explains it's the full-city network.
5. Concurrent double-emit → one quote (idempotency). Wrong/unknown city → refuse, not mis-price.
6. Adversarial review: security (RPC + render endpoint) + §4/money correctness + ai-reply flow.

## Risks / open
- **Renderer is the long pole** + the function-slot consolidation carries live-endpoint risk
  (§35 blast-radius — test both merged paths).
- CPM number in chat is a price-derived figure (owner accepted). Keep it DB-injected, not model
  math.
- The auto-sent PDF differs visually from the rep's PDF until unified (accepted v1).
- Trust the "private" answer (a govt buyer could lie) — the standard private-media estimate is
  low-stakes + the govt process is separate; RPC refuses GOVERNMENT-tagged (accepted v1).
