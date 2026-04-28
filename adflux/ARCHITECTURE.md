# Adflux — Architecture Reference

LED-advertising sales-and-payment management for Untitled Advertising. Built so a small sales team can quote, send, follow up, collect, and have payouts auto-computed; admin can audit and approve.

This document is the structural reference: stack, routes, database, state model, business rules, directory layout, and the migration order. Read it before changing anything that touches money or roles.

---

## 1. Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | React 18 + Vite | Fast dev loop, no SSR needed |
| Routing | react-router-dom v6 | Standard SPA, nested protected routes |
| State | Zustand | Lightweight stores per domain; no Redux ceremony |
| Forms | react-hook-form + zod | Wizard step validation |
| UI primitives | Radix + lucide-react icons | Accessible, unstyled — we own the look |
| Styling | Plain CSS, scoped via class prefixes (`.v2-`, `.v2d-`, `.ccr-`) | No CSS-in-JS, no Tailwind compiler |
| Backend | Supabase (Postgres + Auth + Storage + RLS) | DB, auth, file storage in one product |
| PDF | `@react-pdf/renderer` | Quote PDFs + offer letters generated client-side |
| Hosting | Vercel | Static deploy + env-var secrets |
| Fonts | Space Grotesk (display) + DM Sans (body) — Google Fonts; Roboto local TTFs for PDFs | Match the dark-yellow brand |

---

## 2. User roles

Two roles live in `public.users.role`:

- **admin** — sees everything. Approves payments, manages cities/team/HR/incentives, can edit any quote.
- **sales** — sees only their own quotes/payments/clients (RLS-enforced). Creates quotes, records payments (which land as `pending` until admin approves).

Role check in DB: `get_my_role()` SECURITY DEFINER function reads `users.role` for `auth.uid()`. RLS policies branch on this.

Auth flow: Supabase Auth email/password → on login, `useAuth.js` reads the matching `public.users` row to surface role + name. JWT tokens carry the user id; everything else is RLS lookups.

---

## 3. Routes

Defined in `src/App.jsx`. Public:

- `/login` — Supabase Auth email/password
- `/offer/:token` — public HR offer landing page (candidate signs without an account)

Authenticated (any role):

- `/` → redirects to `/dashboard`
- `/dashboard` → `DashboardV2` switcher → renders `AdminDashboardDesktop` for admin, `SalesDashboardDesktop`/`SalesDashboard` (responsive) for sales
- `/quotes` — list view (admin sees all + rep filter; sales sees own)
- `/quotes/new` — `CreateQuoteV2` wizard
- `/quotes/:id` — `QuoteDetail` (status changes, payments, follow-ups)
- `/clients` — CRM view (admin sees all + rep filter; sales sees own)
- `/my-performance` — `MyPerformanceV2` (rep's incentive progress + history)
- `/my-offer` — current sales rep's accepted HR offer
- `/renewal-tools` — list of campaigns expiring soon

Admin-only:

- `/cities` — LED city catalog (rates, offered prices, photos)
- `/team` — staff management
- `/incentives` — staff incentive profiles + payout records
- `/pending-approvals` — payment approval queue
- `/hr` — offer templates + offer issuance

Wildcard `*` → redirects to `/`.

`v2/V2AppShell.jsx` renders the sidebar + topbar chrome around every authenticated route. Pages render only the body.

---

## 4. Database schema

Tables (all in `public`):

| Table | Purpose |
| --- | --- |
| `users` | role, name, email — mirrors `auth.users` |
| `cities` | LED location catalog: name, daily rate, offered rate, photo |
| `quotes` | one row per quote; status, amounts, denormalized `client_*` snapshot |
| `quote_cities` | line items — quote × city × duration × seconds-per-day |
| `payments` | partial + final payments per quote, with admin approval workflow |
| `clients` | CRM layer over quotes (one row per phone-per-rep), tracks lifetime totals |
| `staff_incentive_profiles` | per-rep monthly_salary, multiplier, rates, flat bonus |
| `monthly_sales_data` | aggregate revenue per rep per month — read-mostly, updated by triggers |
| `incentive_settings` | one-row global defaults for rates and bonus |
| `incentive_payouts` | record of admin-issued payouts |
| `follow_ups` | scheduled reminders |
| `hr_offer_templates`, `hr_offers` | HR offer letter system |

Key invariants:

- Every quote has a denormalized `client_*` snapshot. Editing a `clients` row never rewrites past quotes.
- `monthly_sales_data` is **derived**, not source-of-truth. It's rebuilt by `rebuild_monthly_sales(staff_id, month_year)` from approved final payments.
- Quote status enum: `draft` → `sent` → `negotiating` → `won` | `lost`. Won → lost allowed only if no final payment cleared.
- Payment approval enum: `pending` → `approved` | `rejected`. Sales inserts always land `pending`; admin inserts land `approved` directly.

### Triggers (`supabase_phase3c.sql`)

- `handle_payment_insert` — on `INSERT payments`: if `is_final_payment=true AND approval_status='approved'`, calls `rebuild_monthly_sales`.
- `handle_payment_update` — on `UPDATE payments`: re-runs the rebuild for both old and new staff/month if approval state or final flag changed.
- `handle_payment_delete` — on `DELETE`: rebuilds the affected month if the deleted row was approved + final.

The triggers are the single mechanism that credits `monthly_sales_data`. Nothing else writes to it.

### RLS policies (high level)

- `users` — everyone reads, admin writes
- `cities` — everyone reads, admin writes
- `quotes` — admin reads/writes all; sales reads/writes their own (`created_by = auth.uid()`)
- `payments` — admin reads/writes all; sales can insert their own quote's payments as `pending`, can edit/delete only still-pending rows
- `staff_incentive_profiles`, `monthly_sales_data` — admin reads all, sales reads own. **This is what makes the leaderboard need a SECURITY DEFINER RPC** (see §6).
- `clients` — admin reads/writes all; sales reads/writes own (`created_by = auth.uid()`)

### Server-side functions

- `rebuild_monthly_sales(staff_id, month_year)` — sums approved final-payment subtotals into the aggregate row.
- `handle_payment_insert/update/delete` — trigger functions (above).
- `dismiss_payment_notification(payment_id)` — lets a sales rep clear their rejection banner via SECURITY DEFINER (RLS would block direct update on a rejected row).
- `get_team_leaderboard(month_keys text[])` — SECURITY DEFINER aggregator that bypasses per-user RLS so the team leaderboard can compute per-rep proposed/earned for every rep, returning aggregates only (no raw rows leak).
- `generate_quote_number()` — race-free quote number generator (UA-YYYY-NNNN).
- `auto_create_followup`, `auto_create_incentive_profile` — convenience triggers on quote/user inserts.

---

## 5. Migration order

Apply these in order in the Supabase SQL Editor for a fresh project:

1. `supabase_schema.sql` — base tables, original triggers, RLS skeleton
2. `phase2_additions.sql` — schema additions (whatever phase 2 wired in)
3. `supabase_quote_number_fix.sql` — race-free quote number
4. `supabase_storage_quote_pdfs.sql` — Storage bucket for quote PDFs
5. `supabase_gst_rate.sql` — per-quote GST rate column
6. `supabase_clients_module.sql` — clients table + RLS + sync triggers
7. `supabase_slot_metadata.sql` — slot_seconds + slots_per_day on `quote_cities`
8. `supabase_hr_module.sql` — HR offer templates + offers + offer-letter storage
9. `supabase_phase3c.sql` — payment approval workflow + ledger triggers
10. `supabase_phase3d.sql` — `get_team_leaderboard` RPC

Each is idempotent (drops and recreates policies/triggers/functions). Safe to re-run.

---

## 6. State + data flow

### Frontend stores (Zustand) — `src/store/`

- `authStore` — current user + profile (role, name, id). Set on login, cleared on logout.
- `quoteStore` — list of quotes for the current view, filters, pagination state.
- `cityStore` — city catalog cache.
- `teamStore` — sales user list (admin only).
- `incentiveStore` — settings + profiles + monthly sales data.

Stores never hit Supabase directly — that's done in hooks under `src/hooks/`.

### Hooks — `src/hooks/`

| Hook | What it does |
| --- | --- |
| `useAuth` | Supabase auth subscription + profile join |
| `useQuotes` | CRUD on quotes, status transitions, client-snapshot sync |
| `usePayments` | CRUD on payments per quote; auto-flips quote to won when sum ≥ total |
| `useFollowUps` | Reminder list + mark-done |
| `useTeam` | Admin team page CRUD |
| `useCities` | Admin cities page CRUD |
| `useIncentive` | Settings + profiles + monthly sales for `/incentives` and My Performance |
| `useOffers` | HR offer templates + offers; token-based public offer flow |
| `useIsDesktop` | Window-width breakpoint for the responsive dashboard switcher |

### Data flow for a typical action

Creating a quote:
1. Sales fills the wizard (`CreateQuoteV2` → `WizardShell` + steps).
2. `useQuotes.createQuote` inserts into `quotes`, then `quote_cities` line items.
3. `syncClientFromQuote(quote, 'create')` upserts a `clients` row.
4. RLS scopes future reads to this rep.

Marking a quote Won (sales path with payment):
1. `QuoteDetail` opens `WonPaymentModal`.
2. On confirm, `usePayments.addPayment` inserts a row with `approval_status='pending'`.
3. Quote status stays the same — admin must approve the payment.
4. Admin opens `/pending-approvals` → `approvePayment` flips approval_status to `approved` AND updates the quote status to `won`.
5. Trigger `handle_payment_insert` (or update) fires `rebuild_monthly_sales` since the payment is now `approved`+`final`.
6. `monthly_sales_data` row updates → My Performance and admin Incentives pick it up on next load.

Marking a quote Won (admin path or sales-no-payment path):
- Admin's `addPayment` lands directly as `approved`.
- Sales-with-no-payment skips the modal's payment block entirely; quote flips to won immediately, but no monthly_sales_data credit until a final approved payment lands.

---

## 7. Business rules

### Incentive math (`src/utils/incentiveCalc.js`)

Per rep per month:

```
threshold = monthly_salary * 2          # below this = no incentive
target    = monthly_salary * multiplier # default 5x
total_revenue = new_client_revenue + renewal_revenue

if total_revenue < threshold: incentive = 0
else if total_revenue < target:
    incentive = (new_client_rev * new_rate) + (renewal_rev * renewal_rate)  # default 5% / 2%
else: # ≥ target
    incentive = (above scaled rate calc) + flat_bonus  # default ₹10,000
```

Same formula runs for **Earned** (using only `monthly_sales_data`) and **Proposed** (using msd + open pipeline subtotals + won-unsettled subtotals). Two calls into `calculateIncentive`, two numbers shown side by side on the leaderboard, My Performance, and admin Incentives.

### Settlement (`src/utils/settlement.js`)

A quote is "settled" when sum of approved payments ≥ `total_amount` OR any payment has `is_final_payment=true`. The settle date is the date of the clearing payment. `buildSettlementMap(quotes, payments)` returns `Map<quoteId, {settledAt, finalPaymentDate}>`.

The leaderboard buckets revenue by **settled** month, not won month, so a quote closed in April but paid in June counts toward June.

### Won-unsettled forecast

A "won" quote without a final approved payment sits in the rep's forecast until either:
- The final payment clears (moves to Earned)
- The rep flips it to Lost via the won → lost transition (allowed only when no final payment exists)

This stops won quotes from inflating forecast forever.

### Age pills

Won-unsettled quotes get an age tag based on `updated_at` (the won timestamp):
- **Fresh** < 30 days (blue)
- **Aging** 30–60 days (amber)
- **Stale** 60+ days (rose)
- **Settled** = final payment cleared (green)

Admin sees a Stale Won Quotes panel listing all 60+ day stale rows for manual chase-or-cleanup.

### Period filter

`src/utils/period.js` produces a normalized `{ startIso, endIso, monthKeys, label }` object from a picker selection (this month / last month / custom range). All admin and sales dashboards consume the same shape, so numbers reconcile across views.

---

## 8. Directory layout

```
adflux/
├── ARCHITECTURE.md          ← this file
├── package.json
├── vite.config.js
├── supabase_*.sql           ← migrations (apply in order, see §5)
├── public/
└── src/
    ├── App.jsx              ← routes
    ├── lib/supabase.js      ← Supabase client init
    ├── store/               ← Zustand stores per domain
    ├── hooks/               ← Supabase calls + business logic
    ├── utils/               ← pure functions (math, formatters, period, settlement)
    ├── pages/               ← legacy v1 pages (still imported in places)
    │   └── v2/              ← current production pages
    ├── components/
    │   ├── v2/              ← V2AppShell, PeriodPicker
    │   ├── dashboard/       ← shared dashboard widgets (legacy)
    │   ├── quotes/          ← QuotePDF, QuoteWizard, status chip
    │   ├── payments/        ← PaymentModal, PaymentHistory
    │   ├── followups/
    │   ├── incentives/      ← IncentiveDashboard, StaffTable, MyPerformance
    │   ├── team/, cities/, hr/, layout/
    └── styles/              ← v2.css, dashboard.css, etc.
```

V1 pages (`src/pages/*.jsx`) still exist for legacy URLs but the active app uses `src/pages/v2/*`. The route table redirects v1 paths to v2 components.

---

## 9. PDF generation

`src/components/quotes/QuotePDF.jsx` builds the quote PDF in the browser using `@react-pdf/renderer`. Key bits:

- Loads Roboto TTF locally so the PDF doesn't depend on a web-font fetch.
- Pre-fetches city photo URLs into base64 data URLs (`urlToDataUrl`) before rendering — `@react-pdf` fails silently on cross-origin images otherwise.
- Saves to Supabase Storage bucket `quote-pdfs` (`uploadQuotePDF`) so WhatsApp share can include a public link.

HR offer letters (`src/components/hr/OfferLetterPDF.jsx`) follow the same pattern.

---

## 10. WhatsApp share

`src/utils/whatsapp.js` builds a `wa.me/<phone>?text=...` link with a TinyURL-shortened version of the public PDF URL. Sales taps a button on `QuoteDetail`, the file uploads to Storage, the link is shortened, and WhatsApp opens with the prefilled message. If upload fails (RLS, bucket missing), the message is sent without a link and the PDF downloads locally for manual attach.

---

## 11. Deploy

- **Vercel** — pushes to `main` auto-deploy
- Env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (set in Vercel project settings)
- Local dev: copy `.env.example` to `.env`, fill in the same two values, `npm run dev`

---

## 12. Things to know before changing money-related code

- **Don't write to `monthly_sales_data` from the frontend.** Only the DB triggers do that. The frontend reads it.
- **Don't loosen the `is_final_payment + approval_status='approved'` gate** unless you also want to change "incentive credits only on full payment" — that's the explicit business rule.
- **Don't bypass the WonPaymentModal sales-vs-admin branch.** Sales payments must land `pending`; if you flip the quote to won at the same time, admin will see Won quotes with un-approved payments and the trust collapses.
- **The leaderboard RPC is the only way to read other reps' aggregates.** Don't try to broaden RLS on `staff_incentive_profiles` or `monthly_sales_data` without thinking about salary leakage.
- **Won → lost is allowed only when no final payment exists** (`getAllowedTransitions` in `QuoteDetail.jsx`). Bypassing this orphans approved revenue against a "lost" quote — `rebuild_monthly_sales` doesn't filter on quote status, so the credit would still count.

---

## 13. Open architectural debt

- V1 pages still in tree. Some routes (`/v2/*`) duplicate `/` routes; cleanup pending.
- The `flat_bonus` defaulting fallback in JS (`profile.flat_bonus ?? settings.default_flat_bonus ?? settings.flat_bonus ?? 10000`) tries a column (`incentive_settings.flat_bonus`) that doesn't exist. Frontend works because the missing column resolves to `undefined` and falls through to the literal `10000`. SQL functions can't do that — see `supabase_phase3d.sql` for what the corrected fallback looks like.
- Quotes table denormalizes `client_*` columns AND maintains a `clients` row. Source of truth = the quote snapshot. The clients table is a convenience CRM layer; mass updates to it never rewrite history.
- Per-rep proposed-incentive numbers leak salary info indirectly via the math. If salary privacy ever matters, move `calculateIncentive` server-side into the RPC and return only the final ₹ values.
- The settled-month bucketing uses `payment_date` which the rep enters. A rep entering a future date could shift a quote into a future month's leaderboard. Currently uncapped; consider a server-side guard if abuse appears.
