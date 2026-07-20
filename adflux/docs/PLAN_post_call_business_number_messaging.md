# Plan — post-call messages sent FROM the business number (Option B)

Owner directive 20 Jul 2026: after a call outcome, the telecaller's message should
go out from the company WhatsApp number so replies land in the app inbox, not on
the rep's personal phone.

Status: PLAN ONLY. Nothing built.
**Rev 2** — rewritten after a 3-lens adversarial review corrected 10 factual errors
and surfaced 4 P0 risks the first draft missed. Errors are listed in §8 so the
mistakes aren't silently buried.

---

## 1 · What exists today (20 Jul audit)

- `PostCallOutcomeModal.handleSave()` → `onSaved({outcome, nextAction})`.
- 4 host pages react by setting `waPrompt` → `WhatsAppPromptModal`:
  `TelecallerV2`, `WorkV2`, `LeadDetailV2`, `FollowUpsV2`.
- `WhatsAppPromptModal` reads `message_templates` by `stage`, substitutes
  `{name} {company} {city}`, then **deep-links to the rep's own WhatsApp/SMS**.
- Nothing is recorded. No send/skip/fail log.
- `wa_opt_out` is checked only in `TelecallerV2`.

The 4 host pages + `PostCallOutcomeModal` are §28 FROZEN.
`WhatsAppPromptModal` is NOT in the frozen list — it is frozen-*adjacent*.

## 2 · THE INSIGHT — the feature is three database fields

The send is the easy part. What actually delivers "replies come back to the app"
is the conversation row carrying:

- `lead_id` — else the ensure-lead trigger spawns a **duplicate lead** (R1)
- `assigned_to = the calling rep` — else the reply is **invisible to them** (R2)
- `ai_paused = true` — else **the AI answers first** (R3)

Get those three right and the feature works. Get the send right but these wrong
and it silently fails while looking successful.

## 3 · Locked decisions (evidence-backed, not open questions)

- **D1 — business-initiated sends go from 9898 (marketing), deterministically.**
  It holds the migrated templates, its AI is on, it routes to Rima, the 22 board
  QRs now point at it, and it is the number whose job is to absorb marketing risk.
  Only one WABA then needs template approval. Free-form in-window keeps using
  `api/wa/send.js`, which already picks the thread's own number correctly.
- **D2 — the template is UTILITY, newly written.** Phrased as a follow-up to a
  call: no price, no offer, no CTA. **Not** `gsrtc_led_intro` (that is Marketing).
- **D3 — gate on consent EXISTING, not on opt-out being absent.** Today nothing
  records opt-in and nothing ingests an inbound STOP. Absence of `wa_opt_out` is
  not consent.
- **D4 — the conversation upsert sets `lead_id` + `assigned_to` + `ai_paused`** (§2).

## 4 · Design

### 4.1 Template-only. No 24h free-form branch.
A post-call message is business-initiated by definition, so a template is
required. When a window genuinely is open, the rep already has the Inbox
(`api/wa/send.js`, opened to reps in §205/§242). Dropping this branch removes the
entire window-arithmetic surface. If window state is ever needed, use
`window_expires_at` — the field `send.js` and `ai-reply.js` both already use.
Do not introduce `last_inbound_at` as a third definition (§69 drift).

### 4.2 Extend `api/wa/send-template.js` — do NOT add a new file
Node serverless functions are at **exactly 12 = the Hobby cap** (§219), so a new
Node file breaks every deploy. `send-template.js` is already Edge and already has
JWT auth + role gate + server-side account resolve + the Graph caller.

Add a `lead_id | quote_id` mode (~50–80 lines). Existing raw-`to` branch stays
admin-only. New branch:
1. Verify JWT → caller's user row.
2. **Ownership** — caller owns the lead (`assigned_to`/`telecaller_id`) or is
   admin. Phone is **server-derived**, never client-supplied.
3. **Consent** gate (D3) + **opt-out** gate (`wa_opt_out`, `do_not_call`).
4. **Throttle** — max 1 business-initiated message per lead per day.
5. Telecaller-only server-side gate for the pilot.
6. Template send via the existing Graph caller.
7. **Upsert `whatsapp_conversations` with `lead_id`, `assigned_to = rep`,
   `ai_paused = true`** (§2 — this is the feature).
8. Insert the `whatsapp_messages` row (also stops the AI treating the next
   inbound as first contact and firing the welcome poster).
9. **No `lead_activities` write** — see §8 E4.

Accepts `quote_id` too: quote-chase follow-up rows have `lead_id` NULL and pass a
**quote** UUID as the "lead" (`FollowUpsV2:440-448`). A `lead_id`-only endpoint
cannot serve them.

### 4.3 UI
Third button in `WhatsAppPromptModal` ("Send from company number") with the §47
`sendingRef` latch and honest disabled/failed states. Existing deep-link
WhatsApp/SMS buttons untouched as fallback. **Host pages untouched.**

## 5 · Phases

| # | Scope | Notes |
|---|---|---|
| **P0** | **Opt-out + STOP — ships independently, today.** Server-side refusal in the endpoint; UI guard inside `WhatsAppPromptModal.send()/sendSms()` that **re-reads `wa_opt_out` from the DB**, not from the passed lead object; webhook STOP-keyword → `wa_opt_out = true`. | NOT "3 one-liners" — see §8 E2. Do not touch WorkV2's 5 lead sources. |
| **P1** | **Consent capture** — chip in `PostCallOutcomeModal` on message-leading outcomes; persist `{lead_id, consented_at, consented_by, method:'verbal_call'}`. Frozen file → guardian. | Blocks the pilot. |
| ~~**P2**~~ | **DONE 20 Jul.** FIVE Utility templates created on WABA `2870129030006085`, one per outcome (owner: "every outcome has different data"), all **In review**: `post_call_good` (2379427389522646, +PDF), `post_call_callback` (783303278173992), `post_call_maybe` (4127865770680721, +PDF), `post_call_nurture` (1347668517533286), `post_call_lost` (1030773672663499). Column `message_templates.meta_template_name` added (`supabase_phase249_meta_template_link.sql` — owner still to RUN). Created via `scripts/create-post-call-templates.sh`, not the UI. | Meta accepted UTILITY on all five at creation. Final category can still change at review. |
| **P3** | **Extend `send-template.js`** per §4.2. | ~1 day code. |
| **P4** | **Modal button** (§4.3). Guardian PASS. | |
| **P5** | **Pilot ~20 leads.** Exit criteria: template quality unflagged, zero blocks/reports, delivered-vs-read healthy, replies visibly landing in the **sending rep's** inbox. Any template pause or block ends it. | The real test. |
| **P6** | Widen — a rollout decision, not a build phase. | |

Code time on P3+P4 is roughly one day. The calendar is dominated by Meta review
and the pilot window.

## 6 · Cost — corrected

Post-call follow-up is **Utility**, ≈**₹0.11–0.12** per message in India, and free
inside an open service window. **Not ₹0.8** — that is the Marketing rate.
Category is a ~7× cost lever, and it is also a policy lever. Verify against the
current rate card before quoting figures to anyone.

## 7 · Guardrails

- No auto-send. Rep always taps. (Option C rejected.)
- Pilot 20 leads, not 200.
- `sales-module-guardian` PASS before any commit touching frozen files. The agent
  lives at workspace `.claude/agents/`, **not** in the repo — an audit that looks
  only in the repo will wrongly report it missing.
- §45: endpoint is called on an explicit tap only; nothing added to a hot path.

## 8 · What Rev 1 got wrong (kept deliberately)

| # | Rev 1 claimed | Correction |
|---|---|---|
| E1 | All 5 files §28 frozen | 4 frozen; `WhatsAppPromptModal` is not in the list |
| E2 | Opt-out fix = "3 one-line guards" | `wa_opt_out` appears **nowhere** in `WorkV2.jsx` / `FollowUpsV2.jsx` — they never select it. `!lead?.wa_opt_out` reads `undefined` → **silent no-op that looks like a fix**. Must re-read from DB. |
| E3 | 24h window from `last_inbound_at` | Both existing consumers use `window_expires_at`. A third definition = §69 drift. |
| E4 | `lead_activities` whatsapp row is "safe" | Pay-safe, but `lead_activity_after_insert` bumps `contact_attempts_count` (halves the auto-Lost threshold) and sets `last_contact_at` (**re-sorts the TC queue, deprioritising the lead just messaged**). Don't write it. |
| E5 | ~₹0.8/message | Utility ≈ ₹0.11–0.12. ₹0.8 is Marketing. ~7× error. |
| E6 | `gsrtc_led_intro` may serve | It is Marketing — frequency-capped, higher block rate. Write a Utility one. |
| E7 | 9581 is "the AI number", 9898 is campaign-only | Stale within hours: AI is on 9898 too, it routes to Rima, and the 22 QRs moved onto it (§119). |
| E8 | Out-of-window free-form is penalised | Meta returns **131047**, message simply not delivered. Cost/correctness issue, not quality-rating. |
| E9 | Reuse existing send infra as-is | `send-template.js` is admin-only, hardcodes `purpose=marketing`, logs nothing. Needs real extension. |
| E10 | Endpoint keyed on `lead_id` | Quote-chase rows have `lead_id` NULL and pass a quote UUID. Must accept `quote_id`. |

Missed P0 risks now designed for: **R1** duplicate-lead spawn via the ensure-lead
trigger, **R2** replies invisible to the sending rep, **R3** AI answering first /
firing the welcome poster, **R4** no opt-in capture and no STOP ingestion.

## 9 · Still needs the owner

1. Confirm **D1** (send from 9898) — or override to 9581.
2. Confirm **D2** — write a new Utility template rather than reusing a Marketing one.
3. Confirm **replies route to the rep who called** (D4) rather than staying with Rima.
4. Approve **P1 consent capture** as a blocker for the pilot — it adds a step to
   the outcome modal reps use all day.
