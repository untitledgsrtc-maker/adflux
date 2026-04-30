# Untitled Proposals — Database Schema

Phase 1 database foundation. Standalone Supabase project. Run migrations in order.

## Stack

Exactly mirrors Adflux:
- React 18 + Vite + React Router v6
- Zustand (minimal store)
- React Hook Form + Zod
- Supabase (Postgres + Auth + Realtime + RLS)
- Plain CSS with `.up-*` prefix
- Space Grotesk (display) + DM Sans (body)
- Dark theme with Adflux design tokens
- `@react-pdf/renderer` (with Gujarati font test harness before committing)
- date-fns, Lucide React, Radix UI, Vercel deployment

## How to run

1. Create a new Supabase project (separate from Adflux)
2. Copy `.env.example` → `.env` with your project URL + anon key
3. Open Supabase SQL Editor
4. Run the migration files **in order**:

```
001_core_tables.sql       → users, team, clients, contacts, media types + helpers
002_masters.sql           → GSRTC stations, Auto districts, rate masters (DUAL model)
003_proposals.sql         → proposals, line items, attachments, versions, followups
004_receipts.sql          → proposal_receipts + payment rollup triggers
005_pnl_and_audit.sql     → order_pnl (owner-only) + access log + audit log
006_rls_policies.sql      → all RLS (run LAST among schema files)
007_seed_data.sql         → 20 stations, 33 districts, Auto rate, media types
```

## Database summary

**18 tables:**

Core (5): `users`, `team_members`, `clients`, `client_contacts`, `media_types`
Masters (3): `gsrtc_stations`, `auto_districts`, `auto_rate_master`
Proposals (6): `proposals`, `proposal_line_items`, `proposal_attachments`, `proposal_versions`, `proposal_followups`, `ref_no_counters`
Payments (1): `proposal_receipts`
P&L (2): `order_pnl`, `pnl_access_log`
System (1): `audit_log`

**42 RLS policies.** Key invariants:
- Users see own proposals; admins see all
- Only owners access P&L (hidden at API level; 404 not 403)
- P&L access log: insert-only, never edit/delete
- Audit log: insert-only, never edit/delete
- Receipts delete requires owner role (not just admin)

## Dual rate model (DAVP + Agency)

- GSRTC stations have both `davp_per_slot_rate` and `agency_monthly_rate`
- Auto rate master has both `davp_per_rickshaw_rate` and `agency_per_rickshaw_rate`
- Proposal records `rate_type` enum: 'DAVP' or 'AGENCY'
- Default: government client → DAVP, private client → AGENCY (app logic)
- User can override per proposal
- Line items snapshot the rate at creation (immutable after)

## Triggers worth knowing about

1. **`enforce_po_for_won`** — blocks moving proposal to WON status without PO fields + file
2. **`auto_create_pnl_on_won`** — creates empty `order_pnl` row when proposal hits WON
3. **`recompute_proposal_payment_rollup`** — on receipt insert/update/delete, recalculates proposal payment totals and auto-transitions status (WON → PARTIAL_PAID → PAID)
4. **`recompute_pnl_profit`** — auto-calculates dept_expense_amount from %, total cost, profit, and margin %
5. **`update_proposal_followup_rollup`** — on new followup, updates proposal's next_followup_date and count

## Ref number format

- Proposals: `UA/AUTO/2026-27/0001`, `UA/GSRTC/2026-27/0001`
- Receipts: `UA/REC/AUTO/2026-27/0001`, `UA/REC/GSRTC/2026-27/0001`
- Atomic counter per (series, media, FY) via `next_ref_number()` function
- Ref generated only on first PDF generation (not at DRAFT creation)

## Financial year handling

- Indian FY: April 1 to March 31
- App layer computes current FY string (e.g. "2026-27") when needed
- Counters auto-initialize for new FY on first use (no explicit rollover needed)

## What's NOT in this phase

Deliberately deferred to Phase 2:
- Attachments library with versioning UI (Phase 1 uses filename convention)
- Full audit log viewer UI
- CSV import for clients
- Advanced reports

Deferred to Phase 3 (Adflux merge):
- SSO between projects
- Shared clients table sync
- WhatsApp / email send from proposal
- Client portal

## Design foundation (for the React app — next step)

CSS prefix: **`.up-*`**
CSS tokens: copy Adflux's `:root` block exactly (dark theme, yellow CTA, Space Grotesk + DM Sans)
Breakpoints: desktop-first. Responsive single file for Dashboard and Follow-ups list. Separate files NOT needed for proposal wizard or P&L (desktop only).

## Next deliverable

Frontend scaffolding:
1. `package.json` + `vite.config.js` + `.env.example`
2. `src/lib/supabase.js` client
3. `src/store/authStore.js` + `src/store/pnlStore.js`
4. `src/styles/tokens.css` (Adflux design tokens)
5. Login screen + role-based sidebar (matches your Adflux layout)
6. Gujarati PDF font test harness (verifies `@react-pdf/renderer` before committing)

Then screen by screen: Clients → Masters → Proposal wizard → Receipts → P&L.
