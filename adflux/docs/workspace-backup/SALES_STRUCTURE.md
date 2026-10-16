# Untitled OS — Sales Role Structure

**As of 11 May 2026.** Every feature currently shipped for a salesperson, end-to-end. Use this to brief your team, audit gaps, or decide what's next.

This doc covers the **sales** role only. Agency, telecaller, admin, and co-owner roles have overlapping but distinct flows — they're not covered here. The "agency" role has been architecturally excluded from internal employee tracking (Phase 32F) since they're external commission partners.

---

## 1. Login & where a sales rep lands

When a sales user logs in, the app routes them automatically based on role (`team_role` column on `users` table):

- **`sales` → `/work`** (the daily home, Plan-A flow)
- **`agency` → `/quotes`** (external partners go straight to quoting)
- **`telecaller` → `/telecaller`**
- **`admin` / `co_owner` → `/dashboard`**

This is set in `src/App.jsx` (`RootRedirect`). The sales rep should never see the admin dashboard.

### Sidebar nav for a sales rep (V2AppShell.jsx)

In order top-to-bottom:

1. **Today** → `/work`
2. **Follow-ups** → `/follow-ups`
3. **Leads** → `/leads`
4. **Quotes** → `/quotes`
5. **Clients** → `/clients`
6. **Voice** → `/voice`
7. **Score** (personal scorecard)

The mobile bottom nav (`MOBILE_NAV_SALES`) mirrors this with the most-used 5 items.

At the top of every sales page sits the **Proposed Incentive Card** (Phase 31O) — shows projected incentive earnings for the month based on won quotes.

---

## 2. `/work` — the daily flow

This is the rep's home. It's a 5-state machine driven by `work_sessions` row (one per `user_id × work_date`):

### State A — A_PLAN (morning)

Before the rep checks in, they fill a morning plan. Form has:

- **5 meeting slots** — client / time / location each
- **Planned calls** (default 20, edit per day)
- **Planned new leads** (default 10)
- **Focus area** for the day (free text)

There's also a **free-text plan textarea** with a **voice dictation button** (Phase 31A.6). The rep can speak the plan in Gujarati / Hindi / English; Claude parses it (Phase 31Y) and auto-fills the structured fields. The Gujarati script correction step (Phase 32N) ensures the transcript lands in proper Gujarati, not Devanagari.

### State B — A_CHECKIN

Plan is saved. A big "Check in" button captures GPS silently and moves to B_ACTIVE. If GPS is denied, the rep can still check in but the check-in pin is missing in admin's audit view.

### State C — B_ACTIVE (working day)

This is the live state. Top of page shows three counters:

| Counter | Target (default) | What bumps it |
|---|---|---|
| Meetings | 5 | Every `lead_activities` row with `activity_type='meeting'` |
| Calls | 20 | Every `lead_activities` row with `activity_type='call'` |
| New leads | 10 | Every new `leads` row created by the rep |

Targets come from `users.daily_targets` JSONB. The counters are bumped by Postgres triggers (`trg_lead_activity_bump_counter`, `trg_lead_after_insert_bump_counter`) so they're always in sync with the underlying data — no JS counter drift.

The rep's active screen has:

- **Focus mode toggle** — show one card at a time vs full list
- **Smart Tasks panel** (Phase 19) — auto-ranked call list for today
- **Morning plan checklist** — tick off plan items as they're done
- **Today's meetings list** — Mark Done per meeting
- **Quick action tiles** (5):
  - Log call → opens leads list
  - Log meeting → opens `LogMeetingModal` (Phase 32M, brand-yellow highlighted as the milestone)
  - Voice note → goes to `/voice`
  - New lead → `/leads/new`
  - My leads → `/leads`

The **Log Meeting modal** is the rep's primary daily action. One tap:

1. Modal opens with GPS captured silently
2. Rep fills company name + outcome (Interested / Maybe later / Not interested) + optional contact, phone, notes
3. Save creates: a `lead` row (`source='Field Meeting'`, stage mapped from outcome), plus a `lead_activities` row (`activity_type='meeting'`, GPS pinned)
4. Counter ticks from `Meetings X/5` to `Meetings (X+1)/5`

Outcome mapping:
- **Interested** → stage `Working` (UI label: "Follow-up"), heat=warm
- **Maybe later** → stage `Nurture`, `revisit_date = today + 30`
- **Not interested** → stage `Lost`, `lost_reason='NoNeed'` (every meeting still counts toward milestone — owner's locked decision, 10 May 2026)

### State D — C_CHECKOUT (evening)

Rep submits an evening report:

- Quotes sent today
- Blockers
- Tomorrow's focus

There's also a **"Speak summary"** button that opens `/voice/evening` for dictating the report instead of typing.

Once submitted, a "Check out" button captures GPS one more time.

### State E — D_DONE

Day-complete summary. Counters vs targets with green/warn tone. View my leads link.

---

## 3. Lead management

### `/leads` — pipeline list

Top of page shows:

- **AI Briefing card** — surfaces hot leads idle >24h and SLA breaches. **Open queue button** (Phase 32N) narrows the list to just those leads with a clearable pill.
- **Stat strip** — Total / New / Follow-up / Won
- **Per-rep filter chips** (admin/co_owner see all reps; sales see only themselves)
- **Stage filter tabs** — All / New / Follow-up / Quote Sent / Nurture / Won / Lost
- **Filter dropdowns** — Segment, Source, City, Industry, Assigned
- **Search box** — name, company, phone, email, industry

The lead table itself supports multi-select with bulk stage change and bulk reassign. Realtime sync (Phase 19) — if another user updates a lead, this list reflects within 1-2s.

**CSV upload** via the "Upload CSV" button. Handles Cronberry exports with 90-day cutoff and Remarks regex parsing.

### `/leads/:id` — lead detail

Header card shows: name + company, stage chip (clickable to change, Phase 32L), heat dot, segment chip, source, assigned rep, telecaller, last contact, expected value.

**Action grid** (7 buttons): Call · WhatsApp · Meeting · Note · Follow-up · Voice · Stage. Call and WhatsApp are fast-path — they open the dialer / WhatsApp AND fire a quickLog insert in one click. Note and Follow-up open the LogActivityModal.

**LogActivityModal** (the Note / Follow-up modal) has:

- Outcome chip (positive / neutral / negative)
- Duration field (call only)
- Notes textarea + quick-note templates
- Schedule follow-up: date chips (Today / Tomorrow / Day after / Next week / Custom) + **time picker** (Phase 32O)
- GPS auto-captured

**Two-column body:**

- Left: Activity timeline (last 200 entries, with icons, outcome chips, GPS pins, next-action text, freshness animation)
- Right: Lead details (inline-edit for phone, email, city, industry, source, notes), Ownership (assigned + telecaller + SLA pill), Stage history (created → qualified → status changes)

The stage history reads from `status_change` activities, so every stage move is auditable.

### `/leads/new` — new lead form

Identity (name + company + phone + email + city), Classification (source + segment + industry), Money & Temperature (expected value + heat), Ownership (assigned + telecaller), Notes. Phone is required for non-government leads (Phase 32K) — locked by validation.

Source dropdown includes "Field Meeting" (Phase 32M) so reps can back-fill a cold meeting they forgot to log via the fast-path.

### `/follow-ups` — Nurture + scheduled follow-ups (Phase 31K, 31S)

- **Today / This week sections** — leads with `next_action_date` falling in those windows
- **Nurture section** — leads parked with a `revisit_date`, with a **Reactivate** button to move them back to Working
- Quick-jump to lead detail on tap

---

## 4. Quote flow

### `/quotes` — quotes list

Standard table with segment, status, client, value, sent date filters. Sales reps see only their own quotes (RLS); admin sees all.

### `/quotes/new` — segment chooser (Phase 32C)

Brand-new screen that asks "Government or Private?" then routes to the right wizard.

### Govt wizards (`/quotes/new/government`)

- **Auto Hood wizard** — district picker (33 districts max), share allocation, manual quantity override, validity period, pricing per district
- **GSRTC LED wizard** — station picker, agency / partner pricing, rate per station

Both wizards produce a `GovtProposalRenderer` PDF — Gujarati cover letter on letterhead, bidan checklist, district/station list, conditional OC and AWO copies. Reads company info from `companies` table by segment (Untitled Advertising for Govt). Hard-fails on missing company fields.

### Private wizards (`/quotes/new/private`)

- **Private LED wizard** — city picker, duration, monthly rate, GST split (CGST 9% + SGST 9% intrastate, default HSN 998397)
- **Other Media wizard** — media type from `media_types` master table (free-text fallback), city, duration, rate

Both produce PDFs via `QuotePDF` (`@react-pdf/renderer`) for Private LED, or `OtherMediaQuotePDF` (html2canvas + jsPDF) for Other Media. Reads company info from `companies` table (Untitled Adflux Pvt Ltd for Private).

Every quote save also calls `syncClientFromQuote` so the Clients table stays in sync, and updates the originating lead (`stage='QuoteSent'`, `quote_id={new}`).

### `/quotes/:id` — quote detail

Quote summary card, line items, payment status, action buttons:

- **View PDF** — opens the rendered quote
- **Edit** — routes to the correct wizard with `editOf=` param (Phase 32C)
- **Download PDF** — direct download
- **Mark Sent** — 2-step flow with OC upload
- **Mark Won** — 2-step flow with Work Order upload (gated)
- **WhatsApp send** — pre-built message with PDF link, popup-permission preserved on re-click (Phase 32K)

---

## 5. Voice — `/voice`

Mobile-first voice log page. Pick a lead, hit record (Web Audio API), stop, send. Server-side flow:

1. **Whisper** transcribes (with strong Gujarati prompt — Phase 31X)
2. **Claude Haiku 4.5** converts Devanagari → Gujarati script if Whisper fell back (Phase 32N)
3. **Claude Haiku 4.5** classifies: activity_type, outcome, summary, next_action, next_action_date, next_action_time
4. INSERT a `lead_activities` row with everything filled
5. INSERT a `voice_logs` row with audio URL + transcript for audit

Voice mode also has:

- **`mode='transcribe_only'`** — used by the morning plan dictation; skips classify
- **`mode='evening'`** — evening report dictation; produces summary not activity

Voice button is reachable from:

- `/voice` (the main page, lead picker)
- `/work` quick actions (B_ACTIVE state, brand-yellow tile)
- Lead detail action grid (`/leads/:id` → Voice button)
- Morning plan textarea (`/work` A_PLAN)
- Evening report (`/work` C_CHECKOUT)

---

## 6. GPS tracking & accountability

- **Check-in / check-out** — GPS captured on the bookend taps
- **5-minute interval pings** — while `/work` is open and the rep is checked in (Phase 31Z)
- **Activity GPS pins** — every meeting / note / call captures GPS on save (Phase 30G)
- **Voice GPS pins** — same

This gives admin a complete location trail per rep per day. Owner / admin can open `/admin/gps/:userId` (Phase 32E) to see the rep's day on a Leaflet map with check-in (green), check-out (red), and interval pings (yellow). Voice notes and meeting activities are also pinned.

The whole rep card on the Team Dashboard is clickable and routes to that rep's day track view.

GPS is browser-foreground-only on iOS — the rep needs `/work` visible. The 5-min pings are best-effort, not guaranteed background.

---

## 7. AI features built into the sales flow

Five AI assists are live:

| Feature | Trigger | What it does |
|---|---|---|
| **AI Daily Brief** | 7:00 AM WhatsApp | Owner gets a 1-paragraph summary of pipeline state |
| **AI Co-Pilot** | "Ask AI" search box | Natural Gujarati / English query → answer with data |
| **Daily Scorecard** | 7:30 PM WhatsApp | Each rep gets a personal performance summary |
| **Voice classify** | After every voice note | Claude parses transcript → structured activity |
| **Smart Task Engine** | Cron (Phase 19) | Auto-generates today's call list from rules (hot_idle, sla_breach) |

Plus the **AI Briefing card** on `/leads` (real data, not mock) — surfaces hot-idle leads, SLA breaches, and overnight Cronberry imports.

---

## 8. Daily milestones (the 5-meetings-per-day system)

Locked by owner on 10 May 2026:

- **5 meetings per day** per rep — every meeting counts including rejections
- **20 calls per day** per rep
- **10 new leads per day** per rep

These are stored on `users.daily_targets` JSONB and edit-able per rep. Counters live on `work_sessions.daily_counters` JSONB, bumped by Postgres triggers on activity / lead insert. The counter widget on `/work` shows progress vs target.

The Daily Scorecard WhatsApp message at 7:30 PM tells each rep how they did vs target.

GPS pin requirement is the integrity check — a rep can't fake-log 5 meetings from home; admin sees the location cluster.

---

## 9. Realtime / sync

Built on Supabase Realtime channels:

- Lead detail subscribes to UPDATEs on its own row + INSERTs on its activities
- Lead list re-fetches on any of: leads INSERT / UPDATE / DELETE
- Counter on `/work` reflects new activities within ~1s via the bump trigger + session reload on save

If two reps work the same lead, the second one sees the first one's changes without refresh.

---

## 10. What sales reps cannot do (role-gated)

These are admin-only / co_owner-only:

- Reassign a lead they don't own (manager chain enforced by RLS)
- See other reps' commissions / scorecards
- Edit company info (`/master/companies`)
- Edit media types (`/master/media-types`)
- Edit signers (`/master/signers`)
- See P&L
- Regenerate a locked proposal PDF
- Approve sales payments
- Delete a quote (Phase 11b — blocked on active quotes for everyone)
- Backdate a payment (Phase 11b — blocked for everyone)

Sales reps CAN do all financial actions tied to their own quotes (mark sent, mark won with upload, request payment approval).

---

## 11. What's NOT built yet (per master spec)

The 8-module Untitled OS plan is ~14% built. Here's what sales currently does NOT have:

- **M3 Invoice** — phase 2. Won quotes don't auto-generate invoices yet (manual outside the app)
- **M4 Campaigns** — phase 2. Won quotes don't auto-create campaign tracking (mounting, photos, end dates)
- **M6 Renewal alerts** — phase 2. No auto-reminder 30 days before a campaign ends
- **OCR for receipts** — phase 2
- **Gujarati drafter** — phase 2. Rep types in English; AI writes the Gujarati letter
- **Cash Forecaster** — phase 2. Projected cash next 90 days
- **M2 Creative** — phase 3. No creative job tracking inside the rep flow yet
- **Expense submission** — phase 3
- **GoGSTBill / Tally integration** — phase 4
- **TDS handling** — deferred. Govt deals have 2% income TDS + 2% GST TDS; `payments` table has no TDS columns
- **Govt invoice template** — not built. Won govt deals → manual invoice outside app

Total estimated to reach "all 22 people on one screen": ~14 weeks from today.

---

## 12. Known foot-guns (from CLAUDE.md §20)

Quick list of things future-claude / future-you should not repeat:

- Brand yellow is `#FFE600` from `tokens.css`. Never `#facc15`
- Specific routes (`/leads/new`) must come before parameterised routes (`/leads/:id`)
- Don't call delete on an active quote
- Don't reintroduce the "owner" role anywhere
- Don't mock the database in tests
- Don't read `media_type` / `media_label` columns from `quote_cities` — they live on `quotes`
- Voice logs land in Gujarati script for `gu` hint; check for Devanagari in old data

---

## 13. The "what's broken right now" punch list

Open items from recent owner reports:

- **LogMeetingModal closes silently** — no toast on save. Counter ticks but rep gets no confirmation.
- **"Speak summary" button only visible while checked in** — can't re-dictate evening report after submission. Probably intentional but worth confirming.
- **`daily_targets` may be null on legacy user rows** — verify with `SELECT id, name, daily_targets FROM users WHERE team_role IN ('sales','agency','telecaller') AND daily_targets IS NULL`
- **MasterV2.jsx has ~14 hardcoded `#facc15` / `#0a0e1a`** across old tabs — brand violation, deferred for a dedicated cleanup commit
- **Stage label "Working" → "Follow-up" is display-only** — DB stores `Working`. Any Edge Function matching on `stage='Follow-up'` text would silently fail (currently no such query exists)
- **Per-rep `daily_meeting_target` UI** — column exists on users, but no UI to edit it in Master → Team. Admin has to write SQL today.

---

## 14. File map (for engineering reference)

| What | Where |
|---|---|
| Sidebar + nav | `src/components/v2/V2AppShell.jsx` |
| Routing | `src/App.jsx` |
| Sales home | `src/pages/v2/WorkV2.jsx` |
| Leads list | `src/pages/v2/LeadsV2.jsx` |
| Lead detail | `src/pages/v2/LeadDetailV2.jsx` |
| Follow-ups | `src/pages/v2/FollowUpsV2.jsx` |
| Quotes list | `src/pages/v2/QuotesV2.jsx` |
| New quote chooser | `src/pages/v2/CreateQuoteChooserV2.jsx` |
| Wizards | `src/components/quotes/QuoteWizard/*.jsx` |
| Voice page | `src/pages/v2/VoiceLogV2.jsx` |
| Log Meeting modal | `src/components/leads/LogMeetingModal.jsx` |
| Log Activity modal | `src/components/leads/LogActivityModal.jsx` |
| Change Stage modal | `src/components/leads/ChangeStageModal.jsx` |
| Smart Tasks | `src/components/leads/TodayTasksPanel.jsx` |
| Stage definitions | `src/hooks/useLeads.js` |
| Shared lead UI | `src/components/leads/LeadShared.jsx` |
| Auth + role | `src/store/authStore.js` |
| Foundation SQL | `supabase_phase12_m1_m7_foundation.sql` |
| Voice edge function | `supabase/functions/voice-process/index.ts` |
| Co-Pilot edge function | `supabase/functions/copilot/index.ts` |
| Daily scorecard | `supabase/functions/scorecard/index.ts` |
| Daily brief | `supabase/functions/daily-brief/index.ts` |
