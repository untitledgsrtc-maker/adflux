# Phase 33 — Simplified Sales (Private) · Build Status

**As of 11 May 2026.** Maps every item in your checklist to current state.
Status legend: **✓ Done** · **◐ Partial** · **○ To build**

---

## A. Navigation & Structure

| Item | Status | What exists today | Phase 33 work |
|---|---|---|---|
| Bottom nav reduced to 4 items (Today / Leads / Voice / Score) | ◐ | `MOBILE_NAV_SALES` in V2AppShell.jsx has 5+ items | Cut to 4. Move others to More drawer. |
| "More" drawer via avatar tap | ○ | No drawer exists | Build a slide-up sheet. Avatar tap opens it. |
| Hide admin features from sales view | ◐ | RLS + role checks done at data layer. UI still shows some admin links. | Audit V2AppShell + each page; gate by `profile?.team_role !== 'admin'` |
| Desktop sidebar matches mobile mental model | ◐ | Has sales-specific nav but with same item count as mobile | Reduce to 4 + "More" expand at bottom |

**Phase 33 effort:** ~1 day. Mostly cutting + re-grouping.

---

## B. Today Screen (`/work`) — the heart

| Item | Status | What exists today | Phase 33 work |
|---|---|---|---|
| State machine: 3 states (not started / active / done) | ◐ | 5 states (A_PLAN, A_CHECKIN, B_ACTIVE, C_CHECKOUT, D_DONE) | Collapse A_PLAN+A_CHECKIN into one; merge C_CHECKOUT+D_DONE |
| One big counter ring (Meetings) | ○ | 3 small Counter cards side-by-side (Counters component) | Build `MeetingRing` SVG component. Tap → sheet shows other targets. |
| 3 giant action buttons (Meeting, Call, Voice) | ○ | 5 small `.tile` quick actions | Replace `.m-quick` with `.m-cta-grid` — 80px tall, vertically stacked |
| Today's tasks card (max 3 + View all) | ◐ | `TodayTasksPanel` exists, no truncation | Add slice(0, 3) + expand link. Empty state: "Log a new meeting" CTA |
| Quick links row (Follow-ups + My leads) | ◐ | Some quick action tiles exist | Cut from 5 tiles to 2 chips |
| Start My Day → GPS check-in | ✓ | "Check in" button captures GPS today | Just rename label |
| End My Day → voice-only summary | ◐ | Voice option exists at /voice/evening; primary path is the form | Make voice the default, "Type instead" link below |
| Big numbers everywhere (24-28px) | ○ | Most numbers 14px (counter labels) or smaller | Pass over CSS — `.lead-stat-num`, `.kpi-num`, etc. |

**Phase 33 effort:** ~3 days. The counter ring + 3 giant buttons is the most visible part of the whole release.

---

## C. Simplified LogMeeting

| Item | Status | What exists today | Phase 33 work |
|---|---|---|---|
| Modal: Company + 3 outcome chips | ◐ | `LogMeetingModal.jsx` shipped Phase 32M with 5 fields visible | Move Contact/Phone/City/Notes under "More details ▼" collapse. Keep voice mic next to Company |
| "More details" collapsed by default | ○ | All fields visible | Wrap in `<details>` or controlled accordion |
| GPS auto-captured on open | ✓ | Phase 32M does this | None |
| Success toast with counter update | ○ | Modal closes silently after save | Add 2s toast in WorkV2: `✓ Saved · 4/5 meetings today` |
| Auto-close after save | ✓ | Modal closes on save | None |
| Voice mic next to Company input | ○ | No mic on Company field today | Wire mic → `/voice` transcribe_only mode → drops text into field |

**Phase 33 effort:** ~1.5 days. The voice mic on the company field is the biggest sub-task (it's a reusable component for other inputs in Section E).

---

## D. Lead List & Detail

| Item | Status | What exists today | Phase 33 work |
|---|---|---|---|
| Color-coded row backgrounds | ○ | Plain rows with a stage chip | New CSS class based on last_contact_at + stage. ~30 lines of CSS. |
| Days-since-contact colored dot | ○ | "last contact 3 days ago" text | New `<HeatDot>` variant. Existing HeatDot is for hot/warm/cold |
| "I'm here" button on lead detail | ○ | No such button | New button. On tap: capture GPS + start 5-min dwell timer + auto-log meeting if dwell exceeds threshold |
| One-tap WhatsApp follow-up (Gujarati template) | ◐ | WhatsApp button opens chat. Quote flow has templates. | Add a "Send follow-up" button on lead detail that pre-fills a Gujarati message from `master.message_templates` |
| Stage chip bigger | ◐ | Phase 32L added dashed border + chevron | Just bump the font + padding |
| Activity timeline truncated to 5 + View all | ○ | Shows last 200 | `slice(0, 5)` + collapse |

**Phase 33 effort:** ~3-4 days. "I'm here" auto-log + the message_templates master table are the chunky pieces.

---

## E. Voice Experience

| Item | Status | What exists today | Phase 33 work |
|---|---|---|---|
| Mic button next to every text input | ◐ | Only on morning plan textarea (Phase 31A.6) | Build reusable `<VoiceInput>` wrapper. Apply to: Company, Notes, Search, Lead form, etc. |
| Voice transcript confirm screen | ○ | Transcript saved silently after Whisper+Claude | New step: show transcript for 3s with Re-record button before auto-save |
| Evening report = voice-only | ◐ | Form + voice button | Default to voice modal. "Type instead" link kept |
| Morning plan dictation | ✓ | Phase 31A.6 + 31Y | None |
| Gujarati script correction | ✓ | Phase 32N (Devanagari → Gujarati via Claude) | None |

**Phase 33 effort:** ~3 days. The reusable `<VoiceInput>` is the biggest piece; once it exists, slotting it in is 5 min per input.

---

## F. New Simple Features

| Item | Status | What exists today | Phase 33 work |
|---|---|---|---|
| Photo capture on every lead | ○ | None | New `lead_photos` table + Storage bucket + `<PhotoCapture>` component using `<input type="file" capture="environment">` |
| Audio chime on save | ○ | None | Single .mp3 in /public + `new Audio().play()` after activity save |
| No empty states — always show next action | ◐ | Some screens have empty states with CTA, some don't | Audit 5 screens (Today, Leads, Follow-ups, Quotes, Score) |
| Long-press for power features | ○ | None | New `useLongPress` hook. Wire on filter chips + activity rows. Admin/co_owner only. |

**Phase 33 effort:** ~3-4 days. Photo capture needs Supabase Storage RLS setup + a migration; it's the chunky one here.

---

## G. Cleanup & Hiding

| Item | Status | What exists today | Phase 33 work |
|---|---|---|---|
| Hide CSV upload from sales | ○ | Visible to all on /leads | Role-gate the Upload CSV button |
| Hide bulk actions from sales | ○ | Multi-select shows for all | Role-gate the bulk toolbar |
| Hide industry filter | ◐ | All roles see it | Hide for `team_role='sales'` |
| Hide per-rep filter from sales | ✓ | Sales already only sees own | None |
| Detailed evening report removed | ○ | Form is the primary path | See Section B |
| ProposedIncentiveCard kept on every page, smaller | ◐ | Phase 31O mounted big purple gradient card on every sales page | **Resize, don't remove.** Owner's call (11 May): keep it on every page as motivation; redesign as a 32-40px compact strip. Bold ₹ number, tab pills smaller, no gradient hero. |
| Smart Task panel merged into tasks card | ○ | Separate panel below counters | Move its row rendering inside the new "Today's tasks" card |
| Quotes / Clients / Follow-ups under More | ○ | All in primary nav today | Move under the More drawer |

**Phase 33 effort:** ~1 day. Mostly conditional rendering.

---

## Foundation already in place (no work needed)

These existing pieces directly support Phase 33 — listed so you can see we're not starting from zero:

| Foundation | Where | What it gives Phase 33 |
|---|---|---|
| Voice pipeline | `supabase/functions/voice-process/index.ts` | Whisper + Claude classify + script correction. New mic buttons all hit this. |
| Phase 12 counter triggers | `supabase_phase12_m1_m7_foundation.sql` | Every meeting/call/lead auto-bumps `work_sessions.daily_counters`. New ring just reads from here. |
| GPS auto-capture | `LogMeetingModal`, `LogActivityModal`, `WorkV2` (5-min pings) | "I'm here" + photo capture both inherit this pattern |
| Realtime sync | `LeadsV2`, `LeadDetailV2` | Color-coded rows auto-update without refresh |
| Field Meeting source | Phase 32M | Reps already log cold walk-ins via `source='Field Meeting'` |
| `daily_targets` JSONB | `users` table | Admin can already set per-rep targets (no UI yet, SQL works) |
| Govt segment fully sealed | `GovtProposalRenderer`, `/proposal/:id` | Out of scope for Phase 33, will not be touched |
| Phase 32P contact actions | `LeadDetailV2.jsx` | Call/WhatsApp/Email buttons just rebuilt, work cleanly |
| Phase 32N Gujarati script fix | `voice-process` | New voice inputs land in Gujarati script, not Devanagari |

---

## Recommended build order (your 9-step sequence, with effort)

| Step | What | Effort | Dependencies |
|---|---|---|---|
| 1 | Today Screen + LogMeeting simplification | 4 days | None — start here |
| 2 | Bottom Nav + More Drawer | 1 day | None |
| 3 | Lead list color rows + days-since-contact dot | 1.5 days | None |
| 4 | Lead detail "I'm here" + WhatsApp template + message_templates master table | 2 days | Master table migration |
| 5 | `<VoiceInput>` reusable + apply everywhere | 2 days | Voice pipeline (done) |
| 6 | Transcript confirm screen | 1 day | Step 5 |
| 7 | Evening voice summary as default | 0.5 day | Step 5 |
| 8 | Photo capture (table + bucket + UI) | 2 days | Storage RLS |
| 9 | Big numbers pass + audio chime + polish | 1.5 days | None |
| 10 | Cross-role testing + bug fixes | 2 days | Everything |

**Total: ~17 working days of coding.** Add 5 days of you-testing-and-reporting cycles between steps. Realistic calendar: **4 weeks** if we run a focused thread every day.

---

## Decisions — LOCKED (11 May 2026)

| # | Decision | Locked value |
|---|---|---|
| 1 | Bottom nav | **3 items: Today / Leads / Voice**. Score demoted; the persistent incentive strip replaces it as the daily motivator (tap strip → /scorecard for deep view) |
| 2 | Outcome chips on LogMeeting | **3: Good / Maybe / Lost** |
| 3 | "I'm here" auto-log threshold | **10 minutes** of dwell on lead's GPS pin |
| 4 | WhatsApp templates | **6 stage-based templates in English**, admin-editable via new `message_templates` master table (one per stage: New, Working, QuoteSent, Nurture, Won, Lost) |
| 5 | Photo capture | **Ship in Phase 33 with OCR**. OCR via Claude vision on existing Anthropic API key (NOT Tesseract, NOT Google Cloud Vision — same wire, no new vendor) |
| 6 | Hard switch vs toggle | **Hard switch** (owner left to me, my recommendation locked) |

### Bonus decision (owner clarification, same message)

| Decision | Locked value |
|---|---|
| Proposed Incentive Card | **Stays mounted on every sales page** (reversal of "move to Score only" idea). New design: small 32-40px strip, bold ₹ number, tab pills minimal. Acts as daily motivator. |

Phase 33A is ready to start.

---

## What stays untouched (locked)

To be explicit — Phase 33 does NOT change any of these:

- Government segment: Auto Hood + GSRTC LED wizards, GovtProposalRenderer, /proposal/:id, OC/AWO uploads, Mark Sent/Won for govt, govt master tabs
- Admin dashboard / Cockpit / Team dashboard
- Master settings (Companies, Cities, Districts, Stations, Signers, Documents, Media Types)
- Approvals queue, Incentive rules
- Cronberry CSV import flow (admin's job)
- Supabase RLS policies (data layer stays)
- Postgres schema (no breaking column changes)
- Routing for existing deep links (e.g., `/leads/:id`, `/quotes/:id`, `/proposal/:id`)

If anything in this list needs to change too, flag it before Phase 33 starts.
