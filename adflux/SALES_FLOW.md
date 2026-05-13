# Sales Flow — Lead Journey, End to End

**Purpose:** describe exactly what happens to a lead from the moment it's created to the moment money lands in the bank — every state change, every automation, every notification — so the owner can flag anything to change.

**Date:** 2026-05-13 (after Phase 34A–I)
**Audience:** Brijesh (read this end-to-end, mark anything you want different)

This document complements `SALES_MODULE_STRUCTURE.md`:
- **STRUCTURE doc** = screens (where things live)
- **FLOW doc** = process (when things happen)

---

## 1 · Lead lifecycle — the 6 stages

A lead moves through these stages. Each stage has rules about what comes next.

```
   ┌────────┐
   │  NEW   │   ← Lead just created. No rep contact yet.
   └───┬────┘
       │ Rep makes first contact (call / WhatsApp / meeting)
       ▼
   ┌─────────┐
   │ WORKING │   ← Rep is actively talking to this lead.
   └───┬─────┘
       │
       ├─── Sends a quote ────►  ┌────────────┐
       │                         │ QUOTE SENT │
       │                         └──┬────┬────┘
       │                            │    │
       │   Client says yes ─────────┘    │    Client says no
       │   ▼                             ▼
       │ ┌─────┐                      ┌──────┐
       │ │ WON │                      │ LOST │
       │ └─────┘                      └──────┘
       │
       │ Client says "call back in 2 months"
       ▼
   ┌─────────┐
   │ NURTURE │   ← Parked. Has a revisit_date. System wakes it up later.
   └─────────┘
       │
       └─── revisit_date arrives ──► back to WORKING (system pushes)
```

### What each stage means in plain English

| Stage | Who controls it | What it means |
|---|---|---|
| **New** | System (default for any insert) | Lead exists in pipeline. Nobody has called yet. |
| **Working** | Rep (after first contact) | Active deal. Rep is talking, sending follow-ups. |
| **QuoteSent** | System (auto when quote saved) | Quote is in client's hands. Waiting on decision. |
| **Nurture** | Rep (when client asks for later) | Parked with a `revisit_date`. System surfaces it when date arrives. |
| **Won** | Rep (after WonPaymentModal) | Deal closed. Campaign starts. Counts toward incentive. |
| **Lost** | Rep (with mandatory `lost_reason`) | Deal dead. Goes to lost-reasons report. |

Owner can change this list — add a stage, remove a stage, rename a stage. Each change touches DB enum + triggers + UI tabs.

---

## 2 · Where leads come from

Five sources today. Each has its own entry path.

### A · Field meeting (cold walk-in)

```
Rep on field → enters shop → tap /work "Log Meet" → fills mini-form →
LogMeetingModal saves → LEAD CREATED (stage=Working OR Lost based on outcome) +
ACTIVITY ROW (meeting, with GPS).
```

**Phone-first dedup (Phase 34.10):** as rep types phone, system checks for existing match. If found, the rep is told upfront — the meeting becomes a follow-up activity on the existing lead, not a new lead.

### B · Cold call (telecaller / sales)

```
Rep dials a number → speaks → opens lead /leads/:id (or creates new at /leads/new) →
Log Activity → call → outcome → save.
```

No auto-log on hang-up today (item 1 of audit — needs iOS native). Rep must remember to log.

### C · Cronberry CSV import (admin)

```
Admin gets CSV from Cronberry (overnight inbound enquiries) →
/leads/upload → maps columns → import →
50 leads inserted with stage=New OR stage from parsed Remarks →
auto-assigned by round-robin (Phase 34 SQL — least-loaded rep in matching segment).
```

**Background magic:** each inserted lead gets:
1. **Auto-assignment** (Phase 34) — picks least-loaded rep in same segment.
2. **Auto-followup** (Phase 33D.4) — schedules a 10 AM follow-up for tomorrow.
3. **Push notification** to assigned rep (Phase 33W).
4. **Cadence engine** (Phase 33D.6) — queues 6 follow-ups across day 1, 3, 5, 8, 12, 17.

### D · Inbound (manual entry)

```
Rep tells admin "Mr. Patel called from Anand" → /leads/new form →
fills name + phone + segment → save → same automation as Cronberry imports.
```

### E · From existing client (renewal)

```
On /quotes/:id (a Won quote) → "Create Renewal" button →
opens quote wizard with renewalOf=<id> → pre-fills client + cities →
new lead NOT created (uses existing client + lead reference).
```

---

## 3 · From lead to quote — the conversion flow

This is the **money-making path**. Read it carefully.

```
Lead in stage Working
      ↓
Rep clicks "Convert to Quote" on /leads/:id
      ↓
Router checks: lead.segment === 'GOVERNMENT' ?
      │
      ├── YES → /quotes/new/government → wizard chooser →
      │         Auto Hood OR GSRTC LED wizard
      │         (3 steps: quantity/months → districts/stations → review)
      │
      └── NO  → /quotes/new/private → wizard chooser →
                Private LED (4 steps) OR Other Media (4 steps)
      ↓
Wizard step 1: client info (pre-filled from lead — phone, name, company)
      ↓
"Copy from your last quote" button (Phase 34E) — pre-fills cities + rates
      ↓
Step 2-3: cities + rates + duration
      ↓
Step 4: review + GST + Grand Total + "Amount in Words" (Phase 34.8)
      ↓
Click Save Draft OR Send
      ↓
Quote ROW inserted (quotes table)
Quote_cities ROWS inserted (line items)
      ↓
TRIGGER: lead.stage flips to QuoteSent
        lead.quote_id pinned to new quote
        new follow_ups row created (day 2, 5, 9 cadence)
        client row synced (syncClientFromQuote)
      ↓
If Send: PDF generated → uploaded to storage → shortened URL →
        WhatsApp opened with pre-built message + link
```

### Three PDF renderers (chosen by segment + media_type)

| Renderer | When | Output |
|---|---|---|
| `QuotePDF` (`@react-pdf/renderer`) | Private LED | 4-page PDF with GSRTC reach numbers |
| `OtherMediaQuotePDF` (`html2canvas` + `jsPDF`) | Private Other Media | ENIL-style #44 single page |
| `GovtProposalRenderer` (HTML→browser print) | Govt segment | Gujarati cover letter + district/station list |

All three now include "Amount in Words" (Phase 34.8 — except Gujarati renderer which needs a Gujarati number-to-words helper, owner judgment call).

---

## 4 · Quote → Won → money

```
Quote stage = sent or negotiating
      ↓
Client says YES (verbal or written)
      ↓
Rep opens /quotes/:id → clicks "Mark Won" button
      ↓
WonPaymentModal opens — 4 required fields:
  • Campaign start date
  • Campaign end date
  • Work Order (PO copy) — upload PDF/image attachment
  • Payment received (optional — can be partial)
      ↓
Click Confirm Won
      ↓
quote.status flips to 'won'
quote.campaign_start_date + end_date saved
PAYMENT ROW inserted (if amount entered)
      ↓
TRIGGER: monthly_sales_data rolled up for the rep
        client.total_won_amount bumped
        ACTIVITY row added to lead timeline (status_change Won)
        push notification to admin (Phase 33W)
        follow_ups for payment collection auto-created (Phase 33G.7)
      ↓
Incentive math:
  • If quote crossed slab threshold → first incentive ₹ unlocked
  • If quote crossed target (5× monthly salary) → +₹10,000 flat bonus
  • Performance score bumped (Phase 33E)
      ↓
At end of month: incentive auto-computed → /incentives admin approves payout
```

### Incentive math (in plain English)

For each rep:

```
target       = monthly_salary × 5     (e.g. ₹35,000 × 5 = ₹1,75,000)
threshold    = monthly_salary × 2     (e.g. ₹35,000 × 2 = ₹70,000)
```

- **Below threshold** (revenue < ₹70K) → ₹0 incentive
- **Above threshold** → 5% on new-client revenue + 2% on renewal revenue
- **Above target** (₹1.75L+) → +₹10,000 flat bonus

Phase 34D (Incentive Forecaster card on quote detail) shows the rep exactly how much closing THIS quote bumps their incentive. Pre-Won.

---

## 5 · Background automation — the "magic" reps don't see

Triggers + cron jobs that fire silently. Owner should know what's running.

### On lead INSERT (any source)

| Trigger | What it does | Phase |
|---|---|---|
| `trg_leads_auto_assign` | If `assigned_to` is blank → round-robin pick rep matching segment | 34 |
| `trg_lead_auto_followup` | Inserts a `follow_ups` row for tomorrow 10 AM | 33D.4 |
| Push notification | Notifies assigned rep on their device | 33W |

### On lead_activities INSERT (call/meeting/note)

| Trigger | What it does | Phase |
|---|---|---|
| Counter bump | `leads.contact_attempts_count++` + `last_contact_at = now()` | 12 |
| **Soft auto-Lost** | After 3 non-positive attempts → sets `auto_lost_suggested=true` (was hard-flip to Lost before Phase 34B) | 34B |
| `trg_lead_activity_sync_followup` | If activity has `next_action_date` → upserts the lead's open follow_up to that date | 34 |
| **Work session counter** | Bumps `work_sessions.meetings_count` / `.calls_count` for today | 12 |

### On lead UPDATE (stage change)

| Trigger | What it does | Phase |
|---|---|---|
| `lead_set_handoff_sla` | When stage moves `New → Working`, sets `handoff_sla_due_at` = next IST business day + 24h | 34 (rewired from broken Phase 12) |
| Push notification (reassign) | Notifies new owner | 33W |

### On quote INSERT

| Trigger | What it does | Phase |
|---|---|---|
| `quote_number_seq` | Auto-generates `UA-2026-NNNN` (private) or `UA/AUTO/2026-27/NNNN` (auto-hood) | 4d |
| Lead stage advance | If quote has `lead_id` → flips lead to `QuoteSent` | 14 |
| Cadence follow-ups | Inserts 3 follow_ups: day 2, 5, 9 | 33D.6 |
| Client sync | `syncClientFromQuote('create')` upserts the clients row | 12 |

### On payment INSERT / Won flip

| Trigger | What it does | Phase |
|---|---|---|
| Monthly rollup | Aggregates revenue into `monthly_sales_data` for incentive calc | 12 |
| Client total bump | `client.total_won_amount += quote.total_amount` (non-positive→positive only) | 11 |
| Payment-collection follow-ups | Inserts `follow_ups` for chasing balance payment | 33G.7 |
| Performance score | Daily score recalculated for the rep | 33E |

### Cron jobs (Supabase Edge Functions)

| Job | Time | What |
|---|---|---|
| `daily-brief` | 9:00 AM IST | WhatsApp brief to owner: overnight imports, SLA breaches, hot leads, yesterday collections |
| `daily-brief` | 7:30 PM IST | Same brief — end-of-day version |
| `scorecard` | 7:30 PM IST | Per-rep WhatsApp scorecard: today's counters vs targets, team rank, one tip |
| `generate_lead_tasks` | continuous (on demand) | Smart Task Engine populates `lead_tasks` for `/work` |

---

## 6 · SLA + escalation rules

When a lead aging matters.

### Hand-off SLA (telecaller → sales)

```
Telecaller marks lead stage = Working (handoff)
      ↓
TRIGGER: leads.handoff_sla_due_at = next_business_moment(now() + 24h IST)
      ↓
If sales rep doesn't log activity within SLA → /telecaller shows BREACH pill
      ↓
Admin sees breach on /lead-dashboard hero card
```

Phase 34 fixed the SLA to be IST + business-day aware (rolls past Sundays + holidays).

### Stale lead (no contact 30+ days)

```
TRIGGER: every lead with last_contact_at older than 30 days
      ↓
Banner on /leads/:id: "Last contact 32 days ago"
Banner on /lead-dashboard: "Hot idle: 12 leads"
```

### Soft auto-Lost (3 attempts, no positive outcome) — Phase 34B

```
3 non-positive activities logged
      ↓
TRIGGER: leads.auto_lost_suggested = true (stage stays Working)
      ↓
Banner on /leads/:id: "System suggests marking Lost"
[Mark Lost] [Dismiss]
```

Rep decides. Previously the system auto-flipped — was killing warm leads that just needed a different time.

### Overdue follow-up (>3 days past due)

```
Daily 9 AM IST cron fires `notify-rep` Edge Function
      ↓
Push notification to rep: "X follow-ups overdue 3+ days"
```

---

## 7 · Role + permission cheat sheet

Who can do what.

| Action | sales | telecaller | sales_manager | admin | co_owner |
|---|---|---|---|---|---|
| View own leads | ✓ | ✓ | ✓ | ✓ | ✓ |
| View team leads | — | — | ✓ (their team) | ✓ | ✓ |
| Create lead | ✓ | ✓ | ✓ | ✓ | ✓ |
| Bulk import CSV | — | — | — | ✓ | ✓ |
| Change own lead's stage | ✓ | ✓ | ✓ | ✓ | ✓ |
| Reassign lead | — | — | ✓ | ✓ | ✓ |
| Delete lead | — | — | — | ✓ | ✓ |
| Create quote | ✓ | — | ✓ | ✓ | ✓ |
| Govt quote (Auto-Hood / GSRTC) | — *(unless segment=GOVT)* | — | ✓ | ✓ | ✓ |
| Mark Won + record payment | ✓ | — | ✓ | ✓ | ✓ |
| Approve payment | — | — | — | ✓ | ✓ |
| Manage incentive profiles | — | — | — | ✓ | ✓ |
| See P&L | — | — | — | — | ✓ |
| Master CRUD (cities, signers, etc.) | — | — | — | ✓ | ✓ |
| AI Co-Pilot Cmd+K | ✓ | ✓ | ✓ | ✓ | ✓ |

---

## 8 · End-to-end timeline (real example)

Mehul Patel (private healthcare, Vadodara) — typical 3-week deal.

```
Day 0  09:30  Lead created via Cronberry overnight import (source=cronberry)
              → auto-assigned to Brahmbhatt (round-robin)
              → follow_up scheduled tomorrow 10:00 AM
              → push notification sent to Brahmbhatt's phone

Day 0  10:30  Brahmbhatt sees lead on /work briefing
              → calls Mehul → not interested today, asks to call back Friday
              → logs activity: type=call, outcome=neutral, next_action=Day 4

Day 0  10:31  TRIGGER: lead_activity_sync_followup
              → existing follow_up updated to Day 4 (Friday)
              → lead.last_contact_at = now()
              → lead.contact_attempts_count = 1

Day 4  09:35  Brahmbhatt's /work shows follow_up due Mehul
              → calls → Mehul interested, wants quote → meeting Day 6

Day 6  14:00  Brahmbhatt drives to Mehul's clinic, Lalbaug Vadodara
              → /work "Log Meet" → outcome=Interested
              → modal phone-first dedup: "Already in pipeline: Mehul Patel" → confirms
              → activity logged: type=meeting, outcome=positive, GPS=Lalbaug

Day 6  14:30  Lead stage manually changed: Working
              → handoff_sla_due_at set (not used here, already in Working)

Day 7  11:00  Brahmbhatt opens /quotes/new/private (lead_id passed in)
              → "Copy from last quote" → fills 3 cities (Vadodara, Anand, Surat)
              → reviews → Sends → WhatsApp opens with PDF link
              → Quote ₹3,50,000 saved

Day 7  11:01  TRIGGER: createQuote in useQuotes.js
              → lead.stage flips to QuoteSent
              → lead.quote_id pinned
              → 3 follow_ups created (day +2, +5, +9)
              → client row synced
              → WhatsApp prompt with templated message

Day 9  10:00  Follow-up Mehul → not picking up → activity outcome=neutral

Day 12 10:00  Follow-up Mehul → speaks, asks 15% discount → next_action=Day 15

Day 15 14:00  Brahmbhatt meets Mehul → negotiates 8% discount → Mehul agrees
              → quote.status manually changed to negotiating

Day 16 11:00  Brahmbhatt opens quote → clicks "Mark Won"
              → WonPaymentModal:
                  campaign_start = Day 21
                  campaign_end   = Day 51
                  WO uploaded (PDF of client's purchase order)
                  payment ₹1,75,000 received (50% advance)
              → Confirm

Day 16 11:02  TRIGGER: status flip + payment INSERT
              → quote.status = 'won'
              → monthly_sales_data.new_client_revenue += ₹3,50,000
              → client.total_won_amount += ₹3,50,000
              → 2 payment-collection follow_ups created for balance ₹1,75,000
              → Brahmbhatt's incentive: +₹17,500 forecast (was 0 before)
              → push to admin: "Quote 3.5L won by Brahmbhatt"
              → activity timeline gets status_change Won row

Day 21        Campaign starts
              → balance ₹1,75,000 follow_ups fire on the rep's /work

Day 28        Balance paid → quote becomes PARTIAL_PAID → PAID (derived)
              → incentive fully recognized end-of-month
              → /my-performance updates

Day 30        Brahmbhatt's monthly scorecard arrives 7:30 PM WhatsApp
              → "₹4.8L closed · target hit · incentive ₹24,000 projected"
```

---

## 9 · Things owner can ask to change

Each row = a decision lever. Tell me which to change.

| # | Current behaviour | Common alternatives |
|---|---|---|
| 1 | Stage list = 6 (New, Working, QuoteSent, Nurture, Won, Lost) | Add: Qualified, MeetingScheduled, Proposal, Contract |
| 2 | Auto-followup day +1 at 10:00 AM | Different time, OR no auto-followup, OR rep picks at lead-create |
| 3 | Cadence: day 1, 3, 5, 8, 12, 17 for new leads | Tighter (1, 2, 3, 5), or looser (3, 7, 14, 30) |
| 4 | Soft auto-Lost after 3 non-positive attempts | More attempts (5/7), or different outcome trigger |
| 5 | Hand-off SLA = 24 IST business hours | 12h / 48h / segment-specific |
| 6 | 3 follow-ups after quote sent (day 2, 5, 9) | Different cadence, more touches |
| 7 | Round-robin = least loaded in segment | Manual only, or specific weighting (skill / win-rate) |
| 8 | Incentive = 5% new + 2% renewal, ₹10K bonus at target | Different rates, tiered slabs, team bonus |
| 9 | Cronberry 90-day cutoff (stale leads auto-marked Lost) | 30 / 60 / 180 days, or never cut |
| 10 | Govt quotes locked to AUTO_HOOD + GSRTC_LED | Add more govt media types (mall, cinema, etc.) — requires DAVP approval |
| 11 | Auto-Hood proposal table now has Months column (Phase 34H) | Different layout, more rows, custom breakdown |
| 12 | TA payout = DA + bike + hotel from GPS pings | Different formula, per-city ceilings, mileage-only mode |
| 13 | Scorecard WhatsApp at 7:30 PM | Different time, or in-app only |
| 14 | Daily brief WhatsApp at 9 AM + 7:30 PM | Once a day, or 3× daily |
| 15 | Won payment requires WO upload + campaign dates | Skip WO for sub-₹50K deals, or always require |
| 16 | Lead delete = admin only (RLS) | Allow sales for own leads, or never delete |
| 17 | Push notifications: new lead, reassign, payment, won, overdue FU | Add: client birthday, anniversary, contract renewal due |
| 18 | Activity types: call, whatsapp, email, meeting, site_visit, note, status_change | Add: presentation, demo, proposal_review |
| 19 | Heat: cold / warm / hot (3 levels) | Add levels, or auto-compute from engagement |
| 20 | Lost reasons: Price, Timing, Competitor, NoNeed, NoResponse, WrongContact, Stale | Add: BudgetGone, RestructuredAccount, etc. |

---

## 10 · Where to start

If you want to change something, **don't change 20 things at once**. Pick the top 3 friction points:

1. **Easiest wins (today's cost = 0 design, just SQL/UI tweak):**
   - SLA hours (item 5)
   - Cadence days (items 3, 6)
   - Cronberry cutoff (item 9)
   - Auto-followup time (item 2)
   - Lost reasons / activity types (items 18, 20)

2. **Medium (1-3 days):**
   - Stage list change (item 1) — touches enum + UI tabs + triggers
   - Round-robin weighting (item 7) — replaces RPC
   - Incentive math (item 8) — replaces calculateIncentive

3. **Hard (1-2 weeks):**
   - New govt media types (item 10) — needs DAVP master + new wizard
   - Custom proposal layouts (item 11) — new renderer

---

**Read it. Mark anything you want changed. Reply with item numbers from §9 + new value.**

Example: `change item 3 → cadence 2,5,10,20 days. change item 5 → SLA 12h instead of 24h.`
