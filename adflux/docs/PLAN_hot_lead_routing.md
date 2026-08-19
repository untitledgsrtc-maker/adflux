# Hot-Lead Routing + Assisted Close — Design Spec

**Owner:** Brijesh Solanki · **Date:** 2026-08-19 · **Status:** Phase 1 approved for build; Phase 2 outlined (needs its own detail round)

**Goal (owner's words):** When a WhatsApp/QR campaign lead shows buying intent — asks for a quote, or asks to connect with the team — auto-classify it HOT, drop it in a separate HOT bucket in Follow-ups, and connect the owning rep directly. Plus an AI agent that helps close (assisted): warms the lead, and (Phase 2) sends a standard-rate quote PDF to private customers only.

**Owner decisions locked (this brainstorm):**
- **Assisted close**, not autonomous — the AI never negotiates or books; a human closes.
- **AI at the hot moment:** if they ask *price/details* → keep warming (never a final price). If they ask to *talk to a person/team* → go silent, hand to the rep.
- **HOT alert + bucket go to the rep the lead is already assigned to** (its current owner — today WhatsApp leads route to the telecaller, Rima).
- **AI quote (Phase 2) = a standard-rate starter quote** at the published rate card (no discount), private customers only. **Government body → never quote** — hand to the team (§4 rules).
- **Split into two phases** — Phase 1 (routing, no money) ships first; Phase 2 (AI quote) is designed separately.

---

## What already exists (reuse — do NOT rebuild)

Verified against the code (exploration workflow, 2026-08-18):

- **The AI WhatsApp responder** — `api/wa/ai-reply.js` (Edge, fired by a pg_net trigger on inbound). Already reads the thread, grounds a reply in live GSRTC data, and **already detects buy-intent** via its price/booking backstop (~`:286-298`): when the customer asks exact pricing or to book, it swaps in a "our team will share a tailored quote" line and sets `ai_paused=true`. **This is the closest thing to an intent detector — it just never tells a human.**
- **The `heat` flag** — `leads.heat` (`hot`/`warm`/`cold`), with auto-heat triggers already flipping it from call outcomes (positive → hot). A durable "hot" flag exists and is trigger-wired. **Reuse `heat='hot'` — do NOT invent a second definition of "hot" (§71).**
- **The push rails** — campaign C5 new-lead push + §206 per-message push already `enqueue_push()` to the routed rep. A HOT alert is a **new tag/title on the existing mechanism**, not new infra.
- **The follow-up push on spawn** — a same-day `follow_ups` INSERT already fires ONE push via `tg_push_followup_due` (§106). Spawning a HOT task therefore notifies the rep by itself.
- **FollowUpsV2 `<Section>` is generic** — a new HOT section needs no new component, just a new bucket + `heat` in the follow-up's lead embed (currently absent).
- **`keepInFollowupQueue`** (`src/utils/followups.js`) — the single shared list/count gate (§71/§175). A HOT re-grouping of rows that already passed it does not touch it.
- **Hot-first sort precedent** — `TelecallerV2.jsx` already sorts its queue hot-first via `HEAT_RANK`. Copy the pattern.

---

## Phase 1 — Hot routing (BUILD FIRST)

### The flow (plain language)

1. A WhatsApp/QR lead chats with the AI as today.
2. The AI recognises buying intent, of two kinds:
   - **Price / quote / details ask** → mark **HOT (quote)**. The AI *keeps warming* them — pitch, city photos, the `/led` link — but still **never states a final price** ("our team will confirm the exact rate").
   - **Wants a human / "connect me to your team"** → mark **HOT (human)**. The AI **goes silent** on that thread (`ai_paused=true`) and its last line is "our team will contact you shortly."
3. On either HOT signal, instantly:
   - Set the lead **`heat='hot'`**.
   - Spawn a **one-off "HOT — respond now" task** in the follow-ups of the rep who owns the lead, dated **today**.
   - Fire **one HOT alert** to that rep's phone, clearly labelled HOT (distinct from the routine follow-up ping).
4. The rep sees it in a **red HOT bucket pinned to the top of the Follow-ups page** (above Overdue), hot leads first.
5. Rep taps **Call** or **WhatsApp** → connects directly → prices & closes with the buttons already there (Send quote / Create quote).

### How the AI emits the signal (mechanism)

The AI (not a keyword list) decides intent — it does this better across English/Hindi/Gujarati. In `ai-reply.js`, the system prompt is taught to append a hidden control marker to its reply, same pattern as the existing `PHOTO: <city>` marker (§257.7):

- `HOT: quote` — customer asked price/quote/details.
- `HOT: human` — customer asked to talk to a person / the team.

The Edge endpoint parses + strips the marker before sending, then:
- Calls a new DB RPC **`flag_lead_hot_from_wa(p_lead_id, p_reason)`** (below) for both markers.
- For `HOT: human` only, also sets `ai_paused=true` on the conversation (the existing mechanism) so the rep owns the chat.

### The DB piece — `flag_lead_hot_from_wa(p_lead_id, p_reason)`

A new **SECURITY DEFINER** RPC (runs as postgres), **REVOKEd from anon/authenticated, GRANT to `service_role` only** (the Edge fn calls it with the service role — same posture as the §162 push cron / §55 campaign push). Wrapped in `BEGIN … EXCEPTION WHEN OTHERS THEN` so it can **never break the AI reply**. It:

1. `UPDATE leads SET heat='hot' WHERE id = p_lead_id AND COALESCE(heat,'') <> 'hot'` — idempotent; **does NOT touch `cadence_paused`** (campaign leads stay paused on purpose — §53).
2. Spawns the HOT task **only if no open HOT task already exists** for the lead (idempotency — repeated hot signals don't pile up tasks):
   - `assigned_to = COALESCE(telecaller_id, assigned_to)` (the lead's owner).
   - `follow_up_date = <IST today>`, **`follow_up_time = NULL`** (§106 foot-gun — a same-day row with a time double-pings via the cron).
   - `note = 'HOT — ' || p_reason` (e.g. "HOT — asked for a quote").
   - **`auto_generated = false`, `cadence_type = NULL`** → the cadence / auto-Lost machinery ignores it (it's a one-off task, not a chase row).
   - This INSERT fires the existing `tg_push_followup_due` push (§106) — the rep's HOT alert. (Whether that push carries a distinct "HOT" title, or a second dedicated `enqueue_push` fires it, is settled in the plan — the requirement is ONE clearly-HOT alert, no double-ping.)

### The HOT bucket — `FollowUpsV2.jsx` (§28 FROZEN → guardian)

- Add **`heat`** to the follow-up query's lead embed (the one real data gap).
- Render a new **`<Section title="Hot" tone="danger">`** pinned above Overdue, drawn from the **same `rows`** that already passed `keepInFollowupQueue` (additive re-list — a hot *overdue* row shows in BOTH Hot and Overdue; lower-risk than an exclusive re-partition).
- Because the HOT signal spawns a follow-up task, a brand-new WhatsApp lead (which otherwise has no follow-up row) now appears here.

### Safety / landmines (design around these)

- **Do NOT un-pause cadence.** Setting `heat='hot'` must not wake the auto-chase or auto-Lost. The RPC touches only `heat` + a one-off task; `cadence_paused` is left alone.
- **One meaning of "hot" (§71).** Reuse `leads.heat='hot'`. The two-intent split (quote vs human) differs ONLY in `ai_paused` (on the conversation) — no new lead column needed.
- **`keepInFollowupQueue` unchanged.** The HOT section re-groups rows that already survived it. Assume hot does **NOT** override Nurture-parking (a hot *Nurture* lead's near-term rows stay hidden) unless the owner later asks — that would be a `keepInFollowupQueue` change = guardian/§310 territory, out of scope for Phase 1. (A fresh WhatsApp hot lead is stage `New`, so this edge rarely bites.)
- **`follow_up_time = NULL`** on the HOT task (§106).
- **Idempotent** — no duplicate HOT tasks; `heat` update is a no-op when already hot.
- **`FollowUpsV2.jsx` is §28 FROZEN** → `sales-module-guardian` PASS before commit. The heat-embed + additive HOT-Section touch no stage/cadence/`keepInFollowupQueue`/call-chain contract → the low-risk shape, but the audit is mandatory.
- **§45 no-slowdown** — the HOT section is a client-side re-group of already-fetched rows; no new heavy query on the hot path. `ai-reply.js` gains one best-effort RPC call (fire-and-forget style, EXCEPTION-wrapped) — zero added latency to the reply.

### Acceptance criteria (Phase 1)

1. A WhatsApp lead asks "what's the price / send me a quote" → within seconds: lead is `heat='hot'`, a "HOT — asked for a quote" task appears in the owning rep's **Follow-ups HOT bucket**, and the rep gets **one** HOT phone alert. The AI keeps replying (warming), **never states a final price**.
2. A WhatsApp lead asks "can I talk to someone / connect me to your team" → same as (1) **plus** the AI goes silent (`ai_paused`) and its last line is the hand-off line.
3. The HOT bucket sits at the **top** of Follow-ups, red, above Overdue, hot leads first. Opening a row → Call / WhatsApp works.
4. Flagging hot does **not** un-pause cadence or trigger auto-Lost; no duplicate HOT tasks; no double push.
5. Non-hot leads and the rest of Follow-ups are byte-unchanged. `sales-module-guardian` PASS.
6. Cross-role: the HOT section shows for whoever owns hot leads (sales / telecaller / agency); a rep with no hot leads sees no HOT section (empty → hidden); admin sees hot activity via the existing team dashboard.

### Files to change/create (Phase 1)

| File | Change | Frozen? |
|---|---|---|
| `api/wa/ai-reply.js` | System-prompt: teach the `HOT: quote` / `HOT: human` markers + the two-intent rule. Parse + strip the marker; call `flag_lead_hot_from_wa`; set `ai_paused` on `HOT: human`. | No (live, careful) |
| `supabase_phaseNNN_hot_lead_routing.sql` (new) | `flag_lead_hot_from_wa(uuid, text)` DEFINER RPC (heat + one-off HOT task + push, idempotent, EXCEPTION-wrapped, REVOKE anon/authenticated + GRANT service_role). | New |
| `src/pages/v2/FollowUpsV2.jsx` | Add `heat` to the follow-up lead embed + a HOT `<Section>` pinned on top. | **§28 FROZEN — guardian** |

---

## Phase 2 — AI standard-rate quote (BUILD SECOND — its own detail round)

**Not designed in full here.** Owner picked: the AI sends a **standard-rate starter quote** PDF at the **published rate card** (no discount, no negotiation), **private customers only**, after a qualifying flow. Government → never quote, hand to team.

### Shape
1. Before quoting, the AI asks: **"government body or private (company / proprietor / individual)?"**
2. **Government → does not quote.** Says "our government team will prepare this properly" + the lead is HOT + handed to the human (govt quotes need §4 rules: Untitled Advertising entity, DAVP/GSRTC, signers, ref formats — off-limits to the AI).
3. **Private → qualifies** (city / media / screens / months + name) → generates a **standard-rate PDF** with their name → sends it in-window (reuse the `api/wa/send.js` quote-PDF path, §254). Rep still negotiates + closes.

### Why it's a separate, bigger build (the honest gaps)
- **No headless quote-builder today** — quotes are React-wizard-only; there's no server RPC that takes `{lead_id, city/media, screens, months}` → computes a price → creates the quote + PDF. That's the core new piece.
- **Controlled price-wall lift** — the AI is deliberately blocked from stating any price (§115). Phase 2 lifts it for a **rate-card-computed number only** (never free-text, never a discount).
- **§4 two-company rules** — a private quote is Untitled Adflux Pvt Ltd with the right rate card + tax; the govt gate keeps the AI away from the govt entity entirely.
- **Trust the qualifying answer?** — a customer could claim "private" to get a quote; the rep verifies before a real close. A standard-rate starter PDF isn't binding, so this is acceptable for v1 (flag it).

### Open questions for Phase 2's detail round (ask before building)
1. Which **rate card** is "standard"? (`cities.offer_rate` per city? the ₹75 starter? a fixed per-media table?) The AI needs one machine-readable standard price.
2. The exact **qualifying script** + how few questions can produce a usable starter quote.
3. Should the standard-rate quote be a **real `quotes` row** (shows in the pipeline, ref number, §11 lead linkage) or a lighter "starter estimate" PDF that isn't a full quote object?
4. Guardrails: caps, the "standard rates only — final on confirmation" disclaimer on the PDF, and what stops the AI quoting a government lead that lied about being private.

---

## Build order
1. **Phase 1** — hot routing (this spec, full detail). One SQL RPC + `ai-reply.js` prompt/marker + the FollowUpsV2 HOT bucket. Guardian on FollowUpsV2. Ships the hot-bucket + team-connect ask with zero money risk.
2. **Phase 2** — AI standard-rate quote. Own spec after Phase 1 ships, answering the four open questions above.
