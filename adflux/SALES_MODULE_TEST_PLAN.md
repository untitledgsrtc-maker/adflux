# Sales Module Master Test Plan

**For:** owner (Brijesh) walk-through on staging — `https://untitled-os-tau.vercel.app`
**Generated:** 2026-05-13 (after Phase 34A–W shipped)
**Estimated time:** 60–90 minutes
**How to use:** open this on one screen, open the app on another (or print). Tick each row as you go. Anything that fails → screenshot + paste back.

The structure is **rep-day-ordered** so you walk through the flow the way a real sales rep would, not in random page order. Every line ends with **EXPECT** (what should happen) and **RED FLAG** (what to scream about).

---

## 0 · Prerequisites

| # | Step | EXPECT | RED FLAG |
|---|---|---|---|
| 0.1 | Push latest code: `git push origin untitled-os` | Vercel shows "Building" → "Ready" within ~90s | Build error in Vercel dashboard |
| 0.2 | Run all pending SQL files in staging Supabase Studio (paste each file's contents, run, paste VERIFY row) | All Phase 34 SQL runs return their VERIFY block with expected counts | Any SQL error |
| 0.3 | Hard refresh app (Cmd+Shift+R on Mac, or quit+reopen iPhone PWA) | App reloads with new build | Service worker keeps serving old build → DevTools → Application → Service Workers → Unregister |
| 0.4 | Open browser DevTools → Console tab | No red errors on `/work` load | Red errors = paste them |

---

## 1 · `/work` — Today (the most-used page)

| # | Step | EXPECT | RED FLAG |
|---|---|---|---|
| 1.1 | Open `/work` first thing in morning | "Speak your day plan" yellow tip card at top + "Good morning, <name>" greeting | Tip missing → DidYouKnow component broken |
| 1.2 | Look at top-right of top bar | Yellow "₹0 · 0% to slab" pill visible (sales rep only) | Pill missing → IncentiveMiniPill broken |
| 1.3 | Plan card visible by default | "Today's plan — speak it (mic below) or fill in" header, expanded card with mic CTA | Plan card collapsed → Phase 34O regression |
| 1.4 | Tap "Start My Day" with no plan | Inline error "Please add your plan first — tap the mic and speak it, or fill at least one meeting / call target." | Day starts without plan → gate broken |
| 1.5 | Tap voice mic (big yellow round button) | Button goes red → "Listening… tap to stop" → tap again → spinner → AI fills meetings/calls | Mic doesn't activate → check mic permission in browser |
| 1.6 | Speak: "Today I have 2 meetings with Mehul Patel in Vadodara and 10 calls." | After AI processing, plannedMeetings has 1-2 rows, plannedCalls = 10 | Empty fields = parse-day-plan Edge Fn broken |
| 1.7 | Manually add a meeting row | Row appears with Client / Where inputs | Can't add row |
| 1.8 | Tap "Start My Day" with valid plan | Page advances to A_CHECKIN state | Stuck on A_PLAN |
| 1.9 | Tap "Check in" → grant GPS | Page advances to B_ACTIVE | "Check-in is past 9:30 AM" → enter late reason, retry |
| 1.10 | Look at B_ACTIVE landing | Teal V2Hero "Today · in progress · X/Y meetings" + "calls · new leads" chip + "X to go" or "target hit" right side | Hero missing → V2Hero not imported |
| 1.11 | Confirm NO duplicate ring rows below hero (Phase 34S removed) | Only the existing MeetingRing widget remains (1 ring, not 3) | 3-up ring row present → Phase 34S didn't deploy |
| 1.12 | Scroll down → "Coming up" card | Tomorrow + Next 7 days counts visible (or card hidden if empty per Phase 34S) | Card present + says "Nothing scheduled — go hunt leads" → 34S empty-state fix not deployed |
| 1.13 | Scroll further → "This week on the map" panel collapsed | Tap to expand → Leaflet map renders with OpenStreetMap tiles | Empty map / loading forever → Leaflet broken |
| 1.14 | Tap the big yellow "Meeting" CTA | LogMeetingModal opens | Stays on /work |

---

## 2 · `/work` Log Meet flow (cold walk-in)

| # | Step | EXPECT | RED FLAG |
|---|---|---|---|
| 2.1 | In LogMeetingModal, type "Test Company" in Company field | Field accepts | Field frozen |
| 2.2 | Type a NEW phone number (one that doesn't exist) | No warning chip below | Warning chip wrongly fires |
| 2.3 | Type a phone that ALREADY exists in pipeline | Within ~600ms, amber chip appears: "Already in pipeline: <Name> · <Company> (<Stage>)" | No chip → Phase 34.10 dedup broken |
| 2.4 | Fill in Name + City + pick outcome | Form accepts everything | Validation blocking |
| 2.5 | Save the new (non-dup) lead | Toast appears "Saved · N/5 meetings today" | Silent save / no toast |
| 2.6 | WhatsApp prompt opens after save | Pre-filled template based on outcome | Prompt missing |
| 2.7 | Close WhatsApp prompt (Skip or Send) | Page **navigates to `/leads/:id`** of the new lead (Phase 34O) | Stays on /work → Phase 34O navigate not deployed |

---

## 3 · `/leads` — Lead list

| # | Step | EXPECT | RED FLAG |
|---|---|---|---|
| 3.1 | Open `/leads` | Page renders. AI Briefing card at top. Page-head with "My Leads" + chip stats | Blank page |
| 3.2 | Check Mr. Nemi Shah | After Phase 34V dedupe ran successfully, **Mr. Nemi Shah appears once in "Open" or "All" tab** (canonical New row) | **If 7 rows still visible** → re-run Phase 34V dedupe SQL or hard-refresh |
| 3.3 | Switch to "Lost" tab | 6 Nemi Shah rows visible with stage `Lost` + reason "Duplicate" | Dedupe didn't actually run |
| 3.4 | Stage-age chip on Working/Quote-sent rows | Chip "N d in <Stage>" visible below stage chip; red if ≥5d, amber if ≥3d, muted if <3d | No chip → Phase 34L SQL not run (`stage_changed_at` col missing) |
| 3.5 | Bulk select 2 leads → "Move stage" dropdown → pick "Working" | **Inline ConfirmDialog opens** with yellow Move button | Browser `confirm()` dialog = Phase 34e not deployed |
| 3.6 | Bulk select 2 leads → "Delete" button | **Inline ConfirmDialog with red Delete** + "cannot be undone" warning | Browser `confirm()` = regression |
| 3.7 | Type "acme" in search | List filters | Filter doesn't apply |
| 3.8 | Tap any row | Goes to `/leads/:id` | Stays on list |

---

## 4 · `/leads/:id` — Lead detail (most complex page)

| # | Step | EXPECT | RED FLAG |
|---|---|---|---|
| 4.1 | Open any open lead | DidYouKnow tip "Use the mic inside notes" at top | Tip missing |
| 4.2 | If lead has 3+ unanswered call activities → check banner | Red "System suggests marking Lost" banner with [Mark Lost] [Dismiss] | Banner missing → Phase 34B trigger not applied |
| 4.3 | Tap "Dismiss" on the banner | Banner disappears, RPC `dismiss_auto_lost_suggestion` fires | Toast error |
| 4.4 | If lead.last_contact_at > 30d → stale banner | Warning-tint banner "Last contact X days ago" | Missing |
| 4.5 | Stage chip in hero | Plus StageAgeChip "N d in <Stage>" right after it (unless Won/Lost) | Missing |
| 4.6 | Tap "Call" tile | Opens phone dialer with the number | Number wrong / no dial |
| 4.7 | Tap "WhatsApp" tile | Opens WhatsApp with templated message based on stage | Message blank |
| 4.8 | Tap "Log Activity" → Call → outcome "neutral" → set next_action_date 5 days from now | Saves with toast | Silent fail |
| 4.9 | After save → `/follow-ups` page → confirm follow-up row exists for that lead 5 days out | Row visible | Missing → Phase 34 activity-sync trigger not applied |
| 4.10 | Tap "Log Activity" → notes field → tap mic button | Recorder activates (red dot or stop button) | Mic broken |
| 4.11 | Speak 5 seconds → tap stop | Spinner → text appended to notes field | No transcription |
| 4.12 | Edit lead name field inline | Saves on blur | Static field |
| 4.13 | Scroll to bottom → "Lead milestones" card | Created / Qualified / Sales Ready / Lost reason / Nurture revisit rows (Phase 34S — no more status_change rows duplicating timeline) | Missing — verify Phase 34S delivered |

---

## 5 · `/quotes` — Quote list

| # | Step | EXPECT | RED FLAG |
|---|---|---|---|
| 5.1 | Open `/quotes` | DidYouKnow tip "Start new quote 3x faster — Copy from your last quote" | Missing |
| 5.2 | "Total quotes" / "Total amount" / "Outstanding" cards at top | All render with numbers | Empty / NaN |
| 5.3 | Click "New Quote" button (topbar OR page-head) | Opens wizard chooser | Stays on list |

---

## 6 · `/quotes/new/private` — Private LED wizard

| # | Step | EXPECT | RED FLAG |
|---|---|---|---|
| 6.1 | Open wizard from /quotes/new → Private | Step 1 (Client) visible | Blank |
| 6.2 | Above Step 1 fields → "Copy from your last quote" button | Visible (only in create mode, not edit/renewal) | Missing |
| 6.3 | Tap "Copy from your last quote" | Toast "Copied client + N cities from your last quote" + fields fill | Toast error |
| 6.4 | Click Next → Step 2 (Campaign) | Cities table visible | Stuck |
| 6.5 | Click Next → Step 3 (Review) | Total + GST + **"Amount in Words"** line visible | "Amount in Words" missing → rupeesToWords not wired |
| 6.6 | Click "Send to Client" | PDF generates, WhatsApp opens with link | "PDF generation failed: Could not resolve font for Roboto" → Phase 34T/P not deployed |

---

## 7 · `/quotes/new/government/auto-hood` — Govt Auto Hood (Phase 34H)

| # | Step | EXPECT | RED FLAG |
|---|---|---|---|
| 7.1 | Step 3 (Quantity) — enter 1500 rickshaws + 3 months | Live preview shows subtotal ₹37,12,500 + GST + Grand Total ₹43,80,750 | Single-month calc → Phase 34H not deployed |
| 7.2 | Step 4 (Districts) → continue → Step 5 (Review) | Gujarati proposal table includes "Months / મહિના" column | Column missing → Phase 34H renderer not updated |
| 7.3 | Save Draft → open from /quotes/:id → Download PDF | PDF contains Months column | Missing |

---

## 8 · `/quotes/new/government/gsrtc-led` — Govt GSRTC (Phase 34K)

| # | Step | EXPECT | RED FLAG |
|---|---|---|---|
| 8.1 | Reach Step 5 (Review) | Page 2 table header shows **two lines** "૧ સ્લોટ (૧૦ સે.)" / "નો ભાવ" | Header wraps mid-word or overflows into "માસિક કુલ" |

---

## 9 · `/quotes/:id` — Quote detail

| # | Step | EXPECT | RED FLAG |
|---|---|---|---|
| 9.1 | Open any open quote as a sales rep | DidYouKnow tip "Closing this deal?" + Incentive Forecast Card at bottom of Overview | Either missing |
| 9.2 | **Confirm only ONE incentive number from ProposedIncentiveCard strip — NOT visible here** (Phase 34S hid it on quote pages) | Card hidden | Card visible → Phase 34S not deployed |
| 9.3 | Tap "WhatsApp" | PDF generates + WhatsApp opens with link in message | "PDF generation failed" error |
| 9.4 | Tap "Email" | Same flow with Gmail compose | Error |
| 9.5 | Tap "Download PDF" | PDF file downloads | Font error |
| 9.6 | Status dropdown → change to Won | WonPaymentModal opens with V2Hero teal strip "Mark this Won · ₹X · UA-2026-NNNN · <Company>" | Strip missing → Phase 34R+ regression |
| 9.7 | Fill campaign dates + WO upload + payment → Confirm Won | Quote status flips to "won" | Error |
| 9.8 | Open the originating lead | **Lead stage now = Won** | Lead still in QuoteSent → Phase 34Q trigger not applied |

---

## 10 · `/follow-ups`

| # | Step | EXPECT | RED FLAG |
|---|---|---|---|
| 10.1 | Open `/follow-ups` | DidYouKnow tip "After the call, log it" | Missing |
| 10.2 | Overdue / Today / Tomorrow / This week sections | Each renders with row count chip | Empty render |
| 10.3 | Tap "Call" on any row | Phone dials | No dial |
| 10.4 | Tap "Mark Done" | Row disappears with toast | Row sticks |
| 10.5 | Nurture revisit section | Shows leads in Nurture stage with revisit_date today | Missing |

---

## 11 · `/my-performance` — Personal scorecard

| # | Step | EXPECT | RED FLAG |
|---|---|---|---|
| 11.1 | Open `/my-performance` | DidYouKnow tip "See per-quote incentive" | Missing |
| 11.2 | PerformanceScoreCard renders | Big score number, base + variable salary breakdown | Empty |
| 11.3 | Top-bar pill | Shows "₹X · Y% to slab" (or "to target" if past slab) | Just "%" with no qualifier → Phase 34S not deployed |

---

## 12 · `/telecaller` (telecaller role only)

| # | Step | EXPECT | RED FLAG |
|---|---|---|---|
| 12.1 | Log in as telecaller, open `/telecaller` | DidYouKnow tip "Stop typing call notes" | Missing |
| 12.2 | Next Call hero card | Shows lead with biggest phone number | Empty |
| 12.3 | "BREACH" → should say "<N> leads past 24h handoff SLA" | Reads handoff-SLA copy | Old "SalesReady" wording → Phase 34S copy fix not deployed |

---

## 13 · `/team-dashboard` (admin only)

| # | Step | EXPECT | RED FLAG |
|---|---|---|---|
| 13.1 | Open `/team-dashboard` | Each rep card foot shows "● live · N min ago" if recently pinged (green when ≤10 min) | Only static city → Phase 34U not deployed |
| 13.2 | Pipeline added today / Voice logs | Numbers render | Zeros where data exists |

---

## 14 · `/admin/gps/<rep-id>/<date>` — GPS day track (admin)

| # | Step | EXPECT | RED FLAG |
|---|---|---|---|
| 14.1 | Navigate to a rep's day track that has 20+ pings | Distance shows reasonable number (e.g. 200 km for a real driving day, not 0.0 nor 1300) | 0.0 km despite many pings = Phase 34U accuracy fallback not deployed; 1300+ km = Phase 34I filter not deployed |
| 14.2 | Polyline + start (green) + end (red) circles render on map | Visible | Empty map |

---

## 15 · `/admin/ta-payouts` (admin)

| # | Step | EXPECT | RED FLAG |
|---|---|---|---|
| 15.1 | Open `/admin/ta-payouts` | V2Hero strip top with rep name + month + grand total + km chip | Plain page-head only → Phase 34R++ not deployed |
| 15.2 | 3-up RingMilestoneRow Approved / Paid / Pending | Visible when a rep is selected and rows exist | Missing |
| 15.3 | Status chips on the day rows | pending=amber, approved=blue, paid=green, rejected=red — all tint-token colors | Material green hex visible = pre-Phase 34R style |

---

## 16 · `/dashboard` (admin)

| # | Step | EXPECT | RED FLAG |
|---|---|---|---|
| 16.1 | Open `/dashboard` as admin | AiBriefingCard at top | Missing |
| 16.2 | Confirm NO `SlaBreachBanner` + NO `StaleLeadsAlertCard` below (Phase 34S removed) | Only AiBriefingCard | Either banner visible → Phase 34S not deployed |
| 16.3 | Pipeline funnel + win rate cards | Render | Empty |

---

## 17 · Lead-create dedup (Phase 34W trigger)

| # | Step | EXPECT | RED FLAG |
|---|---|---|---|
| 17.1 | Open `/leads/new` | Form renders | Blank |
| 17.2 | Enter Mr. Nemi Shah's phone "7069082826" (he's still OPEN as one canonical row) | Inline warning "This phone is already in your pipeline as Mr. Nemi Shah" + Open existing button | No warning → Phase 33D.6 dedup broken |
| 17.3 | Try to save anyway (force) | DB rejects with friendly error including existing lead id | INSERT succeeds → Phase 34W trigger not run in Supabase |

---

## 18 · Mobile / iOS PWA (open on iPhone)

| # | Step | EXPECT | RED FLAG |
|---|---|---|---|
| 18.1 | Open staging URL in Safari → Share → "Add to Home Screen" | Untitled OS icon appears | Doesn't install |
| 18.2 | Open from home-screen icon | App opens full-screen, no Safari chrome | Browser chrome remains → not standalone |
| 18.3 | Top bar — hamburger button | Tappable, fully visible (not under notch) | Hidden behind notch → Phase 34N CSS not deployed |
| 18.4 | Bottom nav — Today/Leads/Quotes/Voice | Visible above iPhone home indicator | Cut off → Phase 34N safe-area-inset-bottom missing |
| 18.5 | Test offline — Settings → Airplane Mode → reopen app from home screen | App shell loads from PWA cache (data shows last-known or stale) | White screen → Phase 34G PWA cache broken |

---

## 19 · Smoke checks per role (1 min each)

| # | Role | Test | EXPECT |
|---|---|---|---|
| 19.1 | sales rep | Land on /work, see V2Hero, top-bar incentive pill | All visible |
| 19.2 | telecaller | Land on /telecaller, see Next Call hero | Visible |
| 19.3 | admin | Land on /dashboard, see hero KPIs + AiBriefingCard | Visible |
| 19.4 | co_owner | Same as admin + see P&L surfaces (if any) | Visible |

---

## 20 · Console errors (final sweep)

| # | Step | EXPECT |
|---|---|---|
| 20.1 | DevTools → Console while clicking through 10 pages | Zero red errors, maybe yellow warnings OK |
| 20.2 | DevTools → Network tab while pages load | All requests 200/304; no 500s on RPC calls |
| 20.3 | If you see any red error | Screenshot the console + the page URL → paste back |

---

## Where you'd realistically stop

If steps 1–10 + 17 all pass = the core sales rep daily flow works.
Steps 11–16 + 18 = admin / manager + iOS PWA polish.
Step 19–20 = sanity / no-regression.

Tick as you go. Anything that fails → paste row number + screenshot → I trace.

---

**Maintenance:** owner appends new rows here whenever a new feature ships, so this stays the canonical test surface for Sales.
