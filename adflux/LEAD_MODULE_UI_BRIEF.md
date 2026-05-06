# LEAD MODULE — UI DESIGN BRIEF

This is the complete surface of the Lead module as it exists in code today (Phase 12 + 14 + 15 rev2). Give this to your design Claude as input. It includes every screen, every field, every action, every state, every role-gated variation, every empty / loading / error state, and the cross-screen flows.

Brand tokens to use (from `src/styles/tokens.css`):
- **Yellow (brand):** `#FFE600` — primary CTA, accent strip, badges
- **Yellow ink:** `#0f172a` — text on yellow
- **Bg:** `#0f172a` (Night, default) / `#f4f5f8` (Day)
- **Surface:** `#1e293b` (Night) / `#ffffff` (Day)
- **Surface-2:** `#334155` (hover) / `#f8f9fc` (Day)
- **Text:** `#f1f5f9` / `text-muted #94a3b8` / `text-subtle #64748b`
- **Status:** Success `#10B981`, Warning `#F59E0B`, Danger `#EF4444`, Blue `#3B82F6`
- **Fonts:** Body **DM Sans / Inter**, Display **Space Grotesk** (numbers + headings), Mono **JetBrains Mono** (IDs, currency, ages)
- **Radius:** 6 (inputs) / 8 (small tiles) / 9 (chips, avatars) / 12 (banners) / 14 (cards) / 16 (hero) / 999 (pills)
- **Icons:** `lucide-react` only, stroke 1.6, sizes 14 / 16 / 18 / 22

---

## 0 · MODULE MAP

| Screen | Route | Mobile / Desktop | Primary user |
|---|---|---|---|
| Lead list | `/leads` | desktop-first (scrolls on mobile) | admin, sales, telecaller, agency |
| Manual create | `/leads/new` | desktop-first | admin, sales, telecaller |
| Bulk import | `/leads/upload` | desktop-first | admin, co_owner |
| Lead detail | `/leads/:id` | desktop-first | role-aware |
| Daily rep flow | `/work` | **mobile-first** | sales, agency, telecaller |
| Telecaller dashboard | `/telecaller` | desktop-first | telecaller |

Cross-cutting: lead → quote conversion routes into one of the 4 quote wizards (Auto Hood, GSRTC LED, Private LED, Other Media) carrying `lead_id`.

---

## 1 · DATA MODEL (plain English)

A **Lead** is a person or company you might sell to.

Every lead has:
- **Identity:** name, company (optional), phone, email, city
- **Classification:** segment (Government or Private), industry, source (where you got them — IndiaMart, Justdial, Cronberry WABA, Excel Upload, Manual, Referral, Walk-in, Website, Other)
- **Money:** expected_value (₹ pipeline)
- **Temperature:** heat = hot / warm / cold
- **Stage** (10): New → Contacted → Qualified → SalesReady → MeetingScheduled → QuoteSent → Negotiating → Won / Lost / Nurture
- **Ownership:** assigned_to (sales rep) and telecaller_id (inside-sales)
- **Linkage:** quote_id (filled after Convert to Quote)
- **Lifecycle stamps:** qualified_at, sales_ready_at, handoff_sla_due_at (= sales_ready_at + 24h), contact_attempts_count, last_contact_at, lost_reason (only if Lost), nurture_revisit_date (only if Nurture, max 90 days out)
- **Notes:** free text + a separate notes_legacy_telecaller for Cronberry-imported notes

A **Lead Activity** is anything you did to or with a lead. Type ∈ {call, whatsapp, email, meeting, site_visit, note, status_change}. Carries an outcome (positive / neutral / negative / null), notes, next_action + date, GPS lat/lng/accuracy if captured. Triggers automatically: bumps contact_attempts_count, bumps daily counters, auto-flips lead to Lost if 3+ no-positive contact attempts.

A **Work Session** is one rep's day. Keys on (user_id, work_date) so there's exactly one row per rep per day. Carries: morning plan_submitted_at, planned meetings (jsonb array), planned_calls, planned_leads, focus_area, check_in_at + GPS, check_out_at + GPS, evening_report_submitted_at, evening_summary jsonb, daily_counters jsonb (auto-incremented {meetings, calls, new_leads}), is_off_day flag.

A **Call Log** is one phone call. Keys: user_id, lead_id (nullable), client_id (nullable), client_phone, call_at, duration_seconds, outcome (∈ connected, no_answer, busy, wrong_number, callback_requested, not_interested, sales_ready, already_client), notes, next_action + date, recording_url (future).

---

## 2 · /leads — LIST VIEW

**Purpose:** see leads, filter, search, jump to detail, bulk reassign.

**Page header:** title "Leads", subtitle "Pipeline across all sources", primary yellow CTA "+ New Lead", secondary ghost "Upload CSV" (admin only).

**Stat strip — 4 cards, full width row:**
1. Total Leads (count)
2. Open (count of stages New, Contacted, Nurture)
3. Qualified (count of Qualified, SalesReady, MeetingScheduled)
4. Won (count + win-rate % vs Won+Lost)

Numbers in Space Grotesk 22px, label in 11px uppercase eyebrow.

**Filter row — 6 controls in a single horizontal scroll-on-mobile bar:**
1. Search input (icon Search, placeholder "Name, company, phone, email")
2. Stage group tabs: All · Open · Qualified · In Progress · Won · Lost (pill-style)
3. Segment dropdown: All · Government · Private
4. Source dropdown: 9 sources (see §1)
5. City dropdown (populated from leads' distinct city values)
6. Assigned-to dropdown (only for admin / sales_manager)

**Table — desktop:**
| Checkbox | Heat dot | Name + company | Phone | Stage chip | Segment chip | Source | Assigned | Last contact | Expected value |
|---|---|---|---|---|---|---|---|---|---|

- Heat dot: 8×8 circle, hot=red, warm=amber, cold=text-subtle
- Stage chip: tint + text per stage (New=blue, Contacted=blue, Qualified=amber, SalesReady=amber pulsing, MeetingScheduled=amber, QuoteSent=amber, Negotiating=amber, Won=green, Lost=red, Nurture=purple)
- Segment chip: Govt=accent-soft yellow, Private=blue-soft
- Last contact: relative time ("2d ago"), JetBrains Mono
- Expected value: ₹ in lakh/crore Indian numbering, JetBrains Mono
- Hover row → surface-2, click → /leads/:id

**Mobile fallback:** stacked card list. Each card shows the same 10 fields but as a 2-column mini-grid inside the card.

**Bulk action bar (appears when ≥1 row checked):**
- Floating bottom bar (mobile) or sticky top bar (desktop)
- Shows "{n} selected"
- Buttons: "Reassign", "Export CSV", "Cancel"
- Reassign opens a modal — dropdown of active reps + Confirm

**States:**
- **Empty (no leads):** centered illustration + "No leads yet" + "Add your first lead" CTA + "or import from CSV" link
- **Empty (filter no match):** "No leads match these filters" + "Clear filters" link
- **Loading:** skeleton rows (8 ghost rows)
- **Error:** red banner top of page + retry

**Role view differences:**
- **admin / co_owner:** sees all leads, can pick assigned filter
- **sales / agency:** sees only their own (RLS), no assigned filter
- **telecaller:** sees their own + leads they own; sees a "Pending hand-offs" subsection at top (count of SalesReady leads they qualified)
- **govt_partner:** sees only Government segment

---

## 3 · /leads/new — MANUAL CREATE FORM

**Purpose:** capture a new lead in 30 seconds.

**Layout:** single-column card, max-width 720px, centered.

**Sections:**

**A. Identity (mandatory marked *)**
- Name * (text)
- Company (text)
- Phone (text, India format hint)
- Email (email)
- City (text)

**B. Classification**
- Source * (dropdown — 9 options)
- Segment * (radio: Government / Private)
- Industry (text)

**C. Money & temperature**
- Expected value (₹ number input, lakh/crore hint)
- Heat (3-button toggle: Hot / Warm / Cold, default Cold)

**D. Ownership (role-aware defaults)**
- Assigned to (dropdown of active sales/agency reps)
  - Default: self if user is sales/agency; empty for admin
  - Hidden for telecaller (auto-stays empty)
- Telecaller (dropdown of active telecallers)
  - Default: self if user is telecaller; empty for admin/sales

**E. Notes**
- Notes (textarea, 3 rows)

**Submit row:** "Save Lead" yellow CTA + "Cancel" ghost.

**On submit:**
- Insert row, set created_by = current user
- Navigate to `/leads/{new_id}` if "Save & open" was clicked, else back to `/leads`

**Validation:**
- Inline field errors in red `--danger` text under each field
- Submit button disabled until name + source + segment filled

**States:** loading spinner on submit, error banner on failure.

---

## 4 · /leads/upload — BULK CSV IMPORT (admin / co_owner only)

**Purpose:** import Cronberry / Excel exports.

**Layout:** wizard-feel single page, max-width 880px.

**Step strip at top:** Pick file → Preview → Map columns → Import.

**Step 1 — Pick file:**
- Drag-and-drop zone (dashed border, accent on hover) + browse button
- Accepts .csv, .xlsx
- Below: "Cronberry export tip" callout (info banner) explaining the Remarks-format expected

**Step 2 — Preview:**
- File name + row count
- Table preview (first 10 rows, all columns auto-detected)

**Step 3 — Map columns:**
- Auto-mapped fields shown as green chips ("Mapped from `Mobile`")
- Unmapped fields with dropdown to select source column
- Settings card:
  - "Default segment" (Govt / Private radio) — required
  - "Default source" (dropdown, default Cronberry WABA)
  - "Stale cutoff (days)" (number input, default 90)
  - "Mark stale as Lost" (toggle, default on)

**Step 4 — Import:**
- Big yellow CTA "Import {N} leads"
- Live progress bar during batch insert
- Results: ✓ X imported · ✗ Y skipped (with reasons)
- Each lead also gets one initial `note` activity carrying the raw Remarks text
- Stage classified by keyword: "interested" → Qualified, "send quote" → Qualified, "callback" → Nurture, "closed" → Won, "spoke" → Contacted, default New
- Telecaller name parsed from Remarks regex `(.+) :- (.+) (TelecallerName)$`, mapped case-insensitive to `users.name` → `telecaller_id`

**States:** mid-upload progress bar with cancel; error rows shown inline with reason.

---

## 5 · /leads/:id — LEAD DETAIL

**Purpose:** the rep's working surface for one lead.

**Layout:** 12-column desktop, single-column mobile.

**Top bar:** ← Back to leads · Lead name · primary actions row.

**Primary actions row** (right-aligned, sticky on scroll):
- "+ Call" (logs call activity)
- "+ Meeting" (logs meeting activity)
- "+ Note" (logs note activity)
- "+ WhatsApp" (logs whatsapp activity + opens wa.me)
- "Change Stage" (yellow CTA — opens stage modal)
- "Convert to Quote" (yellow CTA — only when stage = Qualified or SalesReady)

**Header card (col-span 12):**
- Lead name (Space Grotesk 22px)
- Company name (16px text-muted)
- Stage chip + Heat dot + Segment chip in a row
- Sub-row: Source · Assigned to: {rep name + city} · Telecaller: {name} · Last contact: {relative}
- Right side: Expected value big number ₹ (Space Grotesk 22px, JetBrains Mono digits) + edit pencil

**Two columns below:**

**LEFT (8 cols) — Activity timeline**
- Vertical timeline, newest first
- Each row: 28×28 colored icon tile + bold action title + outcome badge + relative time + creator avatar
- Body line: notes
- Footer line: "Next: {next_action} · {next_action_date}" if set
- Tiny GPS pill if gps_lat/lng captured ("📍 23.0225, 72.5714")
- 7 activity types map to icons: call=Phone, whatsapp=MessageCircle, email=Mail, meeting=Calendar, site_visit=MapPin, note=Edit3, status_change=RefreshCw
- Outcome chip: positive=green-soft, neutral=text-subtle, negative=red-soft
- Empty: "No activity yet — start with a call or note"
- Below timeline: "Load older activities" link if >50 rows

**RIGHT (4 cols) — Detail panel**
- "Lead details" card with all editable fields:
  - Name, Company, Phone, Email, City, Industry, Expected value, Heat, Notes
  - Inline-edit pattern (click → input → blur to save)
- "Ownership" card:
  - Assigned to (dropdown — admin / sales_manager only)
  - Telecaller (dropdown — admin / sales_manager / telecaller-self only)
- "Linked quote" card (only if `quote_id` set):
  - Quote number + status + total
  - "Open quote" link → /quotes/:id
- "Stage history" card:
  - Compact list of status_change activities (qualified at, sales_ready at, lost at, etc.)

**Modals:**

### 5a. Log Activity modal
- Title: "Log {Call / Meeting / Note / WhatsApp / Email / Site visit}"
- Activity type (read-only chip if pre-set, else dropdown)
- Outcome radio: Positive · Neutral · Negative (skip for note/status_change)
- Notes textarea (rows=3)
- Next action input + date picker (optional row)
- GPS auto-captured silently if granted
- For "Call": duration_seconds optional (mm:ss input)
- Submit: yellow CTA "Save activity"
- Side effects (silent): contact_attempts_count++, daily_counters++, last_contact_at updated, auto-Lost if attempts ≥3 with no positive

### 5b. Change Stage modal
- Title: "Move stage"
- Current stage shown at top
- Target stage dropdown (10 options)
- **Conditional fields by target stage:**
  - **Lost:** lost_reason dropdown (Price / Timing / Competitor / NoNeed / NoResponse / WrongContact / Stale) — required
  - **Nurture:** nurture_revisit_date date picker — required, max 90 days out
  - **SalesReady:** 4-field qualification checklist:
    - "Budget confirmed?" checkbox
    - "Timeline confirmed?" checkbox
    - "Decision-maker contact" text
    - "Service interest" text
    - "Hand off to (sales rep)" dropdown — sets `assigned_to`
- Note textarea (optional — appended to status_change activity)
- Submit: yellow CTA "Move to {stage}"
- Side effects: writes a status_change activity, sets qualified_at / sales_ready_at as relevant, sets handoff_sla_due_at = sales_ready_at + 24h

### 5c. Reassign modal (admin / sales_manager only)
- Pick rep from dropdown of active sales/agency/sales_manager users
- Optional reason textarea
- Submit → updates `assigned_to`, writes status_change activity

**Convert to Quote button:**
- Routes to `/quotes/new/government` (if segment=GOVERNMENT) or `/quotes/new/private` (if segment=PRIVATE) — chooser screen lets the rep pick Auto Hood / GSRTC LED for Govt, or LED Cities / Other Media for Private
- Forwards in router state: client_name, client_company, client_phone, client_email, client_notes, **lead_id**
- Wizard, on insert, persists lead_id and updates lead → stage='QuoteSent', quote_id=new

**States:**
- Loading: skeleton header + 5 ghost timeline rows
- Error: red banner with retry
- Lead not found: 404 card with "Back to leads"

---

## 6 · /work — REP DAILY MOBILE FLOW (mobile-first)

**Purpose:** sales rep's morning plan → check-in → working day → evening report → check-out.

**Layout:** single column 440px max width, centered, big tap targets ≥44px.

**State machine — page renders one of these states based on today's `work_sessions` row:**

### State A — Before Morning Plan
**Header:** date + greeting "Good morning, {name}".
**Card 1: Today's plan**
- "Planned meetings" — 5 editable slots, each row = client (text) + time (time picker) + location (text) + delete icon. "Add another" ghost link below.
- "Calls planned" — number stepper (default 20)
- "New leads target" — number stepper (default 10)
- "Focus area" — single-line text
**CTA:** "Submit plan" yellow full-width.

### State B — Plan submitted, waiting for check-in
**Card:** plan summary (read-only, with "Edit" link)
**CTA:** "Check in" yellow full-width with location icon.
- On tap: capture GPS (silent fail with toast if denied, save check_in_at without coords)
- Posts check_in_at + GPS

### State C — Active day (checked in)
**Top: live counters strip** — Meetings · Calls · New leads, big Space Grotesk numbers vs targets ("3 / 5 meetings"). Auto-incremented from triggers.
**Quick actions row** (4 icon tiles):
- "Log call" → opens /leads picker → activity modal
- "Log meeting" → opens /leads picker → activity modal
- "+ New lead" → /leads/new
- "Open my leads" → /leads (filtered to me)
**Today's planned meetings list** — each meeting from morning plan, with:
- client name + time + location
- status pill: "upcoming" / "done" / "skipped"
- "Mark done" button — opens activity modal pre-filled
**Mid-day "Evening report" card** (visible after 5pm or on-demand):
- "Quotes sent today" number stepper
- "Blockers" textarea
- "Tomorrow's focus" text
**CTA at bottom:** "Submit evening report" yellow.

### State D — Evening report done, waiting for check-out
**Card:** day summary (counters + report)
**CTA:** "Check out" yellow with location icon, captures GPS.

### State E — Day complete
**Card:** "Day done." Summary of counters vs targets. Subtle "View report" link.

**Off-days:** holiday or weekend → render an "Off day" card with "Override (clock in anyway)" link.

**States:** loading skeleton, error toast if GPS or save fails (lead can still continue without GPS).

---

## 7 · /telecaller — TELECALLER DASHBOARD

**Purpose:** telecaller's call queue + 24h hand-off SLA tracking.

**Layout:** desktop-first, 2-col main split.

**Top: Hero "Next call" card (full width)**
- Highest-heat + oldest-contact lead from queue
- Big avatar circle + heat dot
- Lead name (Space Grotesk 22px) + company below
- Phone number + city + source
- Last contact relative
- 2 buttons: "Call now" (`tel:` link, yellow CTA) + "Open lead" (ghost)

**KPI strip (4 cards, full width row below hero):**
1. Today's calls (count from call_logs where user_id=self and call_at::date=today)
2. Qualified today (leads where qualified_at >= today)
3. Open queue (count of self's leads with stage NOT in Won/Lost/SalesReady/QuoteSent/Negotiating/MeetingScheduled)
4. Pending hand-offs (count of self's leads at stage=SalesReady awaiting sales rep action)

**Pending hand-offs section (left col, 8 cols):**
- Section title with eyebrow + count
- List of SalesReady leads — each card:
  - Lead name + company
  - Sales rep assigned + city
  - SLA badge: green if `handoff_sla_due_at` >6h away, amber 0-6h, red overdue
  - "View" link → /leads/:id
- Empty: "No pending hand-offs"

**Full call queue (right col, 4 cols, OR full-width below on smaller screens):**
- Section title "Queue" + count
- Sortable mini-table:
  - heat dot · name+phone · stage chip · source · last contact
- Sorted by heat (hot first) then last_contact_at (oldest first), limit 50
- Click row → /leads/:id
- Empty: "Queue empty — nice"

**States:** skeleton hero + KPI cards + queue rows on load.

---

## 8 · CROSS-CUTTING ELEMENTS (use everywhere)

**Stage chip palette:**
| Stage | Tint | Text color |
|---|---|---|
| New | blue-soft | blue |
| Contacted | blue-soft | blue |
| Qualified | amber-soft | amber |
| SalesReady | amber-soft + pulsing dot | amber |
| MeetingScheduled | amber-soft | amber |
| QuoteSent | amber-soft | amber |
| Negotiating | amber-soft | amber |
| Won | green-soft | green |
| Lost | red-soft | red |
| Nurture | purple-soft | purple |

Pulse animation on the SalesReady dot (keyframes `pulse` from spec §4.17).

**Heat dot:** 8×8 circle. hot=`--danger`, warm=`--warning`, cold=`--text-subtle`.

**Outcome chip (on activities):** positive=green-soft, neutral=text-subtle, negative=red-soft.

**Source pill:** small surface-2 pill, no color — neutral.

**Avatar:** 28×28 circle, 11px Space Grotesk 600 initials. 6 rotating color schemes by `userId.charCodeAt(0) % 6 + 1`.

**SLA badge (telecaller):**
- Green: hours_left > 6, label "{n}h left"
- Amber: 0 < hours_left ≤ 6, label "{n}h left"
- Red: hours_left ≤ 0, label "Overdue {n}h"

**Empty state pattern:** centered illustration (lucide icon at 28px, text-subtle) + bold one-liner + sub-line + primary CTA.

**Loading state pattern:** skeleton with subtle pulse animation on cards/rows.

**Error state pattern:** red-soft banner at top of section with retry icon button.

---

## 9 · LEAD LIFECYCLE STATE CHART

```
              ┌─────┐
              │ New │ (created — manual / import / API)
              └──┬──┘
                 │ first contact attempt
                 ▼
            ┌─────────┐
            │Contacted│
            └──┬──────┘
               │ shows interest
               ▼
           ┌────────┐
           │Qualified│ (stamps qualified_at)
           └──┬──────┘
              │ telecaller sets BANT + assigns rep
              ▼
        ┌────────────┐
        │ SalesReady │ (stamps sales_ready_at, sets handoff_sla_due_at = +24h)
        └──┬─────────┘
           │ sales rep books appointment
           ▼
   ┌────────────────────┐
   │ MeetingScheduled   │
   └──┬─────────────────┘
      │ rep sends quote (Convert to Quote)
      ▼
  ┌──────────┐
  │QuoteSent │ (stamps quote_id, syncs from quote save)
  └──┬───────┘
     │ negotiation
     ▼
 ┌────────────┐    won   ┌────┐
 │Negotiating ├─────────►│Won │
 └────────────┘          └────┘
        │
        │ lost
        ▼
     ┌────┐
     │Lost│ (stamps lost_reason)
     └────┘

Anywhere → Nurture (stamps nurture_revisit_date, max 90d out)

Auto-rules:
- 3+ contact attempts without a positive outcome → auto Lost (lost_reason='NoResponse')
- Cronberry import row > stale-cutoff days old → auto Lost (lost_reason='Stale')
```

---

## 10 · WHAT'S NOT BUILT YET (future phases)

These are NOT in code today — design space if you want them:
- Follow-up reminder system (auto-WhatsApp / push when next_action_date hits)
- Lead scoring (auto-heat from contact attempts × time × source quality)
- Duplicate detection on create (phone match)
- Lead sharing / collaboration (multiple owners)
- Lead-level attachment uploads (rep notes with photos)
- Mobile native call-tracking (recording_url is a column but no integration yet)

If you want any of these in the v2 design, design them once and we slot them in when phase budget allows.

---

## 11 · ROLE GATE SUMMARY

| Action | admin | co_owner | sales_manager | sales | agency | telecaller | govt_partner |
|---|---|---|---|---|---|---|---|
| See all leads | ✅ | ✅ | own team only | own only | own only | own + telecalled | Govt segment only |
| Create lead | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (Govt only) |
| Upload CSV | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Reassign | ✅ | ✅ | own team only | own only | own only | ❌ | own only |
| Bulk reassign | ✅ | ✅ | own team only | ❌ | ❌ | ❌ | own only |
| Convert to Quote | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ (must hand-off) | ✅ (Govt only) |
| Stage modal — SalesReady | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| See /telecaller | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| See /work as their day | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |

---

## 12 · NUMBERS / FORMATS

- Currency: `₹{Indian-grouped number}` (12,21,300 not 1,221,300). Use `formatCurrency()` from `src/utils/formatters.js`.
- Numbers in words (for PDFs only): "Twelve Lakh Twenty-One Thousand Three Hundred Rupees Only" — `rupeesToWords()` in `src/utils/numberToWords.js`.
- Dates: "DD MMM YYYY" body, "DD MMM" in tight rows. Relative ("2d ago") for last_contact and timeline.
- Phone: as-stored, no formatting in tables; tel: links wrap with `+91` prefix if missing.

---

This brief is the source for the lead module UI redesign. Match the design tokens above. If the design needs a token that isn't here, add it to `tokens.css` first, then use it.
