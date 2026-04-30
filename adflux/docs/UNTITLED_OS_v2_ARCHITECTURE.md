# UNTITLED OS v2 — Consolidated Architecture (Structure Only)

**Status:** Architectural blueprint, post-consolidation
**Supersedes:** `UNTITLED_OS_ARCHITECTURE.md` v1 (29 Apr 2026), Untitled Proposals README (Phase 1 standalone plan)
**Date:** 30 Apr 2026
**Owner:** Brijesh Solanki — Untitled Advertising, Vadodara

This document defines the *structure* only. Implementation specs (per-sprint task list, exact migration SQL, exact UI changes) come later, sprint by sprint.

---

## 1. Premise

One app. One Supabase. One team experience across both Government and Private segments.

The system today is fragmented:

- **AdFlux** — live in production, ~50 quotes, 1 month old, handles Private only
- **Untitled Proposals** — dev-only, no users, schema complete, built for Government only

This architecture defines the merged system. **AdFlux is the host.** Untitled Proposals is stripped for parts and folded into AdFlux's codebase + Supabase. The standalone Untitled Proposals project is sunset at the end of consolidation.

What this architecture does NOT replace: GoGSTBill (invoice generation), Tally (accounting books), CMS (slot booking), AI cameras (impression data), WhatsApp Business API (messaging transport).

---

## 2. The Two-Axis Data Model

Every quote is defined by two independent fields. Behaviors branch off both.

### 2.1 Segment (Who Pays)

`segment ENUM('GOVERNMENT', 'PRIVATE')` — required, set at quote creation, immutable after WON.

This single field drives:

- Default rate selection: DAVP for Government, Agency for Private
- PO file enforcement: mandatory for Government before status moves to WON
- Invoice template: government long-form (PO + work-order + completion cert + photos) vs private GoGSTBill standard
- Payment terms: 60-day post-completion with TDS for Government; 50% advance + 50% on completion for Private
- Incentive applicability: Private quotes contribute to rep monthly incentive; Government does not by default
- Dashboard segmentation and reporting splits

### 2.2 Media (What's Sold)

`media_type ENUM('LED_OTHER', 'AUTO_HOOD', 'GSRTC_LED', 'HOARDING', 'MALL', 'CINEMA', 'DIGITAL', 'OTHER')` — required.

Drives line-item structure:

- `LED_OTHER` → cities (existing AdFlux flow)
- `AUTO_HOOD` → districts (33 from `auto_districts` master)
- `GSRTC_LED` → stations (20 from `gsrtc_stations` master)
- Other media → free-form line items (extension point, Phase 0+ as needed)

### 2.3 Valid Combinations Matrix

```
GOVERNMENT × AUTO_HOOD     ← cash cow, ₹7-8 Cr/yr      ✓ ALLOWED
GOVERNMENT × GSRTC_LED     ← empanelment pipeline      ✓ ALLOWED
GOVERNMENT × any other     ← NOT ALLOWED (locked decision)

PRIVATE × LED_OTHER        ← AdFlux today, ₹1.2 Cr/yr  ✓ ALLOWED
PRIVATE × GSRTC_LED        ← sleeping giant, 80% empty ✓ ALLOWED
PRIVATE × AUTO_HOOD        ← rare; allow but not promoted ✓ ALLOWED
PRIVATE × HOARDING / MALL / CINEMA / DIGITAL / OTHER   ✓ ALLOWED (supplementary)
```

**Government is locked to AUTO_HOOD and GSRTC_LED only.** No DAVP for hoardings, malls, cinemas, digital, or other media — confirmed by owner. The wizard hides all other media options when GOVERNMENT is selected.

Allowed combinations stored in a `media_segment_validity` config table so future expansions don't need schema changes.

---

## 3. Three-Layer Access Control

Three independent checks per request. Layered, not flat.

### 3.1 Layer 1 — Segment Scope

`segment_access ENUM('PRIVATE', 'GOVERNMENT', 'ALL')` on `users` table.

Applies ONLY to roles `sales` and `telecaller`. All other roles are locked at `ALL`.

| Role | Default segment_access | Notes |
|---|---|---|
| sales | PRIVATE or GOVERNMENT | Mandatory pick at user creation; new Govt hires get GOVERNMENT |
| telecaller | PRIVATE | Currently no Govt telecallers; field future-proofs the model |
| sales_lead | ALL | One lead manages both segments by default (TBD §15) |
| All other roles | ALL | Locked at ALL |

### 3.2 Layer 2 — Operational Visibility

Segment-blind for non-sales roles. Designers, accounts, HR, admin, owner all see ALL operational data (creative jobs, invoices, attendance, leads, follow-ups, campaigns) regardless of segment. They need the full picture to do their job.

### 3.3 Layer 3 — Financial Visibility

Role-gated. Independent of segment.

| Role | Sees revenue? | Sees own incentive? | Sees team incentive? | Sees P&L? |
|---|---|---|---|---|
| owner | All | All | All | All |
| admin | All | All | All | No |
| accounts | All | n/a | All | No |
| sales_lead | Team-level | n/a | Team only | No |
| sales | Own quotes only | Own | No | No |
| telecaller | None | Own conversion bonuses | No | No |
| designer | None | None | None | No |
| hr | None | None | None | No |

P&L is owner-only via standard role check. The TOTP enrollment + audit-log + owner-gated stack from Untitled Proposals is **dropped**. A simpler `audit_log` table records P&L view/edit events for traceability but is not gated.

---

## 4. Role Catalog

```
owner          — Brijesh; full access including P&L + admin expenses
admin          — operational super-user; no P&L
sales_lead     — manages sales reps + telecallers; team revenue, no P&L
sales          — segment-locked; own quotes/clients/incentive only
telecaller     — Private-locked currently; lead qualification + handoff
designer       — creative job queue; no revenue, no segment scope
accounts       — Diya/Mehulbhai: invoices, payments, aging; no P&L
hr             — Riya: attendance, leave, performance, onboarding
```

One user = one role. Role assigned at user creation, changeable by owner only.

`manager_id` on `users` table links sales reps + telecallers to their `sales_lead` for RLS team-scope queries.

---

## 5. Per-Role Home Dashboard

Each role lands on a different page after login. Layout shell (sidebar, top bar) is shared.

| Role | Dashboard Components |
|---|---|
| owner | Today's revenue, pipeline, outstanding, P&L summary, MTD vs target, top-3 alerts, leaderboard |
| admin | Same as owner minus P&L card |
| sales_lead | Team performance, pipeline, conversions, today's standup data, follow-up adherence, team leaderboard |
| sales | Own targets (meetings/leads/calls), own quotes pipeline, own outstanding, own MTD incentive |
| telecaller | Today's lead queue, qualified count, handoff status, reject-reason feedback |
| designer | Creative queue (sorted by deadline), in-progress jobs, revision counters, internal review pending |
| accounts | Invoices pending review, today's collections, aging buckets, GST status |
| hr | Today's attendance, pending leave requests, onboarding tasks, upcoming reviews |

Implementation: route guard reads `role` on login → dispatches to `/dashboard/<role>`.

---

## 6. Sidebar Navigation by Role

Items invisible to a role are NOT rendered (not just disabled).

```
Owner / Admin (full):
  Dashboard, Quotes, Clients, Approvals (admin only),
  Cities, Auto Districts, GSRTC Stations, Rate Masters,
  Team, HR, Renewal Tools, Incentives,
  P&L (owner only), Admin Expenses (owner only),
  Settings

Sales Lead:
  Dashboard, Quotes (team), Clients (team),
  Pipeline, Follow-ups, Renewal Tools, Incentives (team),
  Leaderboard, Settings

Sales:
  Dashboard, My Quotes, My Clients,
  My Follow-ups, My Incentive, Settings

Telecaller:
  Dashboard, Lead Queue, Qualified Leads, Handoff Status, Settings

Designer:
  Dashboard, My Queue, Revisions, Asset Library, Settings

Accounts:
  Dashboard, Invoices, Payments, Aging,
  Receipts, Tally Sync (Phase 3+), Settings

HR:
  Dashboard, Attendance, Leave Requests,
  Performance Reviews, Onboarding, HR Templates,
  Offer Letters, Settings
```

---

## 7. Database Schema (Skeletal)

Source-of-truth tables. Field types abbreviated. RLS policies defined per table (§8).

### 7.1 Identity & Access

```
users  (extends Supabase auth.users)
  id              uuid PK (= auth.users.id)
  email           text
  full_name       text
  role            enum(owner, admin, sales_lead, sales, telecaller, designer, accounts, hr)
  segment_access  enum(PRIVATE, GOVERNMENT, ALL)  default ALL
  manager_id      uuid FK → users (sales/telecaller → sales_lead)
  status          enum(active, suspended)
  created_at      timestamptz

team_members  (employee record extending users for non-auth metadata)
  user_id, employee_id, dept, doj, salary_band, signing_authority bool, ...
```

### 7.2 Master Data

```
cities                    existing AdFlux table; LED_OTHER catalog
auto_districts            33 rows seeded; per-district DAVP + Agency rates
gsrtc_stations            20 rows seeded; per-station DAVP + Agency rates
auto_rate_master          single-row rate config for AUTO media
media_segment_validity    config table; allowed (segment, media) pairs
ref_no_counters           atomic counter per (series, media_code, FY)
```

### 7.3 Quotes (Core)

```
quotes
  id, ref_number          (UA-YYYY-NNNN | UA/AUTO/YYYY-YY/NNNN | UA/GSRTC/YYYY-YY/NNNN)
  segment                 enum(GOVERNMENT, PRIVATE)
  media_type              enum(LED_OTHER, AUTO_HOOD, GSRTC_LED, HOARDING, MALL, CINEMA, DIGITAL, OTHER)
  rate_type               enum(DAVP, AGENCY)   ← derived from segment but stored explicitly
  client_id, contact_id, owner_user_id (sales rep)
  status                  enum(DRAFT, SENT, NEGOTIATING, WON, LOST, EXPIRED, PARTIAL_PAID, PAID)
  subject                 text
  proposal_date           date
  campaign_start, campaign_end  date (set when WON)
  gst_pct, discount_pct   numeric
  subtotal, gst_amt, total      numeric (computed via trigger)
  override_reason         text (mandatory if line-item rate deviates from master)
  po_file_path            text (mandatory for GOVERNMENT before WON)
  po_number               text
  signer_user_id          uuid FK → users
  created_at, updated_at

quote_line_items
  quote_id, line_no
  ref_kind                enum(CITY, DISTRICT, STATION, FREE_TEXT)
  ref_id                  uuid (FK varies by ref_kind)
  description             text (snapshot for FREE_TEXT or override)
  qty, unit_rate, amount  numeric
  rate_type_snapshot      enum(DAVP, AGENCY)  ← immutable after WON

quote_attachments
  id, quote_id, file_path, file_kind (PO, COMPLETION_CERT, PHOTOS, MEDIA_REPORT, OTHER)
  uploaded_by, uploaded_at

quote_versions
  id, quote_id, version_no, snapshot_json, created_at, created_by

quote_followups (existing AdFlux table; reused)
  id, quote_id, scheduled_at, completed_at, notes, created_by
```

### 7.4 Payments / Receipts

```
payments  (existing AdFlux table; enhanced)
  id, quote_id, amount, paid_at, paid_via
  status                  enum(PENDING_APPROVAL, APPROVED, REJECTED)
  approved_by, approved_at
  receipt_ref_number      (UA/REC/{MEDIA}/YYYY-YY/NNNN for Government, NULL for Private)
  tds_pct, tds_amount, net_amount   ← Government deals only
  receipt_pdf_path        text
  created_by, created_at
```

### 7.5 P&L (Simplified — No TOTP)

```
quote_pnl
  quote_id PK
  media_payout_amount         numeric
  production_cost             numeric
  partner_commission_amount   numeric
  other_direct_cost           numeric
  business_profit             numeric  (computed: total – sum(costs))
  margin_pct                  numeric  (computed)
  notes                       text
  updated_by, updated_at

monthly_admin_expenses
  id, fy, month
  expense_type  enum(SALARY, RENT, ELECTRICITY, INTERNET, PHONE, VEHICLE_FUEL,
                    CA_FEES, OFFICE_SUPPLIES, TRAVEL, INSURANCE, SUBSCRIPTIONS,
                    BANK_CHARGES, MARKETING, OTHER)
  amount, notes, recorded_by, recorded_at

audit_log  (basic; insert-only, append-only)
  id, actor_user_id, action, entity_type, entity_id, payload jsonb, occurred_at
```

### 7.6 Sales / Incentive (Existing AdFlux, Scope Filtered)

```
incentive_settings
staff_incentive_profiles
monthly_sales_data
incentive_payouts
  ← all retained as-is; filtered to PRIVATE quotes only by application logic
  ← Government quotes excluded from incentive math by default
```

### 7.7 HR (Existing AdFlux, Retained)

```
hr_offer_templates
hr_offers (with public token-based candidate signing)
```

### 7.8 Module Tables (Phase 1+, Defined in v1 Doc Sections 4.1-4.8)

```
M1: leads, lead_activities, daily_targets, work_sessions, morning_plans, evening_reports
M2: creative_jobs, creative_brief_fields, creative_revisions, creative_time_logs, asset_library
M3 extension: payment_reminders, govt_collection_tracking
M4: campaigns, campaign_screens, campaign_milestones, screen_health
M5: attendance, leave_requests, performance_reviews, onboarding_checklists
M6: campaign_reports, renewal_pipeline, client_satisfaction
```

---

## 8. RLS Policy Architecture

Every table that scopes by user follows the same policy pattern.

### 8.1 Quotes (and tables that derive from quotes)

```
USING (
  -- owner / admin / accounts: full access
  EXISTS (SELECT 1 FROM users
          WHERE id = auth.uid()
          AND role IN ('owner', 'admin', 'accounts'))
  OR
  -- sales_lead: their team's quotes
  EXISTS (SELECT 1 FROM users me
          WHERE me.id = auth.uid()
          AND me.role = 'sales_lead'
          AND quotes.owner_user_id IN (
              SELECT id FROM users WHERE manager_id = me.id
          ))
  OR
  -- sales: own quotes AND segment match
  (
    auth.uid() = quotes.owner_user_id
    AND (SELECT segment_access FROM users WHERE id = auth.uid())
        IN ('ALL', quotes.segment)
  )
)
```

### 8.2 P&L Tables (`quote_pnl`, `monthly_admin_expenses`)

```
USING (
  EXISTS (SELECT 1 FROM users
          WHERE id = auth.uid() AND role = 'owner')
)
```

### 8.3 Operational Tables (Creative Jobs, Attendance, Leads, etc.)

Segment-blind. Owner / admin / sales_lead / accounts / designer / hr see all. Sales reps see only their own where applicable.

```
USING (
  EXISTS (SELECT 1 FROM users
          WHERE id = auth.uid()
          AND role IN ('owner', 'admin', 'sales_lead', 'accounts', 'designer', 'hr'))
  OR auth.uid() = <table>.owner_user_id
)
```

---

## 9. Reference Number System

Atomic per-(series, media_code, FY) counter. Generated at first PDF render, NOT at DRAFT creation.

```
PRIVATE × LED_OTHER         UA-2026-NNNN              ← existing AdFlux format, retained
GOVERNMENT × AUTO_HOOD      UA/AUTO/2026-27/NNNN
GOVERNMENT × GSRTC_LED      UA/GSRTC/2026-27/NNNN
PRIVATE × AUTO_HOOD         UA/AUTO/2026-27/NNNN      ← shared series with govt-auto
PRIVATE × GSRTC_LED         UA/GSRTC/2026-27/NNNN     ← shared series with govt-gsrtc
Other media                 UA-{MEDIA}-2026-NNNN      ← TBD when added

Receipt format:
  UA/REC/{MEDIA}/2026-27/NNNN  (Government only; Private uses payment.id reference)
```

Indian FY: April 1 → March 31. `fy_for_date()` Postgres function returns `'2026-27'` format.

**Existing 50 AdFlux quotes (`UA-2026-NNNN`) are NOT rekeyed.** New quotes from Sprint 2 onward use the new format scheme based on segment + media.

---

## 10. Workflow State Machines

### 10.1 Quote Lifecycle

```
DRAFT
  ↓ (sales sends to client)
SENT
  ↓ (no engagement in N days; cron job)         ↓ (client engages)
EXPIRED                                        NEGOTIATING
                                                 ↓ (client agrees)
                                               WON
                                                 ├── PRIVATE: payments → PARTIAL_PAID → PAID
                                                 └── GOVERNMENT: payments → PARTIAL_PAID → PAID
```

### 10.2 Government-Specific Gates (Triggers)

- `enforce_po_for_won` — blocks `status = 'WON'` UPDATE if `po_file_path IS NULL` or `po_number IS NULL`
- `enforce_attachments_for_invoice_sent` — blocks invoice-sent flag if mandatory attachments not uploaded
- Receipt requires `tds_pct` and `tds_amount` populated

### 10.3 Auto-Triggered Side Effects on WON

- `auto_create_quote_pnl` — creates empty `quote_pnl` row
- Phase 1+ trigger: creates `creative_job` row (M2)
- Phase 1+ trigger: emits invoice draft event to GoGSTBill (M3)
- Updates rep's `monthly_sales_data` (Private only)

### 10.4 Payment Status Auto-Transitions

`recompute_quote_payment_rollup` trigger on `payments` insert/update/delete:

```
sum(approved payments) = 0           → status stays at WON
0 < sum < total                      → status = PARTIAL_PAID
sum >= total                         → status = PAID
```

---

## 11. PDF Architecture

Two paths, retained from existing systems.

### 11.1 In-App (`@react-pdf/renderer`)

- Quote PDF for `PRIVATE × LED_OTHER` (existing AdFlux renderer in `src/utils/`)
- Fonts: Roboto + Lucide icons, embedded
- Storage: Supabase Storage `quote-pdfs/` bucket

### 11.2 Server-Side (Vercel `pdf-api/`, Puppeteer + Chromium)

- Proposal PDF (long-form Government quote with PO + work order + completion cert blocks)
- Receipt voucher PDF (Rule 50 CGST format)
- Settlement reconciliation PDF
- Templates: HTML/CSS in `pdf-templates/` folder
- Fonts: Noto Sans Gujarati for Indian text rendering
- Storage: Supabase Storage `pdf-renders/` bucket

Both paths called from the merged AdFlux app via existing pdf-api endpoints. The pdf-api stays a separate Vercel project.

---

## 12. Folder & Code Organization (Post-Consolidation)

```
adflux/                                     ← merged app, single repo, single deployment
├── ARCHITECTURE.md                         (existing, updated)
├── docs/
│   ├── UNTITLED_OS_v2_ARCHITECTURE.md     ← THIS DOCUMENT
│   ├── UNTITLED_OS_ARCHITECTURE.md        (v1, retained for module specs)
│   └── PHASE2_NOTES.md                     (existing)
├── supabase_*.sql                          (10 existing AdFlux migrations + new merge migrations)
├── src/
│   ├── pages/v2/
│   │   ├── dashboard/
│   │   │   ├── DashboardOwner.jsx
│   │   │   ├── DashboardAdmin.jsx
│   │   │   ├── DashboardSalesLead.jsx     (new)
│   │   │   ├── DashboardSales.jsx
│   │   │   ├── DashboardTelecaller.jsx    (new, M1 phase)
│   │   │   ├── DashboardDesigner.jsx      (new, M2 phase)
│   │   │   ├── DashboardAccounts.jsx
│   │   │   └── DashboardHR.jsx
│   │   ├── quotes/
│   │   │   ├── QuotesList.jsx              (segment-filtered)
│   │   │   ├── QuoteWizard/
│   │   │   │   ├── Step1SegmentMediaClient.jsx   (new — combines segment + media + client + rate)
│   │   │   │   ├── Step2Subject.jsx              (ported)
│   │   │   │   ├── Step3LineItems.jsx            (ported, polymorphic by media)
│   │   │   │   ├── Step4Pricing.jsx              (ported)
│   │   │   │   ├── Step5Signer.jsx               (ported)
│   │   │   │   └── Step6Review.jsx               (ported)
│   │   │   └── QuoteDetail.jsx
│   │   ├── pnl/                            (ported from Proposals, simplified)
│   │   │   ├── PnLLanding.jsx
│   │   │   ├── PnLSummary.jsx
│   │   │   ├── QuotePnL.jsx
│   │   │   └── AdminExpenses.jsx
│   │   ├── masters/                        (ported from Proposals)
│   │   │   ├── AutoDistricts.jsx
│   │   │   ├── GsrtcStations.jsx
│   │   │   └── RateMasters.jsx
│   │   └── ... (existing pages: Clients, Cities, Team, HR, Renewal, Incentives, Settings)
│   ├── components/
│   │   ├── layout/
│   │   │   └── Sidebar.jsx                 (role-filtered)
│   │   └── ... (existing)
│   ├── store/                              (existing Zustand stores + new pnlStore)
│   ├── hooks/
│   └── utils/
│       └── refNumberGenerator.js           (new — handles all formats)
├── pdf-api/                                ← separate Vercel project, retained
│   ├── api/
│   │   ├── render-quote.js
│   │   ├── render-proposal.js              (ported)
│   │   ├── render-receipt.js               (ported)
│   │   └── cron-expire-quotes.js           (ported, renamed from cron-expire-proposals)
│   └── pdf-templates/                      (HTML/CSS templates)
└── (Untitled Proposals/ folder DELETED at end of consolidation)
```

---

## 13. Phase 0 — Consolidation Plan (6-8 Weeks, Single Dev)

### Sprint 1 (1-2 weeks) — Schema & Access

- Add `segment`, `media_type`, `rate_type` columns to `quotes`
- Add `segment_access`, `manager_id` columns to `users`
- Port `auto_districts`, `gsrtc_stations`, `auto_rate_master`, `media_segment_validity`
- Update `ref_no_counters` to handle new formats; add `next_ref_number()` function
- Update RLS policies on `quotes`, `payments`, `quote_followups` for layered access
- Backfill existing 50 AdFlux quotes: `segment = 'PRIVATE'`, `media_type = 'LED_OTHER'`, `rate_type = 'AGENCY'`

### Sprint 2 (2 weeks) — Wizard Port

- Port 6-step proposal wizard into AdFlux quote flow
- Conditional line-item picker by `media_type`
- PO file upload UI + Government enforcement trigger
- Role-filtered sidebar implementation
- Per-role dashboard routing

### Sprint 3 (1 week) — P&L Module Port (Simplified)

- Port `quote_pnl`, `monthly_admin_expenses` schema
- Port PnLLanding, PnLSummary, QuotePnL, AdminExpenses pages
- Drop TOTP / audit-gate / co-owner role complexity
- Owner-only role check on RLS

### Sprint 4 (1 week) — Receipts Upgrade

- Add TDS fields to `payments`
- Port receipt voucher PDF endpoint to pdf-api
- Port receipt ref-number generator (`UA/REC/{MEDIA}/YYYY-YY/NNNN`)

### Sprint 5 (1 week) — Cleanup

- Delete `Untitled Proposals/` folder from repo
- Sunset Untitled Proposals Supabase project (or freeze)
- Update `ARCHITECTURE.md` to reflect merged state
- Team training session

---

## 14. Phase 1+ — Untitled OS Modules (Months 3-12)

Per existing `UNTITLED_OS_ARCHITECTURE.md` v1 sections 4.1-4.8 and 10.1-10.4. Phase 1 starts AFTER Phase 0 ships.

```
Phase 1 (months 3-5):  M1 activity layer + M2 creative briefs + M3 invoice automation + M8 cockpit v1
Phase 2 (months 6-8):  M1 leads + M7 telecaller handoff + M3 payment chase + M6 reporting + M4 campaign ops
Phase 3 (months 9-11): M3 government workflow + M5 HR + M4 screen health + M6 satisfaction
Phase 4 (months 12+):  M2 asset library + M8 cockpit v2 + multi-city readiness
```

Module specs unchanged from v1.

---

## 15. Open Decisions

To confirm before Sprint 1 starts:

1. **Sales Lead segment scope.** Default: ALL (one lead over both Private + Government reps). Confirm or override.
2. **`manager_id` assignment for sales reps.** RLS team-scope queries depend on each sales rep / telecaller having `manager_id` set to their `sales_lead`. Confirm this assignment happens at user creation.
3. **Existing quote ref format.** ✓ Confirmed: lock 50 existing `UA-2026-NNNN` quotes; new format applies to new quotes only.
4. **Live payments during merge.** ✓ Confirmed: AdFlux production runs on `main`; consolidation lives on `untitled-os` branch.
5. **Build resource.** Brijesh + Claude do the build, sprint by sprint; each sprint approved before next starts.
6. **Govt × non-Auto/non-GSRTC media.** ✓ Confirmed: NOT ALLOWED. Government is locked to AUTO_HOOD + GSRTC_LED only.
7. **Sales Lead role hire timing.** Per v1 architecture §9.4, formalize at Month 3. Until then, Brijesh acts as Sales Lead — `manager_id` for all sales reps points to Brijesh's `users.id`.

---

## 16. What This Architecture Does NOT Cover

Deliberately excluded, retained from v1 architecture §14:

- LED inventory yield management (parked)
- Multi-city operational expansion
- Vendor / procurement automation
- Stock image / video subscriptions
- Voice-call recording / IVR
- Client self-service portal
- Recruitment ATS
- Payroll computation
- Statutory compliance (PF, ESI, gratuity)
- DAVP-LED empanelment (your personal project)
- Strategic diversification away from agency client

---

*End of structural architecture v2.*
