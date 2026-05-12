# Sales Module — Structure & UI Redesign Brief

**Purpose:** complete map of every screen, action, and data point in the Sales module today, formatted so the owner or a designer can redesign the UI from a clean slate without losing functionality.

**Date:** 2026-05-13
**Author:** Audit + inventory pass through code-review-graph + manual read
**Audience:** Brijesh + future designer

---

## 1 · Who uses Sales

| Role | What they do | Daily time in app |
|---|---|---|
| **Sales rep** (Brahmbhatt, Sondarva, Dhara, Vishnu, Nikhil) | Field meetings, calls, quotes, follow-ups | 6-8 hours |
| **Telecaller** | Inbound + cold calls, hand off warm leads to reps | 8 hours (mostly /telecaller) |
| **Sales Manager** | Oversee team, reassign leads, review pipeline | 1-2 hours |
| **Admin / Co-owner** | Pipeline overview, approvals, master config, incentives | 2-3 hours |
| **Agency** (sub-role) | Like sales, scoped to own deals | varies |

**Shift:** 9:30 AM – 7:30 PM IST. Mon-Sat (Sundays + holidays off).

---

## 2 · Top-level navigation (rep view)

```
┌─────────────────────────────────────────────────────────────┐
│  TOP BAR                                                    │
│  Search · Bell · Profile                                    │
├─────────────────────────────────────────────────────────────┤
│  LEFT NAV (desktop) / BOTTOM NAV (mobile)                   │
│                                                             │
│  📅 Today           (/work)              ← landing          │
│  ⏰ Follow-ups      (/follow-ups)                           │
│  📥 Leads           (/leads)                                │
│  📄 Quotes          (/quotes)                               │
│  👥 Clients         (/clients)                              │
│  🎁 Performance     (/my-performance)                       │
│  📚 Master (Voice)  (/voice)                                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Telecaller adds:** `/telecaller` (their primary queue).
**Admin adds:** `/dashboard`, `/lead-dashboard`, `/team-dashboard`, `/pending-approvals`, `/incentives`, `/cities`, `/auto-districts`, `/gsrtc-stations`, `/master`, `/admin/ta-payouts`, `/admin/leaves`.

---

## 3 · Page hierarchy (sales surface only)

```
Sales Module
│
├── DAILY DRIVERS (rep uses every day)
│   ├── /work                  ← Today's plan + GPS + KPIs
│   ├── /follow-ups            ← Overdue / Today / Tomorrow / Week
│   └── /leads                 ← Full lead list
│       └── /leads/:id         ← Lead detail (most-used inner page)
│
├── ADDING + IMPORTING
│   ├── /leads/new             ← New lead form
│   └── /leads/upload          ← Cronberry CSV import (admin)
│
├── QUOTE BUILDING
│   ├── /quotes                ← My quotes list
│   ├── /quotes/:id            ← Quote detail
│   ├── /quotes/new            ← Wizard chooser
│   ├── /quotes/new/private              ← Private LED 4-step wizard
│   ├── /quotes/new/private/other-media  ← Other Media wizard
│   ├── /quotes/new/government/auto-hood ← Govt AutoHood wizard
│   └── /quotes/new/government/gsrtc-led ← Govt GSRTC wizard
│
├── PERFORMANCE
│   ├── /my-performance        ← Score + projected salary
│   └── /incentives            ← Admin only — staff profiles + liability
│
├── VOICE + AI
│   ├── /voice                 ← Voice log a call (Gujarati / Hindi / English)
│   └── /voice/evening         ← End-of-day voice summary
│
└── TELECALLER-SPECIFIC
    └── /telecaller            ← 24h SLA queue + next-call hero card
```

---

## 4 · Per-page breakdown

For each page below: **URL · Purpose · Data shown · Actions · Modals · Mobile note**.

---

### 4.1 `/work` — Today

**Purpose:** rep's daily home. Plan → check-in → work → check-out.

**Data shown:**
- Greeting (Good morning, <First Name>)
- Today's date
- 5 task slots (rep-picked meetings + auto-suggested)
- Counters: Meetings · Calls · Voice logs · Quotes sent (live, auto from triggers)
- AI Briefing Card (top of viewport)
- Today's Tasks panel (Smart Task Engine, top 3 + "View all")
- Coming Up card (Tomorrow + Next 7 days — Phase 34C)
- Rep Day Tools (3-day-miss warning, overnight toggle, request leave)

**Actions:**
- Start Day / Check In (GPS)
- Tap a task slot → fills lead or activity
- Voice morning plan (mic at top) → AI parses to tasks
- Log Meet (cold walk-in fast path)
- Check Out (GPS end-of-shift)

**Modals opened:** LogMeetingModal, LogActivityModal (from task tap).

**Mobile:** mobile-first. The whole page is designed for thumb.

**Current UI issues:**
- 5-state day machine confusing for new rep ("Plan → Check-in → Active → Checkout → Done")
- Counter tiles compete visually with tasks
- "Today's Tasks" header says "Today's tasks · 8" but visually buried mid-page
- Voice plan mic button is small + lacks affordance
- No live time-of-day awareness ("you have 2 hours left in shift")

---

### 4.2 `/follow-ups` — Follow-ups list

**Purpose:** rep sees every follow-up they owe, grouped by urgency.

**Data shown:**
- Header: "X follow-ups · Y overdue"
- 4 buckets: Overdue, Today, Tomorrow, This Week
- Each row: client name + company + last activity hint + due chip
- Nurture revisits section (separate group, blue tint)

**Actions per row:**
- Call (dials phone)
- WhatsApp (opens deep link)
- Mark Done (toast confirms)
- Tap row → /leads/:id

**Mobile:** acceptable; bucket headers help skim.

**Current UI issues:**
- Long rows scroll; no quick-filter pills
- No "snooze 2 hours" option (only Mark Done)
- Nurture revisits section often missed (below the fold)
- No visual sort by which lead has the highest value/urgency

---

### 4.3 `/leads` — Lead list

**Purpose:** full pipeline list with filters + bulk admin actions.

**Data shown:**
- Header: "My Leads" (rep) or "Leads" (admin)
- 5 tabs: All · Open · Qualified · Won · Lost
- AI Briefing Card (admin only)
- Filter chips: stage, segment, source, heat, assigned rep
- Search bar
- Result rows: avatar + name + company + stage chip + heat dot + segment chip + last-contact relative time + next-action date

**Actions:**
- Tap row → /leads/:id
- Bulk select (admin): change stage, reassign, delete
- "New Lead" CTA top-right
- "Upload" CTA (admin)

**Modals opened:** ChangeStageModal, ReassignModal (bulk and per-row), ConfirmDialog (Phase 34e).

**Mobile:** cards instead of table; works but bulk select fiddly.

**Current UI issues:**
- 5 tabs + filters take 30% of viewport before first row
- Search hard to find on mobile
- No visual hierarchy — Hot ₹5L deals look same as ₹50K casual leads
- "Stage chip" + "Heat dot" + "Segment chip" + "Last contact" = info overload per row

---

### 4.4 `/leads/:id` — Lead detail

**Purpose:** most-used inner page. Single lead view with full history + actions.

**Data shown:**
- Back to leads link
- Stale-lead banner (if no contact 30+ days)
- Auto-Lost suggestion banner (Phase 34B)
- Lead header: name, company, segment chip, stage chip, heat dot, assigned rep
- Quick action row: Call · WhatsApp · Log Activity · Photo · Change Stage · Reassign
- Inline-editable fields (name, phone, email, company, address, notes, designation, website)
- I'm Here button (10-min dwell timer with GPS)
- Stage history (timeline of status_change activities)
- Activity timeline (all calls/meetings/notes, newest first)
- Latest quote card (link to /quotes/:id)
- Follow-ups list (linked to this lead)
- Lead photos (if any)

**Actions:** call, whatsapp, log activity, change stage, reassign, capture photo, mark done follow-up, open quote.

**Modals opened:** LogActivityModal, ChangeStageModal, ReassignModal, PhotoCapture, WhatsAppPromptModal.

**Mobile:** densest page in app; vertical scroll only.

**Current UI issues:**
- Too long; "Activity timeline" buries the latest action below 10+ entries
- Inline-edit fields look like static text; users miss they're editable
- "I'm Here" button purpose unclear
- 6+ buttons in quick-action row = visual noise

---

### 4.5 `/leads/new` — New lead form

**Purpose:** add lead manually.

**Data captured:**
- name * (required)
- company
- phone *
- email
- city
- segment (PRIVATE / GOVERNMENT)
- source (Field Meeting / Cold Call / Referral / Cronberry / Direct)
- industry
- heat (cold / warm / hot)
- notes

**Mobile:** OK; single long form.

**Current UI issues:**
- Long single-screen form; no progressive disclosure
- No "save & add another" for bulk manual entry
- Phone dedup check missing here (planted in LogMeetingModal in Phase 34.10 but not here)

---

### 4.6 `/leads/upload` — Cronberry CSV import (admin only)

**Purpose:** bulk import from CSV with Remarks regex parsing.

**Steps:**
1. Drop file or pick.
2. Map columns (auto-suggested).
3. Configure: default assignee, default segment, 90-day cutoff.
4. Preview parsed rows.
5. Import → progress bar → toast with counts.

**Current UI issues:**
- Column mapper not obvious how to change defaults
- Preview shows only 50 rows
- No error report download for failed rows

---

### 4.7 `/quotes` — Quote list

**Purpose:** rep's own quotes list.

**Data shown:**
- 5 status chips: draft, sent, negotiating, won, lost
- Filter, search, date range
- Rows: ref number, client, amount, status badge, date

**Mobile:** card layout works.

**Current UI issues:**
- No "show me last sent quote" quick shortcut
- Status chips drift visually from /leads tabs
- Amount column dominates; can't see other context

---

### 4.8 `/quotes/:id` — Quote detail

**Purpose:** view + share + manage a quote.

**Data shown:**
- Header: client name + segment + status badge
- Edit / Renewal / Download PDF / WhatsApp / Email buttons
- Tabs: Overview / Payments / Activities / Follow-ups
- City list with rates
- Subtotal + GST + Grand Total
- Incentive Forecast Card (Phase 34D — "If you close this, you earn +₹X")
- Payment Summary
- Status timeline

**Actions:** edit, mark Won (opens WonPaymentModal), download PDF, share via WhatsApp / Email, log payment.

**Modals opened:** WonPaymentModal, PaymentModal, FollowUpModal, EditCampaignModal.

**Mobile:** tabs work; PDF download triggers browser save.

**Current UI issues:**
- 4 tabs + 5 header buttons = cluttered top
- Status change dropdown buried behind a chevron
- Edit button competes with WhatsApp button for primary action

---

### 4.9 `/quotes/new/...` — Quote wizards

**Four flavours:**

| Wizard | Steps | Length |
|---|---|---|
| Private LED (`/private`) | Client → Campaign → Review → Send | 4 |
| Private Other Media (`/private/other-media`) | Client → Media → Review → Send | 4 |
| Govt Auto Hood (`/government/auto-hood`) | Quantity → Districts → Review | 3 |
| Govt GSRTC LED (`/government/gsrtc-led`) | Stations → Months → Review | 3 |

**Each wizard step shows:**
- Wizard header with progress (1 of 4)
- Step content (fields)
- Back / Next buttons
- "Save Draft" option

**New in Phase 34E:** "Copy from your last quote" button (Private LED only) — pre-fills client + cities.

**Current UI issues:**
- Step indicator looks like a separate header; doesn't feel part of form
- Validation errors don't auto-scroll into view
- "Save Draft" not visible enough — reps think they lose work on back-navigation
- Other Media wizard is shortest but feels longest (cluttered tax fields)

---

### 4.10 `/my-performance` — Personal scorecard

**Purpose:** rep sees own number + projected salary.

**Data shown:**
- Big score number (e.g. 64 / 100)
- Base salary line (e.g. ₹35,000 base × 70% = ₹24,500)
- Variable salary line (variable × score = ₹X)
- Projected total this month
- Daily targets: meetings, calls, quotes (vs hit/miss)
- Monthly revenue chart (last 6 months)
- Streak indicator
- Slab progress bar

**Mobile:** works but chart hard to read.

**Current UI issues:**
- Score number doesn't explain how to improve it
- Base + variable split confusing (math invisible)
- No "what's locking my next incentive" view

---

### 4.11 `/voice` and `/voice/evening`

**Purpose:** voice notes for calls / day summary.

**`/voice`:** pick a lead → record up to 60s → AI extracts outcome + next action + amount + stage → rep confirms → activity row + lead stage moved.

**`/voice/evening`:** record 20-30s end-of-day summary → AI breaks into Highlights / Blockers / Tomorrow → saves to `work_sessions`.

**Mobile:** primary surface (mic button big).

**Current UI issues:**
- Most reps don't know `/voice/evening` exists (Phase 34.9 added a DidYouKnow tip)
- After recording, the AI extraction screen has too many fields to confirm at once

---

### 4.12 `/telecaller` — Telecaller queue

**Purpose:** telecaller's primary screen.

**Data shown:**
- Next Call hero card (one lead, big phone number, last activity, age in queue)
- KPIs: calls today, connected, hand-offs, SLA hits
- Pending hand-offs to sales (with SLA breach pill)
- Full call queue (sortable)

**Mobile:** acceptable.

**Current UI issues:**
- "Next Call" hero card not differentiated enough from "Next 3 calls"
- SLA breach pill says "BREACH" — should explain ("Lead aging > 24h")
- No one-tap "call now" → auto-log workflow (item 1 of audit — needs CallKit)

---

## 5 · Modal inventory (sales-related)

| Modal | Triggered from | Purpose |
|---|---|---|
| **LogActivityModal** | LeadDetail action row | Log call/whatsapp/email/meeting/site-visit/note |
| **LogMeetingModal** | /work "Log Meet" tile | Cold walk-in fast-path with biz-card OCR |
| **ChangeStageModal** | LeadDetail · /leads bulk · auto-Lost banner | Move stage with conditional fields |
| **ReassignModal** | LeadDetail · /leads bulk | Move lead to different rep |
| **PhotoCapture** | LeadDetail · LeadForm | Biz card OCR or attach photo |
| **WhatsAppPromptModal** | After meeting save · post-call · post-stage-change | Pick templated message + send |
| **FollowUpModal** | Quote detail · /follow-ups inline | Reschedule or mark done |
| **WonPaymentModal** | Quote detail "Mark Won" button | Capture campaign dates + payment + WO upload |
| **PaymentModal** | Quote detail payments tab | Record a payment manually |
| **IncentivePayoutModal** | /incentives | Admin records monthly payout |
| **ConfirmDialog** (Phase 34e) | LeadsV2 bulk delete / bulk stage | Replaces browser confirm() |
| **Toast** (Phase 34a) | Anywhere | Success / warning / error / info banners |

---

## 6 · Reusable components (the visual vocabulary)

Anyone redesigning needs to know these exist + their roles:

| Component | What | Where to find |
|---|---|---|
| `StageChip` | Pill showing lead/quote stage | `LeadShared.jsx` |
| `HeatDot` | Colored dot (red=hot, orange=warm, blue=cold) | `LeadShared.jsx` |
| `SegChip` | PRIVATE / GOVERNMENT pill | `LeadShared.jsx` |
| `LeadAvatar` | Initials circle | `LeadShared.jsx` |
| `Pill` | Generic chip | `LeadShared.jsx` |
| `QuoteStatusBadge` | Quote status as chip | `QuoteStatusBadge.jsx` |
| `Toast` | Bottom-right notification | `v2/Toast.jsx` |
| `ConfirmDialog` | Centered modal for destructive ops | `v2/ConfirmDialog.jsx` |
| `DidYouKnow` | Yellow lightbulb tip card | `v2/DidYouKnow.jsx` |
| `TodayTasksPanel` | Smart Task Engine ranked list | `leads/TodayTasksPanel.jsx` |
| `UpcomingTasksCard` | Tomorrow + Week preview | `leads/UpcomingTasksCard.jsx` |
| `RepDayTools` | 3-day-miss warning + leave request | `leads/RepDayTools.jsx` |
| `FollowUpList` | List of follow-ups for a lead/quote | `followups/FollowUpList.jsx` |
| `PerformanceScoreCard` | Score number + bar + breakdown | `performance/PerformanceScoreCard.jsx` |
| `IncentiveForecastCard` | "If you close this, you earn X" | `quotes/IncentiveForecastCard.jsx` |
| `CockpitWidgets` | AI brief + smart task widgets (admin) | `dashboard/CockpitWidgets.jsx` |

---

## 7 · Data model (what tables drive what UI)

```
leads
  ↓ activities
  └── lead_activities (call, whatsapp, meeting, site_visit, note, status_change)
  ↓ photos
  └── lead_photos
  ↓ smart tasks (engine output)
  └── lead_tasks
  ↓ follow-ups
  └── follow_ups (lead_id + quote_id versions)
  ↓ quote
  └── quotes
       ↓ line items
       └── quote_cities
       ↓ payments
       └── payments
       ↓ follow-ups
       └── follow_ups

users
  ├── staff_incentive_profiles (per-rep slab + multiplier + rates)
  ├── monthly_sales_data (aggregated revenue rollup)
  ├── work_sessions (per-day check-in/out + counters + evening summary)
  ├── gps_pings (every-5-min track during shift)
  ├── lead_imports (audit of CSV imports)
  ├── leaves (Phase 33G)
  └── ta_payouts (Phase 33H — TA from GPS)

masters (admin)
  ├── cities (rate cards for LED hoardings)
  ├── auto_districts (govt auto-hood districts)
  ├── gsrtc_stations (govt LED stations)
  ├── media_types (Phase 15 — Other Media catalog)
  ├── companies (PRIVATE vs GOVERNMENT entities)
  ├── signers
  ├── attachment_templates
  └── proposal_templates
```

---

## 8 · User journey diagrams

### Sales rep — typical day

```
 09:30   Open app → /work (Today)
         Check in (GPS)
         Glance at AI brief + 5 task slots
         Pick today's plan
         ↓
 10:00   Drive to first meeting
         Open /leads/:id (Mehul Patel) → see history
         ↓
 11:00   At client office
         LogMeetingModal → outcome → save
         WhatsAppPromptModal → templated msg → send
         ↓
 12:00   Back in car → /follow-ups → 4 overdue calls
         Tap each → call → outcome → log
         ↓
 13:00   Lunch + /my-performance check
         ↓
 14:00   More field meetings (same loop)
         ↓
 16:00   At Anand client → quote needed
         Open /quotes/new/private
         "Copy from last quote" → edit → save → send via WhatsApp
         Open /quotes/:id → see IncentiveForecastCard
         ↓
 18:00   Drive back
         ↓
 19:00   Office → /voice/evening → speak summary
         Open /admin/ta-payouts → confirm auto-TA
         Check Out (GPS)
         ↓
 19:30   Scorecard WhatsApp arrives
```

### Telecaller — typical day

```
 09:30   Open app → /telecaller
         See Next Call hero card
         Tap "Call now" (manual phone dial today)
         ↓
 09:32   Log outcome → next call hero refreshes
         Loop ×20-30 per day
         ↓
 11:00   Hot lead → ChangeStage → SalesReady
         Hand off to a sales rep
         ↓
 17:00   Telecaller daily target tracker
         End-of-day summary
```

### Sales Manager — daily check

```
 10:00   Open /lead-dashboard → pipeline overview
         See hero KPIs + 6-stage rail
         ↓
 10:30   Open /team-dashboard → live field view
         Spot rep with low activity → message
         ↓
 14:00   Review SLA breaches on /telecaller (telecaller queue)
         Reassign 2-3 leads via ReassignModal
         ↓
 18:00   Glance at /pending-approvals
         Approve payments + WO uploads
```

### Owner / Co-owner — twice daily

```
 09:00   AI brief WhatsApp lands
         Open /dashboard for KPIs
         ↓
 19:30   Scorecards across team land
         Open /cockpit → review evening summaries
         ↓
 Weekly  /incentives → review staff profiles + liability
         /pending-approvals → approve big-ticket
```

---

## 9 · What's wrong with current UI — concrete list

| # | Page | Issue | Impact |
|---|---|---|---|
| 1 | `/work` | 5-state day machine confusing for new rep | Slow onboarding |
| 2 | `/work` | KPI tiles compete visually with tasks | Distracts from action |
| 3 | `/work` | No "time left in shift" awareness | Reps waste end-of-day time |
| 4 | `/leads` | 5 tabs + filters take 30% of viewport before first row | Less data visible |
| 5 | `/leads` | Each row = 5 chips/dots = info overload | Hard to scan |
| 6 | `/leads` | No visual hierarchy by deal value | ₹5L deal = ₹50K deal visually |
| 7 | `/leads/:id` | Quick action row has 6+ buttons | Visual noise |
| 8 | `/leads/:id` | Inline-edit fields look static | Reps miss editability |
| 9 | `/leads/:id` | Activity timeline buries latest action | Important info lost |
| 10 | `/leads/:id` | "I'm Here" button purpose unclear | Unused |
| 11 | `/leads/new` | Long single-screen form | Reps abandon |
| 12 | `/leads/upload` | Column mapper not obvious how to override defaults | Bad imports |
| 13 | `/quotes` | Status chips drift from /leads pattern | Inconsistency |
| 14 | `/quotes/:id` | 4 tabs + 5 header buttons | Cluttered top |
| 15 | `/quotes/:id` | Status change dropdown buried | Reps don't change status |
| 16 | `/quotes/new/...` | Step indicator looks like separate header | Detached from form |
| 17 | `/quotes/new/...` | Validation errors don't scroll into view | Reps confused on save fail |
| 18 | `/quotes/new/...` | Save Draft not visible enough | Reps think they lose work |
| 19 | `/my-performance` | Score doesn't explain how to improve | Demotivating |
| 20 | `/my-performance` | Base + variable math invisible | Reps don't trust the number |
| 21 | `/voice` confirmation screen | Too many fields to confirm at once | Reps skip voice flow |
| 22 | `/telecaller` | SLA breach pill cryptic ("BREACH") | Telecaller ignores |
| 23 | `/follow-ups` | No quick-filter pills | Long scroll |
| 24 | `/follow-ups` | No "snooze 2 hours" option | Reps mark done falsely |
| 25 | Global | No "Tomorrow" tab next to "Today" on /work | (Partially fixed Phase 34C — count card added) |
| 26 | Global | Cmd+K Co-Pilot invisible to most reps | Phase 34.9 tip added; verify usage |
| 27 | Global | Bottom nav 4 items on mobile — Today/Leads/Quotes/More — More menu hides 5+ items | Discovery problem |
| 28 | Global | No global notification inbox — reps miss push alerts | Push fires but lost |

---

## 10 · UI redesign principles (suggested direction)

Not pixel-level prescriptions — design heuristics for the redesign.

### Visual hierarchy

- **One primary action per screen.** Today's primary is "Log meeting" (mobile) or "Next task" (desktop). Make it the biggest button.
- **Money is sacred.** Quote amounts, incentive deltas, pipeline totals deserve `Space Grotesk` 22-26pt. Other text 13pt.
- **Status colors track tokens.css**. Don't introduce new hues; use `--success` `--warning` `--danger` `--blue` (Phase 34g standardized).

### Information density

- **Mobile = thumb-zone first.** Bottom 1/3 of viewport = primary actions. Top = identity / status.
- **Lead row = 2 lines max.** Line 1: name + company. Line 2: stage chip + last action time + next action date. Drop heat/segment to a single tap.
- **Activity timeline = collapsed by default.** Show latest 3, expand on tap.

### Affordance

- **Inline-edit fields need a pencil icon next to them on hover.** Currently look static.
- **Buttons in the quick-action row should have icon + label**, not icon-only.
- **Step indicator in wizards should be part of form scroll**, not a sticky separate band.

### Feedback

- **Every destructive action = ConfirmDialog (not browser confirm).** Phase 34e shipped this for LeadsV2; extend.
- **Every save = toast.** Phase 34a shipped Toast component.
- **Every async operation = loading state.** Skeleton or spinner.

### Discovery

- **DidYouKnow cards on first visit** to a page. Phase 34.9 planted 4. Add more as features land.
- **Empty states must teach the next action.** "No follow-ups today — go create one" with a button.

### Mobile-first inversions

- `/work` is mobile-first ✓
- `/leads` is desktop-first; mobile uses cards. Consider rebuilding as mobile-first table.
- `/leads/:id` is densest page — needs aggressive collapse / accordion redesign for mobile.
- `/quotes/new/...` wizards are desktop-first. Mobile rendering works but feels heavy.

---

## 11 · Redesign sequence — recommended

### Phase R1 — Quick wins (1 week)

1. Drop 5 chips on /leads row down to 2 (name+company line; stage+age line).
2. Add quick-filter pills on /follow-ups (Overdue · Today · Tomorrow · Week).
3. Show "time left in shift" on /work.
4. Rename "BREACH" pill to "Overdue: X hours" on /telecaller.

### Phase R2 — Form rebuilds (2 weeks)

5. Split `/leads/new` long form into 2-step (Identity → Context).
6. Quote wizard step indicator integrated into form scroll.
7. Save Draft button promoted to top-right (sticky).
8. Inline-edit fields get hover pencil icon.

### Phase R3 — Discovery + density (2 weeks)

9. New bottom nav on mobile: Today · Leads · Quotes · Voice · More (5 items, not 4).
10. Global notification inbox at top bar — collect push alerts.
11. Activity timeline collapsed by default.
12. Quick action row consolidated to 3 icon buttons + overflow menu.

### Phase R4 — High-impact redesigns (3+ weeks)

13. `/leads/:id` complete redesign — mobile-first single-column with accordion.
14. `/quotes/:id` tab consolidation — drop 4 tabs to inline sections.
15. `/my-performance` rebuilt as "what locks my next incentive" with action prompts.
16. `/work` 5-state day machine simplified to 3 (Plan → Active → Done).

---

## 12 · Hand to designer — minimum brief

If you hire a UX designer or use Figma yourself, give them:

1. This document.
2. `UI_DESIGN_SYSTEM.md` (token spec).
3. `tokens.css` + `v2.css` (live tokens).
4. `_design_reference/Leads/` HTML mockups (current visual baseline).
5. Screen recording of Brahmbhatt using the app for 1 day.
6. CLAUDE.md §6 UI build checklist (12 mandatory checks).
7. This priority list:
   - Mobile-first for /work, /leads, /leads/:id, /follow-ups, /voice
   - Desktop-first allowed for /quotes/new/..., /dashboard, /lead-dashboard, /master
   - All status colors from tokens
   - Lucide icons only, stroke 1.6, sizes 14/16/18/22
   - DM Sans body, Space Grotesk numbers, JetBrains Mono for IDs

---

## 13 · Out of scope for redesign

Don't touch these — they're spec-locked or stable:

- Two-segment architecture (GOVERNMENT + PRIVATE)
- 6-stage lead enum (New, Working, QuoteSent, Nurture, Won, Lost)
- IFY (April – March) + lakh/crore formatting
- Ref number formats (`UA/AUTO/2026-27/NNNN` etc.)
- PDF renderer layouts (separate spec)
- AI brief / scorecard / Co-Pilot prompts (separate sprint)
- Auth flow (Login.jsx is V1, stable)

---

**Use this doc as the source of truth for redesign decisions. Edit it as decisions land. Don't let it go stale — append-only updates with dates.**
