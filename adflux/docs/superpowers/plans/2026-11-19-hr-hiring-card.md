# HR Hiring Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One path per hire — Offer drafted → Owner approves salary → Link sent → Accepted → Login created → Onboarding — with the owner's approval enforced in the database and nothing typed twice.

**Architecture:** The database owns the rules: new `hr_offers` columns + a `BEFORE INSERT/UPDATE` guard trigger enforce who may approve, block sending before approval, lock terms after sending and reset approval when terms change; the two public offer functions refuse unapproved offers. The UI turns the existing `OfferDetailModal` into the hiring card (stepper + one action per step) and makes `SendOfferModal` save a draft for approval. Create-login logic moves into one shared helper used by the card.

**Tech Stack:** React 18 + Vite, Supabase (Postgres, RLS, SECURITY DEFINER, `enqueue_push`), lucide-react.

**Spec:** `docs/superpowers/specs/2026-11-18-hr-hiring-card-design.md`

## Global Constraints

- Approver = role `admin` only (today Brijesh). `co_owner` and `hr` never approve. An offer an admin creates is approved on save.
- Status flow: `draft → pending_approval → approved → sent → filled → accepted → converted_to_user` (+ `cancelled`; owner "send back" = `pending_approval → draft` with a note).
- Locked fields (cannot change once status is `sent`, `filled`, `accepted` or `converted_to_user`; changing them while `approved` drops back to `pending_approval`): `fixed_salary_monthly`, `incentive_sales_multiplier`, `incentive_new_client_rate`, `incentive_renewal_rate`, `incentive_flat_bonus`, `position`, `designation_name`, `designation_auth_role`, `designation_team_role`, `joining_date`, `manager_id`, `segment_access`, `allow_ta`, `allow_da`, `allow_hotel`, `allow_other`, `min_calls`, `min_quotes`, `min_followups`.
- Public page copy when not approved: "This offer is not ready yet".
- The 24 existing offers (20 `converted_to_user`, 4 `accepted`) keep their status; the guard must not block them.
- SQL: idempotent, ends with a `-- VERIFY` block and `NOTIFY pgrst, 'reload schema';`; new functions REVOKEd from `PUBLIC, anon`. Never `owner` role. Lucide icons only, `var(--v2-*)` tokens, no emoji, no `#facc15`.
- `V2AppShell.jsx` is frozen: the nav change needs a `sales-module-guardian` PASS before commit (CLAUDE.md §28).
- No change to sales / telecaller pages or hot paths (CLAUDE.md §45).

## Review Focus

1. HR writes the row directly through PostgREST (RLS `hr_offers_hr_all` gives her full write) — setting `status='approved'` or `'sent'` herself must be refused by the trigger, not just hidden in the UI.
2. A candidate who opened the link before approval, or an old link after "send back" — the public page must show "This offer is not ready yet", never the salary.
3. Admin edits the salary inside the approval screen — the edit must save AND approve in one step (not bounce back to `pending_approval`).
4. Legacy rows: converting one of the 4 already-`accepted` offers must still work although they have no `approved_at`.
5. "Create login" pressed twice or on an offer whose email already has a login — must reuse the login (no duplicate user, no second onboarding run).

---

### Task 1: Database rules (Phase 618)

**Files:**
- Create: `supabase_phase618_hr_offer_approval.sql`
- Test: `$SCRATCH/t618.sql` (rolled-back DO-block test, not committed)

**Interfaces:**
- Produces: `hr_offers` columns `approved_by uuid`, `approved_at timestamptz`, `approval_note text`, `manager_id uuid`, `segment_access text` (CHECK `PRIVATE|GOVERNMENT|ALL`), `allow_ta bool`, `allow_da bool`, `allow_hotel bool`, `allow_other bool`, `min_calls int`, `min_quotes int`, `min_followups int`, `candidate_id uuid` (FK `hr_candidates`, ON DELETE SET NULL); status CHECK extended with `pending_approval`, `approved`; trigger `trg_hr_offer_guard` → `hr_offer_guard()`; push trigger `trg_hr_offer_notify` → `hr_offer_notify()`; `fetch_offer_by_token` / `submit_offer_acceptance` refuse `draft` and `pending_approval`.

- [ ] **Step 1: Write the failing test** — a DO block that, under `SET LOCAL ROLE authenticated` + `request.jwt.claims`, inserts an offer as Riya (look up her id with `SELECT id FROM users WHERE role='hr' AND is_active`), then asserts each and ends with `RAISE EXCEPTION 'T618 …'` so nothing persists:
  - Riya insert with `status='pending_approval'` → row stored with `approved_at IS NULL`.
  - Riya `UPDATE … SET status='approved'` → raises `check_violation`.
  - Riya `UPDATE … SET status='sent'` while `approved_at IS NULL` → raises.
  - `fetch_offer_by_token(token)` returns 0 rows while `pending_approval`.
  - Brijesh (admin) `UPDATE … SET status='approved', fixed_salary_monthly=27000` → `approved_by = Brijesh`, salary 27000, status `approved`.
  - Riya then changes `fixed_salary_monthly` → status back to `pending_approval`, `approved_at` NULL.
  - Admin re-approves, Riya sets `status='sent'` → allowed; Riya then changes salary → raises.
  - Admin-created offer with `status='draft'` → stored as `approved`.
  - One existing `accepted` row: `UPDATE … SET status='converted_to_user', converted_user_id=<any user>` as Riya → allowed.
- [ ] **Step 2: Run it before the SQL exists** — `supabase db query --linked -f $SCRATCH/t618.sql`; expected: fails (column `approved_at` does not exist).
- [ ] **Step 3: Write `supabase_phase618_hr_offer_approval.sql`** — columns (`ADD COLUMN IF NOT EXISTS`), drop/re-add status CHECK, guard function (SECURITY DEFINER, `search_path = public, pg_temp`, NULL-role short-circuit `v_role IS NULL OR …`), push function (`pending_approval` → every active `admin` with tag `hro-<id>` url `/hr/offers?offer=<id>`; `approved` / back-to-`draft` → `created_by` user), recreate the two public functions with `AND status NOT IN ('cancelled','draft','pending_approval')` (keep their signatures and `REVOKE/GRANT` exactly), VERIFY block (columns 13, CHECK contains `pending_approval`, both triggers present, both public fns contain `pending_approval`).
- [ ] **Step 4: Apply and re-run the test** — `supabase db query --linked -f supabase_phase618_hr_offer_approval.sql` then the test; expected: `T618 …` line with every assertion `ok`.
- [ ] **Step 5: Commit** — `git add supabase_phase618_hr_offer_approval.sql && git commit -m "Phase 618: hr_offers owner approval gate + login fields"`

### Task 2: Shared create-login helper

**Files:**
- Create: `src/utils/hrHire.js`
- Modify: `src/components/hr/OfferDetailModal.jsx` (replace inline `handleConvert` body with the helper)

**Interfaces:**
- Consumes: Task 1 columns.
- Produces: `createLoginFromOffer(offer: object, { password: string }) -> Promise<{ userId: string, email: string, reused: boolean, error?: string }>` — calls `admin_create_user` with `p_manager_id`, `p_segment_access` (offer's `segment_access`, fallback to today's role-based rule), `p_allow_ta/da/hotel/other` from the offer; upserts `staff_incentive_profiles` like `HRNewUserV2` (salary + incentive fields); inserts `daily_targets` when any `min_*` > 0; sets `hr_candidates.converted_user_id` when `offer.candidate_id`; calls `create_onboarding_run` only when the user was newly created; marks the offer `converted_to_user` + `converted_user_id`. Also `buildOfferUrl(token: string) -> string` and `offerWhatsAppText(offer, link) -> string` moved from `SendOfferModal`.

- [ ] **Step 1: Write the check** — a node script `$SCRATCH/hrhire_check.mjs` importing `buildOfferUrl` and `offerWhatsAppText` and asserting the URL ends with `/offer/<token>` and the text contains the candidate name, position and link.
- [ ] **Step 2: Run it** — `node $SCRATCH/hrhire_check.mjs`; expected: fails (module missing).
- [ ] **Step 3: Implement `src/utils/hrHire.js`** and switch `OfferDetailModal.handleConvert` to call `createLoginFromOffer`; keep its existing password generation and the login WhatsApp message (`loginMessage`).
- [ ] **Step 4: Run** — the node check passes; `npx vite build --logLevel error` exits 0.
- [ ] **Step 5: Commit** — `git commit -m "Phase 618.1: shared create-login-from-offer helper"`

### Task 3: Offer form saves a draft for approval

**Files:**
- Modify: `src/components/hr/SendOfferModal.jsx`
- Modify: `src/pages/v2/HRCandidatesV2.jsx:194` (pass `candidate_id` in `prefill`)

**Interfaces:**
- Consumes: Task 1 columns; `buildOfferUrl`, `offerWhatsAppText` from Task 2.
- Produces: `SendOfferModal` prop `onCreated(offer)` now receives the created row; the modal no longer calls `markSent` and no longer shows the link for HR.

- [ ] **Step 1: Add the login-detail fields** to the form: manager (select of active users with `team_role IN ('sales_manager','admin')`, as `HRNewUserV2` loads them), segment (Private / Government; default Private), four allowance switches (default from the picked designation: on for sales/telecaller roles, else off), daily targets `min_calls/min_quotes/min_followups` (prefilled from the designation's defaults when present, else 0).
- [ ] **Step 2: Save as** `status='pending_approval'` (the DB turns an admin's save into `approved`), include the new fields + `candidate_id`. Success screen for HR: "Sent to Brijesh for approval" + Open card; for admin (row comes back `approved`): the existing link + WhatsApp share, now via the helper.
- [ ] **Step 3: Verify** — esbuild parse + build exit 0; as admin in Chrome create a test offer → stored `approved` (then cancel it via SQL so it does not linger).
- [ ] **Step 4: Commit** — `git commit -m "Phase 618.2: offer form - login details + draft for owner approval"`

### Task 4: The hiring card (stepper + one action per step)

**Files:**
- Modify: `src/components/hr/OfferDetailModal.jsx`
- Modify: `src/pages/v2/HRV2.jsx` (status filters: add "Waiting for owner" `pending_approval`, "Approved – share link" `approved`; open the card from `?offer=<id>` so the push link works)

**Interfaces:**
- Consumes: Tasks 1–3.

- [ ] **Step 1: Stepper header** — six steps in spec order; done / current / upcoming from `status` (`draft`/`pending_approval` → step 2 current, `approved` → 3, `sent`/`filled` → 4, `accepted` → 5, `converted_to_user` → 6 done). Lucide `Check` for done.
- [ ] **Step 2: Actions per status** —
  - `draft` (sent back): show `approval_note`; HR "Edit and send for approval" (sets `pending_approval`).
  - `pending_approval`: admin sees editable salary + incentive + login fields, **Approve** (one update: fields + `status='approved'`) and **Send back** (note required, `status='draft'`); HR sees "Waiting for Brijesh".
  - `approved`: Copy link / Share on WhatsApp (helper), then "Mark as sent" (`status='sent'`).
  - `sent`/`filled`: "Waiting for <name> to accept" + resend link.
  - `accepted`: **Create login** (Task 2 helper).
  - `converted_to_user`: link to the person's onboarding page.
- [ ] **Step 3: Verify in Chrome (logged in as admin)** — with a test offer walk pending → approve (edit salary) → share → mark sent; confirm each step's DB status via SQL; cancel the test offer at the end. Review-focus 3 (edit + approve in one step) checked here.
- [ ] **Step 4: Commit** — `git commit -m "Phase 618.3: hiring card stepper + owner approval actions"`

### Task 5: HR home + menu

**Files:**
- Modify: `src/pages/v2/HRHomeV2.jsx:75-77` (the "2 · Hire" section)
- Modify: `src/components/v2/V2AppShell.jsx` (`HR_NAV`: remove `/hr/new-user`; add `/hr/offers` label "Hiring")
- Modify: `src/pages/v2/HRV2.jsx:84` (hide the "Add member" button for role `hr`)

- [ ] **Step 1: Replace the two Hire tiles** with one "Hiring" tile showing four counts from `hr_offers`: Waiting for owner (`pending_approval`), Waiting for candidate (`approved`,`sent`,`filled`), Ready to create login (`accepted`), Onboarding (converted in the last 30 days); each count opens `/hr/offers` with that filter. Admin also sees a "Waiting for you" count in the top stats.
- [ ] **Step 2: Nav change** and run `sales-module-guardian` on the `V2AppShell.jsx` diff; fix any P0/P1.
- [ ] **Step 3: Verify** — build exit 0; Chrome as admin: HR home shows the Hiring tile with correct counts (compare with SQL `SELECT status, count(*) FROM hr_offers GROUP BY 1`); no console errors.
- [ ] **Step 4: Commit + push** — `git commit -m "Phase 618.4: HR home Hiring tile + HR menu"`, `git push origin untitled-os`, add a CLAUDE.md note for Phase 618, wait for the Vercel deploy and re-check `/hr` and `/hr/offers` live.
