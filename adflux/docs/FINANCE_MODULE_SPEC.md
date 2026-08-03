# Finance / P&L Module — Spec (2026-08-03)

Owner: Brijesh. Driven by `_design_reference/finance_module_mockup.html` + his real
bank data (4 statements). Decisions locked 2026-08-03:
- **Income = CRM (payments/quotes), cross-checked against bank credits** (flag bank
  income with no matching CRM payment → finds unrecorded receipts).
- **Full mockup scope**, built in ordered phases (each ships + owner-verified).

Governing rules: §45 (live app untouchable — ADDITIVE only, new tables/routes,
zero touch to sales/leads/quotes/payroll hot paths), §42/§152/§153 (co_owner Vishal
= GOVERNMENT-only), §4 (two-company), §66 (1000-row cap → server aggregates),
§154 (bundle SQL per phase).

---

## 1 · The real data (analysed from the 4 xlsx)

~1,060 bank transactions, 4 banks, Apr–Jul 2026. **₹1.98 Cr of the ₹2.5 Cr gross is
SWEEP** (internal transfers between own accounts — double-counted, NOT P&L), + ₹38L
loan-from-friend + ₹43L personal drawings. Real operating money is a small slice —
**stripping SWEEP/loans/drawings is the module's core value.**

The accountant already hand-tags every row, but the ONE tag column crams 3 dimensions
together (company + segment + bucket) and the 4 banks differ in layout + date format
(text dd/mm/yy AND Excel serials). The importer's job = split that tag into proper
dimensions.

Bank file layouts (0-indexed cols):
| File | Company (default) | Date | Ref | Desc | Dr | Dr-tag(s) | Cr | Cr-tag |
|---|---|---|---|---|---|---|---|---|
| adflux.xlsx | Adflux Pvt Ltd | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
| hdfc.xlsx | Untitled Advertising | 0 | 1 | 2 | 3 | 4(category)+5(bucket) | 6 | 7 |
| cosmos.xlsx | Untitled Advertising | 0 | 1 | 2 | 3 | 4 | 5 | 6 |
| Axis.xlsx | Untitled Advertising | 1 | 2 | 3 | 4 | 5 | 6 | 7 |

Observed tag vocabulary + volume (combined dr+cr): SWEEP ₹1.98Cr/176 · Untitled
Advertising ₹75L/175 · AUTO HOOD ₹66.7L/11 · Personal ₹43.6L/76 · GSRTC ₹41.7L/240 ·
LOAN FROM FRIEND ₹38.4L/20 · Common Expense ₹12.9L/325 · TAX ₹9.7L/8 · Untitled Adflux
Pvt Ltd ₹9.4L/23 · Other Expense · (untagged). HDFC also has granular heads: Vehicle
Expense, Refreshments, Travel & Transportation, Office Expense, Labour charges, Rent
Expense.

---

## 2 · Data model (additive tables, prefix `finance_`)

1. **`bank_accounts`** — id, name, bank, account_no_masked, default_company_id,
   segment_hint, display_order, is_active. Seed the 4.
2. **`finance_transactions`** (core) — id, bank_account_id, txn_date date, ref_no,
   description, amount numeric, direction ('in'|'out'),
   **bucket** enum (`income | direct_cost | common_expense | owner_drawings |
   investment | asset | loan_in | loan_out | internal_transfer | tax | review`),
   company (`Untitled Advertising | Untitled Adflux Pvt Ltd | Trade Venture | null`),
   segment (`GOVERNMENT|PRIVATE|null`), media_type (existing §4 axis; null=overhead),
   expense_head_id → finance_expense_heads, **matched_payment_id** → payments.id
   (reconciliation; null=unmatched), raw_tag text (accountant's original, preserved),
   source ('import'|'manual'), import_batch_id, **dedupe_key** text UNIQUE
   (bank||date||ref||amount), note, created_by, created_at, updated_at.
3. **`finance_expense_heads`** master — name, kind, display_order, is_active. Seed:
   Staff Salaries, Vendor Payment, Marketing & Promotion, Rent & Utilities, Travel &
   Conveyance, Duties & Taxes, Vehicle Expense, Refreshments, Office Expense, Labour
   charges, Other.
4. **`finance_rules`** — priority, match_type ('contains'|'regex'), pattern,
   set_bucket, set_company, set_segment, set_head_id, is_active. Seed the mockup's
   auto-tags (SALARY→Staff Salaries, FACEBOOK→Marketing, TORRENT POWER→GSRTC/Rent,
   BRIJESH self→internal_transfer, EMI/pharmacy→owner_drawings, MODERN ADVERTIS→loan).
5. **`finance_import_batches`** — id, bank_account_id, filename, period, row_count,
   dup_skipped, imported_by, imported_at.
6. **`finance_tasks`** — title, frequency ('daily'|'weekly'|'monthly'|'oneoff'),
   next_due, reminder_channel ('push'|'push_wa'), status, is_active. Seed the mockup's
   recurring set.

`media_type` reuses the existing enum (AUTO_HOOD/GSRTC_LED/OTHER_MEDIA/LED_OTHER…) so
finance segments = the same axis as quotes (§4). The mockup's 4 "segments" = segment +
media_type pairs.

---

## 3 · Tag → dimension mapping (the correctness core — OWNER CONFIRMS)

Default map (importer applies; anything ambiguous → bucket=review, shown in Register):
| Accountant tag | bucket | company | segment/media | note |
|---|---|---|---|---|
| SWEEP | internal_transfer | — | — | NOT P&L |
| Personal | owner_drawings | — | — | drawings |
| LOAN FROM FRIEND | loan_in (Cr) / loan_out (Dr) | — | — | financing |
| TAX | tax | (bank default) | — | duties & taxes |
| Common Expense | common_expense | (bank default) | ↔ all (allocated) | overhead |
| GSRTC | direct_cost (Dr) / income (Cr) | Untitled Advertising | GOVERNMENT / GSRTC_LED | |
| AUTO HOOD | direct_cost (Dr) / income (Cr) | Untitled Advertising | GOVERNMENT / AUTO_HOOD | |
| Untitled Advertising | income (Cr) / direct_cost (Dr) | Untitled Advertising | infer | Dr needs a head → review if unclear |
| Untitled Adflux Pvt Ltd | income (Cr) / direct_cost (Dr) | Untitled Adflux Pvt Ltd | infer | |
| HDFC granular head | (keep as expense_head) | (bank default) | per row-bucket | Vehicle/Refreshments/Travel/Office/Labour/Rent |
| Other Expense / (untagged) | review | — | — | accountant tags in Register |

The tag is LOSSY (a "Untitled Advertising" debit is a company, not a bucket) → the
importer best-guesses + flags `review`; the Register lets accounts fix it. This is
expected, not a bug.

---

## 4 · P&L math

- **Operating income** = CRM revenue (approved final `payments` → per segment/company),
  NOT bank credits (owner decision — avoids double-count). Bank income credits used to
  RECONCILE: match to a payment (amount + ~7-day window + client) → `matched_payment_id`;
  unmatched income credit = "receipt not in CRM" flag.
- **Operating cost** = bank `out` where bucket ∈ (direct_cost, common_expense). Salaries
  come from the debits tagged Staff Salaries (cross-check vs the payroll `salary_payouts`).
- **Excluded from Operating P&L** (shown in separate cards): internal_transfer, loan_in/out,
  owner_drawings, investment, asset, tax (shown separate).
- **Common-expense allocation**: common_expense pool split across segments by income share
  (mockup's method). True net per segment = segment income − direct cost − allocated common.
- **Per company** = group by company. **Group** = sum. Margin = op-P&L ÷ income.

All aggregation SERVER-side (RPC / SQL views) — never client row-count (§66; ~1060 rows
now, grows monthly).

---

## 5 · RLS (§42/§152/§153 doctrine — enforce, don't relax)

- `finance_transactions`: `*_admin_all` (admin) + `*_accounts_all` (accounts full) +
  `*_govt_partner_read` (Vishal → SELECT where segment='GOVERNMENT' only). reps/agency/
  telecaller/hr → NONE.
- Config tables (heads, rules, batches, tasks, bank_accounts): admin + accounts only.
  Vishal → none (org-wide finance config, no segment → not his, matches §153).
- No SECURITY DEFINER write path opens finance to a rep. Every gate fails closed on
  NULL role (§41 — COALESCE).

---

## 6 · Phases (full scope, each ships + owner-verified; SQL bundled per §154)

- **P1 — Foundation SQL** (one file): 6 tables + enums + RLS + expense-head/rule/task/
  bank-account seeds. Owner runs. VERIFY block.
- **P2 — Import engine** (JS/Edge or a Node script + a `finance/import` endpoint): per-bank
  column map + date normalize (serial + text) + tag-split classifier + rules + dedupe +
  batch. Backfill the 4 existing files.
- **P3 — Register tab**: transactions table + filters (company/bucket/segment/bank) +
  inline re-tag + REVIEW filter. Server-paged.
- **P4 — Import tab UI**: dropzone + 3-step (upload → map → review) + auto-tag rule display.
- **P5 — Owner P&L dashboard**: hero, KPIs, monthly trend, revenue-mix donut, per-segment
  net + common split, per-company, loans/transfers, assets, expense-by-head, REVIEW flag +
  CRM-income + reconciliation surfacing.
- **P6 — Accounts Home + Tasks**: to-collect (payments outstanding), approvals, payouts
  (salary_payouts), review count, today's tasks, recurring reminders + push/WA nags
  (reuse the existing push pipeline + finance_tasks cron).
- **Route/nav**: `/finance` gated to admin+accounts (Vishal govt-scoped view). Additive nav
  entry (guardian PASS — V2AppShell is frozen).

## 7 · Acceptance criteria (per §3, before code)

- Importing all 4 files loads ~1060 txns, SWEEP/loan/drawings correctly excluded from
  Operating P&L; re-importing the same file adds ZERO rows (dedupe).
- Operating profit reconciles: income (CRM) − (direct+common bank costs) = hero number;
  segment nets sum to group.
- Vishal sees ONLY GOVERNMENT transactions + govt P&L; reps see the module not at all;
  accounts sees everything; owner everything.
- Zero change to any sales/lead/quote/payroll query latency (§45 — additive tables only).
- Every unmatched income credit surfaces as a "receipt not in CRM" flag.
