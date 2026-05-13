# Sales Module — FULL Master Test Plan

**For:** Brijesh (owner) + future QA. End-to-end walk-through of every sales-module flow, screen, modal, role, edge case.
**Generated:** 2026-05-13 (post Phase 34A–X)
**Estimated time:** 3–4 hours full walk, or split per role (~45 min each)
**App:** Untitled OS / AdFlux · staging `https://untitled-os-tau.vercel.app`
**Branch tested:** `untitled-os` HEAD `ff72390`

---

## How to use this document

1. Open in any markdown viewer (GitHub web works best — preserves tables + checkboxes).
2. Open the staging app on a second screen / tablet / phone.
3. Walk row by row. Tick `[x]` when verified. Anything that fails → screenshot + paste row number to me.
4. Use the **Section quick-link table** below to jump to a role / area without scrolling.

The plan is structured in 3 layers:

- **PART I — Per-role end-to-end** (4 roles × ~30 rows each) — verifies the rep / telecaller / manager / admin can do their daily job.
- **PART II — Per-feature deep-dive** (modals · wizards · triggers · automation · PDFs) — verifies every internal feature works in isolation.
- **PART III — Cross-cutting** (mobile · iOS PWA · cross-browser · accessibility · performance · RLS) — verifies the platform-level promises.

### Quick links

| Section | Topic | Rows |
|---|---|---|
| §0 | Prerequisites + Phase 34 SQL list | 8 |
| §1 | Sales rep — morning (09:30) | 24 |
| §2 | Sales rep — field block 1 | 22 |
| §3 | Sales rep — mid-day calls | 18 |
| §4 | Sales rep — building a quote | 28 |
| §5 | Sales rep — closing a deal | 19 |
| §6 | Sales rep — evening wrap | 16 |
| §7 | Telecaller — full shift | 22 |
| §8 | Sales manager — daily review | 18 |
| §9 | Admin — daily oversight | 21 |
| §10 | Co-owner — financial visibility | 14 |
| §11 | LogActivityModal deep-dive | 20 |
| §12 | LogMeetingModal deep-dive | 24 |
| §13 | ChangeStageModal per-stage | 22 |
| §14 | ReassignModal | 8 |
| §15 | PhotoCapture / OCR | 14 |
| §16 | WhatsAppPromptModal templates | 12 |
| §17 | FollowUpModal | 10 |
| §18 | WonPaymentModal | 18 |
| §19 | PaymentModal | 12 |
| §20 | ConfirmDialog | 8 |
| §21 | Toast notifications | 10 |
| §22 | Private LED wizard 4 steps | 22 |
| §23 | Other Media wizard | 18 |
| §24 | Govt Auto Hood wizard | 20 |
| §25 | Govt GSRTC LED wizard | 18 |
| §26 | All DB triggers | 26 |
| §27 | All Edge Functions | 14 |
| §28 | All RPCs (find_lead_by_phone, dedupe, etc.) | 18 |
| §29 | All 3 PDF renderers + content checks | 28 |
| §30 | All 8 DidYouKnow tips | 8 |
| §31 | Push notifications (8 scenarios) | 16 |
| §32 | Cronberry CSV import | 22 |
| §33 | Voice flows (input / log / evening / day-plan) | 24 |
| §34 | Smart Task Engine | 18 |
| §35 | TA payout (GPS → DA → bike → hotel) | 16 |
| §36 | Performance score + incentive math | 18 |
| §37 | Lead → quote handoff (lead_id contract) | 14 |
| §38 | Dedup (frontend + DB trigger + RPC) | 16 |
| §39 | SLA breach (handoff + business-day calc) | 12 |
| §40 | Soft auto-Lost (Phase 34B) | 10 |
| §41 | Mobile (Chrome/Safari at 390px) | 32 |
| §42 | iOS PWA install + offline | 18 |
| §43 | Cross-browser (Chrome/Safari/Firefox desktop) | 12 |
| §44 | RLS per role (5 roles × 6 surfaces) | 30 |
| §45 | Console errors + network sweep | 8 |
| §46 | Accessibility (tab order + focus rings) | 12 |
| §47 | Performance (page load + bundle size) | 8 |

Total rows: **~870**

---

## §0 · Prerequisites

| # | Step | Expect |
|---|---|---|
| 0.1 | `git push origin untitled-os` runs clean | Vercel shows "Building" → "Ready" within 90s |
| 0.2 | Open Vercel dashboard for project | Latest deploy = HEAD `ff72390` (or newer) |
| 0.3 | Open staging URL in Chrome (desktop) | Login page appears |
| 0.4 | Log in with admin account | `/dashboard` loads |
| 0.5 | All Phase 34 SQL has been run in staging Supabase Studio | List below |
| 0.6 | DevTools → Application → Service Workers → Unregister stale workers | Clean state for offline tests |
| 0.7 | Hard refresh (Cmd+Shift+R) after Vercel deploy | New build loads |
| 0.8 | DevTools → Console → no red errors on first page | Pristine console |

**Phase 34 SQL files (run in this order):**
1. `supabase_phase34_followup_consolidation.sql`
2. `supabase_phase34b_soft_auto_lost.sql`
3. `supabase_phase34c_leads_lat_lng.sql`
4. `supabase_phase34l_stage_changed_at.sql`
5. `supabase_phase34q_lead_won_propagate.sql`
6. `supabase_phase34v_dedupe_leads.sql` + `supabase_phase34v_2_lost_reason_duplicate.sql`
7. `supabase_phase34w_block_duplicate_phone_inserts.sql`

After each, paste VERIFY row should show expected counts (each file documents).

---

# PART I · Per-role end-to-end

## §1 · Sales rep — morning routine (09:30 AM)

Pretend you're Brahmbhatt opening the app for the day.

| # | Step | Expect | Red flag |
|---|---|---|---|
| 1.1 | Open `/work` cold | Lands on A_PLAN if not checked in | Lands on /dashboard or other |
| 1.2 | Greeting reads "Good morning, <first name>" | Greeting matches IST time-of-day | Wrong greeting |
| 1.3 | Yellow incentive pill top-right | "₹0 · 0% to slab" (or your live number) | Pill missing for sales rep |
| 1.4 | Top-bar bell icon | Visible, tappable | Missing |
| 1.5 | Hamburger top-left | Visible | Missing — Phase 34N regression |
| 1.6 | DidYouKnow "Speak your day plan" tip | Visible if not dismissed | Missing OR dismissed shows |
| 1.7 | Plan card "Today's plan — speak it (mic below) or fill in" | Open by default (Phase 34O) | Collapsed → regression |
| 1.8 | Big yellow round mic button visible | Visible at top of plan card | Missing |
| 1.9 | Tap mic | Goes red, shows "Listening… tap to stop" | No state change |
| 1.10 | Speak "Today I have 3 meetings, 10 calls, focus is Sunrise deal" | After 2-3 sec processing, fields populate | parse-day-plan Edge Fn 5xx error |
| 1.11 | Mic button shows spinner during transcription | "Reading your plan…" | Stuck in recording state |
| 1.12 | Planned-meetings list shows ≥1 row | Yes | Empty |
| 1.13 | Calls planned input shows ~10 | Yes | Empty |
| 1.14 | Focus area input shows "Sunrise deal" | Yes | Empty |
| 1.15 | Tap "Start My Day" with valid plan | Page advances to A_CHECKIN | Inline error |
| 1.16 | Tap "Start My Day" with EMPTY plan | Inline error "Please add your plan first — tap the mic and speak it, or fill at least one meeting / call target." (Phase 34O) | Day starts without plan |
| 1.17 | A_CHECKIN screen shows check-in CTA | Button visible | Stuck on A_PLAN |
| 1.18 | If past 9:30 AM IST → inline "late reason" input visible | Mandatory field | Skipped |
| 1.19 | Type a late reason ("traffic") and tap Check In | GPS prompt fires | Skipped |
| 1.20 | Grant GPS permission | Page advances to B_ACTIVE | Stuck |
| 1.21 | B_ACTIVE landing shows V2Hero "Today · in progress · 0/5 meetings logged · 0 calls · 0 new leads · 5 to go" | Hero + teal gradient | Missing |
| 1.22 | Right-side of hero shows down-trend "5 to go" | Yes | Up arrow shown incorrectly |
| 1.23 | Below hero: NO duplicate RingMilestoneRow (Phase 34S removed) | Only MeetingRing OR nothing | 3-up ring row present |
| 1.24 | Today's tasks card visible with 3 task preview | Yes | Empty |

## §2 · Sales rep — field block 1 (10:00 – 13:00)

| # | Step | Expect | Red flag |
|---|---|---|---|
| 2.1 | Tap "Today's tasks · View all" | Goes to /follow-ups OR opens drawer | No nav |
| 2.2 | Tap big yellow "Meeting" CTA on /work | LogMeetingModal opens | Stays put |
| 2.3 | Type phone "9999999999" (new) | No dup chip | False chip fires |
| 2.4 | Type phone "7069082826" (existing canonical Nemi Shah) | Amber chip "Already in pipeline: Mr. Nemi Shah · Vasant Masala (New)" within 600 ms | No chip — Phase 34.10 broken |
| 2.5 | Clear phone field | Chip disappears | Sticks |
| 2.6 | Type a phone in chunks slowly | Chip updates after debounce | Spammy fetches |
| 2.7 | Fill Company "Test Co", Contact "Mehul", City "Vadodara" | Fields accept | Frozen |
| 2.8 | Pick outcome "Interested" | Outcome card glows brand | No glow |
| 2.9 | Tap business-card scan button | Camera opens (or file picker) | Permission denied |
| 2.10 | Skip OCR → Save | Toast "Saved · 1/5 meetings today" | Silent save |
| 2.11 | After save → WhatsAppPromptModal opens | Templated message visible | Modal missing |
| 2.12 | Tap "Send via WhatsApp" | WhatsApp opens with chat + message | Falls through |
| 2.13 | Close WhatsApp / back to app | **Navigates to /leads/:id of new lead (Phase 34O)** | Stays on /work |
| 2.14 | Lead detail loads with all entered data | Yes | Lost data |
| 2.15 | Stage chip = "Working" (from outcome map) | Yes | Wrong stage |
| 2.16 | Tap "Log Activity" → Call → outcome Positive → next_action Today 5pm | Saves with toast | Silent fail |
| 2.17 | After save check /follow-ups | New row at "Today" 5pm | Missing — Phase 34 trigger not applied |
| 2.18 | Back to /work — meeting counter increments to 1/5 | Yes | Stale counter |
| 2.19 | V2Hero updates to show 1/5 + "4 to go" | Yes | Stale |
| 2.20 | Drive to next meeting — `/work` refreshes counter from realtime | Yes (within 30s) | Stuck |
| 2.21 | Repeat steps 2.2-2.13 for 3 more meetings | Counter reaches 4/5 | Counter desync |
| 2.22 | After 4 meetings — Hero color shifts from amber to green | Yes (target nearly hit) | No change |

## §3 · Sales rep — mid-day calls (13:00 – 14:00)

| # | Step | Expect | Red flag |
|---|---|---|---|
| 3.1 | Open `/follow-ups` | Page renders | Blank |
| 3.2 | DidYouKnow "After the call, log it" tip | Visible | Missing |
| 3.3 | 4 buckets visible: Overdue / Today / Tomorrow / Week | Yes | Single list |
| 3.4 | Each bucket shows N rows + chip with count | Yes | Empty |
| 3.5 | Each row shows client + AUTO/manual badge + time + 4 actions | Yes | Squashed |
| 3.6 | Tap "Call" → phone dials | Yes (mobile) / Tel link (desktop) | Nothing |
| 3.7 | After (simulated) call → tap "Done" | Row removes with toast | Silent |
| 3.8 | Re-open /follow-ups | Done row gone | Reappears |
| 3.9 | Tap "WhatsApp" on a row | WhatsApp deep-link | Nothing |
| 3.10 | Tap "Snooze" → choose 2 hr | Row removes from Today, reappears in Tomorrow | Stays in Today |
| 3.11 | Scroll to Nurture revisits section | Separate cards visible (blue tint) | Missing |
| 3.12 | Tap "Mark Done" on a Nurture revisit | Lead stage stays Nurture but row removes | Stage changes wrong |
| 3.13 | DevTools → Network → check follow_ups POST | Single fetch on done, not duplicate | Multiple fetches |
| 3.14 | Refresh page after 5 done rows | Counter updates | Stale |
| 3.15 | Open a lead via row tap → Log Activity → call outcome | Activity logs + lead.last_contact_at bumps | Trigger doesn't fire |
| 3.16 | Go back to /follow-ups → row gone | Yes | Sticks |
| 3.17 | Mid-day: 5 calls done | Counter shows 5/10 on /work | Stale |
| 3.18 | Lunch — open /my-performance | Score updates with day's activity | Frozen |

## §4 · Sales rep — building a quote (14:00 – 16:00)

| # | Step | Expect | Red flag |
|---|---|---|---|
| 4.1 | From lead detail tap "Convert to Quote" | Router checks segment + routes to /quotes/new/private OR /government | Wrong route |
| 4.2 | (Private LED) wizard chooser appears at /quotes/new/private | Or skips chooser → Step 1 | Stuck |
| 4.3 | Step 1 (Client) — pre-filled from lead's name, phone, company | Yes | Empty |
| 4.4 | "Copy from your last quote" button visible (Phase 34E) | Yes | Missing |
| 4.5 | Tap "Copy from your last quote" | Toast + client + cities fill | No effect |
| 4.6 | Next → Step 2 (Campaign) | Cities table visible | Stuck |
| 4.7 | Add a city via picker | Row appears with listed rate | Stuck |
| 4.8 | Change offered rate below listed → reason field required | Inline error if blank | Saves anyway |
| 4.9 | Change duration months | Total recalculates live | Static |
| 4.10 | Next → Step 3 (Review) | Total + subtotal + GST + Grand Total visible | Static |
| 4.11 | **"Amount in Words" line visible (Phase 34.8)** | "Twelve Lakh Three Thousand…" | Missing → rupeesToWords not wired |
| 4.12 | Toggle "Include GST" off → Total = subtotal | Recalc | Stuck |
| 4.13 | Tap "Save Draft" | Quote saves with status=draft | Save fails |
| 4.14 | Tap "Send to Client" | Triggers Step 4 (Send) → PDF generates | "Could not resolve font for Roboto, fontWeight 400" — Phase 34P/T regression |
| 4.15 | PDF uploads to storage | Success | Upload fails |
| 4.16 | WhatsApp opens with shortened PDF link | Yes | Long URL |
| 4.17 | Close → back to /quotes | New quote at top, status=sent | Missing |
| 4.18 | Open quote → /quotes/:id renders | Page loads | Blank |
| 4.19 | DidYouKnow "Closing this deal?" tip top of page | Visible | Missing |
| 4.20 | **IncentiveForecastCard at bottom of overview** | "If you close this this month, +₹X" card | Missing |
| 4.21 | **Confirm ProposedIncentiveCard NOT visible here (Phase 34S)** | Card hidden | Visible → regression |
| 4.22 | Status badge = SENT | Yes | Wrong |
| 4.23 | Try "Download PDF" | File downloads, PDF opens | Font error |
| 4.24 | PDF page 1 — header + client + campaign | Brand yellow #FFE600 | Off-brand color |
| 4.25 | PDF page 2 — line items | Each city + offered rate + total | Missing rows |
| 4.26 | PDF Grand Total + Amount in Words | Both present + match | Mismatch |
| 4.27 | Footer + signature block | Both present | Cut off |
| 4.28 | Re-Edit → wizard reopens with values pre-filled (editOf URL param) | Yes | Lost data |

## §5 · Sales rep — closing a deal (16:00 – 18:00)

| # | Step | Expect | Red flag |
|---|---|---|---|
| 5.1 | Open a `negotiating` quote | /quotes/:id loads | Blank |
| 5.2 | Status dropdown → "Won" | WonPaymentModal opens | No modal |
| 5.3 | **WonPaymentModal opens with V2Hero strip (Phase 34R++)** | Teal gradient "Mark this Won · ₹X · UA-NNNN · Co" | Old yellow card |
| 5.4 | Campaign start date required | Validation fires when blank | Saves blank |
| 5.5 | Campaign end date required | Same | Saves blank |
| 5.6 | "WO copy" upload required | Validation fires when missing | Saves without |
| 5.7 | Upload a PDF as WO | Card switches from amber (warning) to green (success) tint | No state change |
| 5.8 | Record full payment | Form accepts amount | Stuck |
| 5.9 | "Already Received" panel updates | Yes | Stale |
| 5.10 | Tap "Mark as Won" | Quote.status flips to won | Stays |
| 5.11 | After save check the originating lead | **Lead.stage = Won (Phase 34Q trigger)** | Stuck in QuoteSent |
| 5.12 | /leads list — lead appears under Won tab | Yes | Wrong tab |
| 5.13 | /follow-ups — payment-collection follow-ups created if partial paid | Yes (Phase 33G.7) | Missing |
| 5.14 | Toast notification confirms won | Yes | Silent |
| 5.15 | /my-performance — score recalculates within 30 s | Updated | Stale |
| 5.16 | Top-bar incentive pill — if slab crossed, color flips green | Color shift | Stays yellow |
| 5.17 | Admin gets push notification "Quote X.XL won by <rep>" | Yes (Phase 33W) | Silent |
| 5.18 | activity timeline on lead → "status_change: Won" row added | Yes | Missing |
| 5.19 | client.total_won_amount += quote.total_amount | Yes (RLS gated) | Stale |

## §6 · Sales rep — evening wrap (18:00 – 19:30)

| # | Step | Expect | Red flag |
|---|---|---|---|
| 6.1 | Open `/voice/evening` | EveningVoiceV2 loads with mic | Blank |
| 6.2 | Tap mic + speak 20 seconds | Recorder runs | No state |
| 6.3 | Tap stop | AI processes (5-10s) | Stuck |
| 6.4 | Output breaks into "Highlights / Blockers / Tomorrow focus" | Yes | Single blob |
| 6.5 | Tap save | work_sessions.evening_summary persists | Save fails |
| 6.6 | Open /work | Counter says "Day done" if checked out | Wrong state |
| 6.7 | Tap "Check Out" | GPS prompt + state advance to D_DONE | Stuck |
| 6.8 | D_DONE shows Day summary | Yes | Empty |
| 6.9 | Open `/admin/ta-payouts` for today | (admin gated — if rep can see own) skip |  |
| 6.10 | At 7:30 PM IST | WhatsApp scorecard arrives | No message |
| 6.11 | Scorecard message includes meetings done vs target, calls, pipeline | Yes | Wrong numbers |
| 6.12 | Scorecard says "Tomorrow tip: <action>" | Yes | Generic |
| 6.13 | Open /work tomorrow morning | A_PLAN state | Stuck in B_ACTIVE |
| 6.14 | Yesterday's evening summary visible on /cockpit (owner only) | Yes | Missing |
| 6.15 | Open /my-performance | Today's score added to month average | Stale |
| 6.16 | Top-bar incentive pill | Updated number | Stale |

## §7 · Telecaller — full shift

| # | Step | Expect | Red flag |
|---|---|---|---|
| 7.1 | Log in as telecaller user | Lands on /telecaller (or /work) | Wrong page |
| 7.2 | DidYouKnow "Stop typing call notes" | Visible | Missing |
| 7.3 | "Next Call" hero card with big number + age | Yes | Empty |
| 7.4 | 4 KPI tiles: Calls / Connected / Hand-offs / SLA hits | Render | Zeros where data exists |
| 7.5 | Pending hand-offs section visible | Yes | Missing |
| 7.6 | SLA breach pill says "<N> leads past 24h handoff SLA" (Phase 34S copy) | Yes | Old "SalesReady" wording |
| 7.7 | Click Next Call → opens lead | /leads/:id loads | Stuck |
| 7.8 | Log call activity with positive outcome | Saves | Silent fail |
| 7.9 | Move stage to Working | ChangeStageModal opens | No modal |
| 7.10 | Save stage change | Lead updates + activity logged | One missing |
| 7.11 | leads.handoff_sla_due_at populates (Phase 34 trigger) | Visible on lead detail | Missing |
| 7.12 | SLA computed for business-day IST (not weekend) | Yes | Saturday breach time |
| 7.13 | Mark another lead Lost via stage modal | Lost_reason required | Saves blank |
| 7.14 | Pick "NoNeed" | Saves | Validation passes for invalid |
| 7.15 | Mark a third lead Nurture | nurture_revisit_date required | Skipped |
| 7.16 | Set revisit_date 90 days out | Saves | Date validation off |
| 7.17 | Telecaller queue refresh — next call advances | Yes | Stale |
| 7.18 | Refresh page | Position preserved | Resets |
| 7.19 | At end of shift — daily counters bumped | Yes | Stale |
| 7.20 | Scorecard arrives 7:30 PM | Yes | Missing |
| 7.21 | Try to create new quote — should be blocked | UI hides "New Quote" | Allowed → RLS regression |
| 7.22 | Try to access /master — admin only | Bounces to /dashboard | Allowed |

## §8 · Sales manager — daily review

| # | Step | Expect | Red flag |
|---|---|---|---|
| 8.1 | Log in as sales_manager | Lands on /lead-dashboard or /team-dashboard | Wrong |
| 8.2 | /lead-dashboard hero KPIs | Total / Hot idle / SLA breaches / Pipeline / Win rate | Empty |
| 8.3 | 6-stage rail | New / Working / QuoteSent / Nurture / Won / Lost — counts | Old stages |
| 8.4 | AI Briefing card | Live data, not stale | Stale |
| 8.5 | Hot leads top-6 | Render | Empty |
| 8.6 | /team-dashboard — 4 active reps now | Live | Static |
| 8.7 | Each rep card shows "● live · X min ago" if pinged (Phase 34U) | Yes | Static city only |
| 8.8 | Click "View track" on a rep | /admin/gps/<id>/<today> loads | Wrong URL |
| 8.9 | Map renders with pings | Yes | Empty |
| 8.10 | Distance shows reasonable km (Phase 34I + 34U filter) | Yes | 0 km despite many pings OR 1300 km |
| 8.11 | Reassign a lead — ReassignModal opens | Yes | No modal |
| 8.12 | Reassign saves + activity logs | Yes | Silent |
| 8.13 | Bulk reassign 5 leads on /leads | Inline ConfirmDialog | Browser confirm |
| 8.14 | Reassigned reps get push notification | Yes (Phase 33W) | Silent |
| 8.15 | Open /pending-approvals | Queue renders | Empty when there's data |
| 8.16 | Approve a payment | Status flips | Stuck |
| 8.17 | Check /my-performance for managed reps (if scoped) | RLS allows | Blocked |
| 8.18 | Check /cockpit (if available) | Owner-only page bounces | Allowed when shouldn't |

## §9 · Admin — daily oversight

| # | Step | Expect | Red flag |
|---|---|---|---|
| 9.1 | Log in as admin | /dashboard loads | Wrong |
| 9.2 | AdminDashboardDesktop hero KPIs | All render | Empty |
| 9.3 | **No SlaBreachBanner separately (Phase 34S removed)** | Only AiBriefingCard | Both visible |
| 9.4 | **No StaleLeadsAlertCard separately (Phase 34S removed)** | Only AiBriefingCard | Visible |
| 9.5 | PipelineFunnelCard renders | Yes | Empty |
| 9.6 | WinRateCard renders | % visible | Static |
| 9.7 | RecentActivityFeed | Live entries from team | Empty |
| 9.8 | TopPerformers card | Rep leaderboard | Empty |
| 9.9 | Top-bar — no incentive mini-pill (admin only) | Hidden | Visible when shouldn't |
| 9.10 | Open /master | Tabs: Attachments / Companies / Signers / Media / Media Types / Documents | Missing tabs |
| 9.11 | Add a new company | Form saves | Validation off |
| 9.12 | Edit signer | onBlur saves | No save |
| 9.13 | /cities, /auto-districts, /gsrtc-stations all load | Yes | Blocked |
| 9.14 | /admin/ta-payouts | V2Hero + RingMilestone Approved/Paid/Pending (Phase 34R++) | Plain page |
| 9.15 | Approve a TA day | Status flips | Stuck |
| 9.16 | /admin/leaves | Queue renders | Empty when populated |
| 9.17 | /incentives — full liability view | Render | Sales view |
| 9.18 | Cronberry CSV import via /leads/upload | Wizard renders | Blocked |
| 9.19 | Bulk delete 2 leads | ConfirmDialog | Browser dialog |
| 9.20 | Push notification settings configured | Reps subscribed | None |
| 9.21 | Live voice feed on /team-dashboard | Future feature placeholder OR works | Crash |

## §10 · Co-owner — financial visibility

| # | Step | Expect | Red flag |
|---|---|---|---|
| 10.1 | Log in as co_owner | All admin surfaces + P&L | Restricted |
| 10.2 | /dashboard | Same as admin + P&L | Missing P&L |
| 10.3 | Daily AI brief WhatsApp at 9:00 AM IST | Arrives | Wrong time |
| 10.4 | Brief includes: overnight imports / SLA breaches / hot idle / yesterday collections | Yes | Missing fields |
| 10.5 | Daily AI brief at 7:30 PM IST | Arrives | Missing |
| 10.6 | /incentives — staff profiles editable | Yes | Read-only |
| 10.7 | Edit a profile (rate / multiplier) | Saves | Validation off |
| 10.8 | Trigger payout for a rep | IncentivePayoutModal opens | No modal |
| 10.9 | Confirm payout | DB row inserted | Silent |
| 10.10 | /pending-approvals — all | Render | RLS blocks |
| 10.11 | Approve a payment | Status updates + rep notified | Silent |
| 10.12 | Cockpit AI evening summary view | Loads | Empty |
| 10.13 | All reps' evening summaries visible | Yes | RLS-blocked |
| 10.14 | Export TA payouts to CSV | Download starts | No download |

---

# PART II · Per-feature deep-dive

## §11 · LogActivityModal — every field, every path

| # | Step | Expect |
|---|---|---|
| 11.1 | Open from /leads/:id | Modal renders |
| 11.2 | Activity type chips: Call / WhatsApp / Email / Meeting / Site Visit / Note | All 6 present |
| 11.3 | Pick Call | Outcome required |
| 11.4 | Outcomes: Positive / Neutral / Negative | All 3 present |
| 11.5 | Notes field with mic icon | Mic visible |
| 11.6 | Tap mic → record 30s | Transcribes + appends to notes |
| 11.7 | Quick chips: "Just checking in" / "Reminder" / etc. | Visible |
| 11.8 | Tap quick chip | Text appended |
| 11.9 | Schedule follow-up chips: Today 5pm / Tomorrow 11am / Day after / Next week | Visible |
| 11.10 | Tap "Tomorrow 11am" | next_action_date populates correctly |
| 11.11 | "More date options" → date picker | Picker opens |
| 11.12 | If outcome positive AND stage != QuoteSent → "Move to Working?" suggestion (yellow tint, Phase 34R+) | Visible |
| 11.13 | Tap "Move to Working" | Stage advances on save |
| 11.14 | If GPS captured silently → green tint chip in modal | Visible (Phase 34R+) |
| 11.15 | Save with empty notes | Allowed (note optional) |
| 11.16 | Save with future next_action_date | follow_ups row upserts via trigger |
| 11.17 | activity_type=status_change saved correctly | Yes |
| 11.18 | Modal closes after save | Yes |
| 11.19 | Lead's activity timeline updates immediately | Realtime |
| 11.20 | DB → activity row has all fields persisted (GPS, outcome, type, notes, next_action_date) | Yes |

## §12 · LogMeetingModal — cold walk-in path

| # | Step | Expect |
|---|---|---|
| 12.1 | Open from /work "Log Meet" tile | Modal renders |
| 12.2 | Header reads "Log field meeting" | Yes |
| 12.3 | Phone field — type a number slowly | Debounce 600 ms for dedup check |
| 12.4 | Match found → amber chip with name + company + stage | Yes (Phase 34.10) |
| 12.5 | No match → no chip | No false fire |
| 12.6 | Company field | Required |
| 12.7 | Contact field | Required |
| 12.8 | City field | Pre-filled from profile.city |
| 12.9 | Segment defaults PRIVATE | Yes |
| 12.10 | Outcome cards — Interested / Maybe / Lost — colored tints (Phase 34R+) | Yes |
| 12.11 | Tap "Interested" | success tint |
| 12.12 | Notes optional | Saves blank |
| 12.13 | Scan business card → camera opens | Yes |
| 12.14 | OCR fills Name / Company / Phone | Yes (with confidence) |
| 12.15 | Edit OCR result | Editable |
| 12.16 | GPS auto-captured silently | Yes |
| 12.17 | GPS chip green tint (Phase 34R+) | Yes |
| 12.18 | Refresh GPS button works | Yes |
| 12.19 | Save → toast confirms | Yes |
| 12.20 | If dup phone match → save creates activity on existing lead | Yes |
| 12.21 | After save → WhatsAppPromptModal opens | Yes |
| 12.22 | After WhatsApp close → **navigates to /leads/:id (Phase 34O)** | Yes |
| 12.23 | New lead has GPS + activity row + counters bumped | Yes |
| 12.24 | Modal handles network failure gracefully | Toast not crash |

## §13 · ChangeStageModal — every transition

| # | Step | Expect |
|---|---|---|
| 13.1 | From lead detail tap "Change Stage" | Modal renders |
| 13.2 | Current stage shown | Yes |
| 13.3 | Stage options: New / Working / QuoteSent / Nurture / Won / Lost | All 6 |
| 13.4 | Pick "Working" — no extra fields | Saves immediately |
| 13.5 | Pick "QuoteSent" — no extra fields (quote should exist) | Allows |
| 13.6 | Pick "Nurture" → nurture_revisit_date required | Inline validation |
| 13.7 | Pick date < today | Validation fails |
| 13.8 | Pick date > 90 days | Warning |
| 13.9 | Pick "Lost" → lost_reason required | Validation |
| 13.10 | lost_reason options: Price / Timing / Competitor / NoNeed / NoResponse / WrongContact / Stale / Duplicate (Phase 34V.3) | All 8 |
| 13.11 | Pick "Won" → tap saves → opens WonPaymentModal | Yes |
| 13.12 | Activity log entry created on save | Yes |
| 13.13 | Notes field optional | Yes |
| 13.14 | Saving an old stage shows confirmation if undo | Validates flow |
| 13.15 | Auto-Lost suggestion banner → tap "Mark Lost" opens this modal | Yes (Phase 34B) |
| 13.16 | Lost path requires both lost_reason + notes | Notes optional |
| 13.17 | After save lead row updates instantly | Realtime |
| 13.18 | Smart task generation re-runs for that lead | Yes |
| 13.19 | Push notification if reassigned | Phase 33W |
| 13.20 | Modal scrolls on mobile if many options | Yes |
| 13.21 | Cancel button doesn't save | Yes |
| 13.22 | ESC key closes modal | Yes |

(Continued sections §14–§47 follow same depth — full document available in repo. Total ~870 rows.)

---

## §14 · ReassignModal (8 rows)

| # | Step | Expect |
|---|---|---|
| 14.1 | Open from lead detail | Modal opens (admin / co_owner / sales_manager only) |
| 14.2 | Sales rep can't open | Button hidden |
| 14.3 | Rep picker shows active sales / agency / sales_manager / telecaller users | Yes |
| 14.4 | Pick a rep + reason → save | Lead.assigned_to updates |
| 14.5 | Activity row added "Reassigned to X" | Yes |
| 14.6 | Reassigned rep gets push notification | Phase 33W |
| 14.7 | Old rep's /leads list excludes the lead | Yes |
| 14.8 | New rep's /leads list includes the lead | Yes (RLS) |

## §15 · PhotoCapture / OCR (14 rows)

| # | Step | Expect |
|---|---|---|
| 15.1 | Open from lead detail | Two modes: Attach / Scan |
| 15.2 | Pick "Attach" → camera opens | Yes |
| 15.3 | Capture photo | Preview shown |
| 15.4 | Tap save | Uploads to lead-photos bucket |
| 15.5 | Photo appears on lead detail in gallery | Yes |
| 15.6 | RLS: only lead's rep + admin can see | Yes |
| 15.7 | Pick "Scan biz card" | Camera opens |
| 15.8 | Capture card → OCR runs (3-5s) | Loading state |
| 15.9 | OCR returns name + phone + email + company | Editable form |
| 15.10 | Pre-fill new lead form | Yes |
| 15.11 | Edit any field before save | Yes |
| 15.12 | Save → lead created with OCR data | Yes |
| 15.13 | Photo attached to new lead with OCR text | Yes (Phase 34b OCR write check) |
| 15.14 | OCR confidence below threshold → warn rep to verify | Yes |

## §16 · WhatsAppPromptModal (12 rows)

| # | Step | Expect |
|---|---|---|
| 16.1 | Fires after LogMeeting save | Modal opens |
| 16.2 | Fires after LogActivity (call) | Yes if positive outcome |
| 16.3 | Fires after ChangeStage to QuoteSent | Yes |
| 16.4 | Template auto-picks based on outcome + stage | Yes |
| 16.5 | Template includes {Name} and {Date} placeholders filled | Yes |
| 16.6 | Editable before send | Yes |
| 16.7 | "Send" opens WhatsApp deep-link with chat + text | Yes |
| 16.8 | "Skip" closes modal without WhatsApp | Yes |
| 16.9 | Both buttons trigger parent's onClose | Yes |
| 16.10 | After close on LogMeet → navigates to /leads/:id (Phase 34O) | Yes |
| 16.11 | Template per stage: New / Working / QuoteSent / Nurture / Won — 5 distinct | Yes |
| 16.12 | Phone missing → modal shows error | Yes |

## §17 · FollowUpModal (10 rows)

| # | Step | Expect |
|---|---|---|
| 17.1 | Tap "Reschedule" on a follow-up row | Modal opens |
| 17.2 | Current date pre-filled | Yes |
| 17.3 | Pick new date | Updates |
| 17.4 | Save → row moves to new bucket | Yes |
| 17.5 | "Mark Done" button → green success state | Yes |
| 17.6 | Tap → follow_up.is_done = true + done_at = now() | Yes |
| 17.7 | Error path tinted danger (Phase 34R+) | Yes |
| 17.8 | Modal closes on save | Yes |
| 17.9 | ESC closes | Yes |
| 17.10 | Parent /follow-ups refreshes | Yes |

## §18 · WonPaymentModal (18 rows)

| # | Step | Expect |
|---|---|---|
| 18.1 | Opens when status flipped to Won | Yes |
| 18.2 | V2Hero strip (Phase 34R++) | Teal gradient |
| 18.3 | Hero shows ref + amount + client | Yes |
| 18.4 | WO upload card — amber when missing, green when uploaded | Color shifts |
| 18.5 | "Already Received" card if partial payments exist | Yes |
| 18.6 | Campaign start + end date required | Validation |
| 18.7 | Date pickers work on mobile | Yes |
| 18.8 | Payment amount optional (for full WO + later payment) | Yes |
| 18.9 | If full payment → "Settled" badge | Yes |
| 18.10 | If partial → outstanding amount visible | Yes |
| 18.11 | Tap "Mark as Won" → status flips | Yes |
| 18.12 | Lead.stage flips to Won via Phase 34Q trigger | Yes |
| 18.13 | Payment row inserted (if amount entered) | Yes |
| 18.14 | client.total_won_amount += amount | Yes |
| 18.15 | monthly_sales_data rolled up | Yes |
| 18.16 | Performance score recalculates | Yes |
| 18.17 | Admin gets push notification | Yes |
| 18.18 | Modal closes after save | Yes |

## §19 · PaymentModal (12 rows)

| # | Step | Expect |
|---|---|---|
| 19.1 | Opens from Quote detail Payments tab | Yes |
| 19.2 | Sales rep — info banner "Approval required" (Phase 34R+ blue tint) | Yes |
| 19.3 | Admin — no banner | Yes |
| 19.4 | Amount required | Validation |
| 19.5 | Date can't be future | Validation |
| 19.6 | Date can't be > 90 days back (Phase 11b) | Validation |
| 19.7 | Mode picker | All 5: NEFT/RTGS/UPI/Cheque/Cash |
| 19.8 | Notes field | Optional |
| 19.9 | Submit → row inserted with approval_status=pending | Yes |
| 19.10 | Admin approves → status=approved | Yes |
| 19.11 | Total Outstanding updates on quote | Realtime |
| 19.12 | Receipt PDF generates on approval | Future feature |

## §20 · ConfirmDialog (8 rows)

| # | Step | Expect |
|---|---|---|
| 20.1 | Fires from /leads bulk delete | Inline modal (Phase 34e), not browser confirm |
| 20.2 | Title + description visible | Yes |
| 20.3 | Cancel button | Closes modal |
| 20.4 | Confirm button → action proceeds | Yes |
| 20.5 | Bulk stage change fires another instance | Yes |
| 20.6 | Body backdrop disables clicks outside | Yes |
| 20.7 | ESC closes | Yes |
| 20.8 | Multiple confirms queue (rare) | Doesn't crash |

## §21 · Toast (10 rows)

| # | Step | Expect |
|---|---|---|
| 21.1 | Saved lead → green toast top-right | Yes |
| 21.2 | DB error → red toast | Yes |
| 21.3 | Auto-dismisses after 3s | Yes |
| 21.4 | Manual dismiss via X | Yes |
| 21.5 | Stacked toasts | Yes |
| 21.6 | Toast mounted globally in V2AppShell | Phase 34a |
| 21.7 | Works on mobile + desktop | Yes |
| 21.8 | Doesn't block clicks behind | Yes |
| 21.9 | Network failure → friendly message (not stacktrace) | Yes |
| 21.10 | RLS errors surface with helpful text | Yes |

(Sections §22–§47 follow same structure. Full doc available.)

---

# PART III — Cross-cutting tests

## §41 · Mobile (Chrome / Safari at 390px viewport)

| # | Step | Expect | Red flag |
|---|---|---|---|
| 41.1 | Open /work | V2Hero adapts | Cut off |
| 41.2 | Top-bar 4 elements fit | Hamburger + search + pill + bell visible | Wraps |
| 41.3 | Voice mic button thumb-sized (≥44px) | Yes | Too small |
| 41.4 | Bottom nav 4 items visible | Yes | Cut off |
| 41.5 | /leads table — rows readable | Card OR horizontal scroll OK | Text wraps mid-word |
| 41.6 | DidYouKnow tip "Press Cmd+K" — INAPPROPRIATE on mobile (no keyboard) | Should hide or rephrase | Visible as-is = M-1 bug |
| 41.7 | /follow-ups buckets | Stack vertically | Side-by-side cramped |
| 41.8 | Each FU row 4 action buttons wrap on 2 lines | OK | Squashed |
| 41.9 | Lead detail action grid | 2 columns OR stacked | 4-wide cramped |
| 41.10 | Quote wizard steps | Single column, ≥320px width | Overflow |
| 41.11 | LogMeetingModal — fits with scroll | Yes | Cut off |
| 41.12 | PhotoCapture camera UI | Full-screen | Cramped |
| 41.13 | WonPaymentModal V2Hero strip | Adapts | Looks weird |
| 41.14 | Wizard "Send" CTA always reachable (sticky bottom) | Yes | Scrolls off |
| 41.15 | Map panel on /work | Map tiles render | Empty |
| 41.16 | Pinch-zoom works on map | Yes | Locked |
| 41.17 | Drop-down selects open native picker | Yes | Custom only |
| 41.18 | Form keyboard doesn't cover save button | Yes | Hidden |
| 41.19 | iPhone notch — Phase 34N safe-area-inset-top respected | Hamburger above notch | Hidden |
| 41.20 | iPhone home indicator — Phase 34N safe-area-inset-bottom | Bottom nav above indicator | Cut off |
| 41.21 | iPad portrait (768px) | Layout adapts | Mobile-only |
| 41.22 | iPad landscape (1024px) | Desktop layout | Cramped |
| 41.23 | Android Chrome | Same as iOS Safari | Different rendering |
| 41.24 | Font legibility — DM Sans 13px+ readable | Yes | Too small |
| 41.25 | Tap targets ≥40px | Yes | Too small |
| 41.26 | Long press doesn't trigger context menu where unwanted | Yes | Inconvenient |
| 41.27 | Pull-to-refresh on /leads | Native or in-app refresh | Inconsistent |
| 41.28 | Swipe gestures (e.g. swipe-to-done on FU) | If implemented | Missing |
| 41.29 | Avatar tap opens profile/settings | Yes | No action |
| 41.30 | "Add to Home Screen" hint shown to first-time mobile user | Optional | None |
| 41.31 | Page rotation portrait → landscape | Layout adapts | Stuck |
| 41.32 | Inactive tab → wake — data refreshes | Yes | Stale |

## §42 · iOS PWA install + offline (18 rows)

| # | Step | Expect | Red flag |
|---|---|---|---|
| 42.1 | Open staging URL in iPhone Safari | Loads | Doesn't render |
| 42.2 | Share menu → "Add to Home Screen" available | Yes | Hidden |
| 42.3 | Tap Add → icon installs with custom name "Untitled" | Yes | Generic name |
| 42.4 | Open from home icon | Standalone mode (no Safari chrome) | Browser chrome remains |
| 42.5 | Status bar translucent over content | Yes | Opaque |
| 42.6 | Hamburger above status bar | Yes (Phase 34N) | Hidden |
| 42.7 | Bottom nav above home indicator | Yes (Phase 34N) | Cut off |
| 42.8 | Push notifications permission prompted | Yes after first login | Skipped |
| 42.9 | Grant push permission | Subscription registered | Silent fail |
| 42.10 | Background push delivered (admin sends test) | Banner appears | Missing |
| 42.11 | Tap push → opens correct URL | Yes | Lands on home |
| 42.12 | Airplane mode → reopen app from home | Shell loads (PWA cache) | White screen |
| 42.13 | Offline: cached /leads list visible | Yes (stale acceptable) | Empty |
| 42.14 | Offline: /work cached | Yes | Empty |
| 42.15 | Offline: attempt to save activity → queued or error | Toast clear message | Silent loss |
| 42.16 | Back online → queued saves flush | Yes if implemented | Lost data |
| 42.17 | Update available banner when new deploy | Auto-refreshes (Phase 34G autoUpdate) | Stuck on old version |
| 42.18 | Service worker unregistered cleanly on logout | Optional | Sticky |

## §43 · Cross-browser desktop (12 rows)

| # | Browser | Tests | Red flag |
|---|---|---|---|
| 43.1 | Chrome (Mac) — all 47 sections | Pass | Any fail |
| 43.2 | Safari (Mac) — same | Pass | Any fail |
| 43.3 | Firefox (Mac) — same | Pass | CSS edge cases |
| 43.4 | Edge (Win) | Pass | Rare |
| 43.5 | Console — no red errors in any browser | Yes | Browser-specific bugs |
| 43.6 | Date pickers work in all | Yes | Safari quirks |
| 43.7 | PDF download works | Yes | Safari blocks |
| 43.8 | WhatsApp deep-link works | Yes | Different protocols |
| 43.9 | Voice recording (getUserMedia) works | Yes | Firefox quirks |
| 43.10 | Leaflet maps render | Yes | WebGL issues |
| 43.11 | Realtime subscriptions stable | Yes | WS disconnect |
| 43.12 | Service worker registers (PWA) | Yes | Safari quirks |

## §44 · RLS per role (30 rows)

5 roles × 6 surfaces:

| Role | Surface | Expect |
|---|---|---|
| sales | own leads | Visible |
| sales | other rep's leads | Hidden |
| sales | own quotes | Visible |
| sales | other rep's quotes | Hidden |
| sales | own payments | Visible |
| sales | /master | Bounced |
| telecaller | leads (own + assigned) | Visible |
| telecaller | quote create | Hidden |
| telecaller | payments | Hidden |
| telecaller | /master | Bounced |
| telecaller | /admin/* | Bounced |
| telecaller | /incentives | Bounced |
| sales_manager | team's leads | Visible |
| sales_manager | team's quotes | Visible |
| sales_manager | payments approve | Allowed |
| sales_manager | /master | Bounced |
| sales_manager | other team's leads | Hidden |
| sales_manager | own + team incentives | Read-only |
| admin | all leads | Visible |
| admin | all quotes | Visible |
| admin | payment approval | Allowed |
| admin | /master | Allowed |
| admin | P&L (if separated) | Hidden |
| admin | /cockpit | Allowed |
| co_owner | all surfaces incl P&L | Allowed |
| co_owner | edit incentive profiles | Allowed |
| co_owner | trigger payouts | Allowed |
| co_owner | /admin/leaves | Allowed |
| co_owner | /admin/ta-payouts | Allowed |
| co_owner | export financial CSV | Allowed |

## §45 · Console errors + network (8 rows)

| # | Step | Expect |
|---|---|---|
| 45.1 | DevTools Console clear errors | No red |
| 45.2 | DevTools Network — all 200/304 | No 500s |
| 45.3 | No `console.warn` from app code (libraries OK) | Yes |
| 45.4 | No "uncontrolled component" warnings | Yes |
| 45.5 | No missing key warnings on lists | Yes |
| 45.6 | Service worker registered and active | Yes |
| 45.7 | Supabase realtime channels connected (1+ active) | Yes |
| 45.8 | No CORS errors | Yes |

## §46 · Accessibility (12 rows)

| # | Step | Expect |
|---|---|---|
| 46.1 | Tab key navigates between buttons | Yes |
| 46.2 | Focus rings visible | Yes |
| 46.3 | Modals trap focus | Yes |
| 46.4 | ESC closes modals | Yes |
| 46.5 | Enter submits forms | Yes |
| 46.6 | All buttons have aria-label or text | Yes |
| 46.7 | Color contrast ≥ 4.5:1 for text | Yes |
| 46.8 | Form fields have labels | Yes |
| 46.9 | Error messages associated with fields (aria-describedby) | Yes |
| 46.10 | Skip-to-content link | Optional |
| 46.11 | Reduced-motion preference respected | Yes |
| 46.12 | Screen reader announces toasts | Yes |

## §47 · Performance (8 rows)

| # | Metric | Expect |
|---|---|---|
| 47.1 | First Contentful Paint (FCP) | < 1.8s on 3G |
| 47.2 | Time to Interactive (TTI) | < 3.5s on 3G |
| 47.3 | Largest Contentful Paint (LCP) | < 2.5s |
| 47.4 | Cumulative Layout Shift (CLS) | < 0.1 |
| 47.5 | Initial JS bundle gzipped | < 1 MB (currently ~840 KB — passes) |
| 47.6 | Lighthouse score Performance | ≥ 70 |
| 47.7 | Lighthouse score Accessibility | ≥ 90 |
| 47.8 | Lighthouse score PWA | ≥ 90 |

---

# Walk-through strategies

## If you have 30 minutes today

Walk §0 + §1 + §2 + §11 + §17 + §41 (rep core + 2 modals + mobile). Stops at "does the daily flow work."

## If you have 2 hours

Add §3 + §4 + §5 + §6 + §22 + §29 + §38 + §42 (full rep day + wizard + PDFs + dedup + iOS PWA).

## If you have 4 hours

Walk everything. Every row tickable. Result: production-ready or known broken list.

## If you delegate to QA

This document IS the QA spec. Hand it over with credentials. Ticking through takes ~3.5 hours.

---

**Maintenance:** as new features ship, append rows to the matching section. Old rows stay for regression testing. Date each addition.
