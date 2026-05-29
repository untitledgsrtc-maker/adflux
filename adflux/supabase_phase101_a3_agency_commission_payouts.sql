-- =====================================================================
-- ADFLUX → UNTITLED OS  •  PHASE 101.A3 (SQL portion)
-- Agency commission payouts — table + RLS
-- 2026-05-29 (Brijesh Solanki)
-- =====================================================================
--
-- WHY (owner directive 2026-05-29, deferred from Phase 101.A2):
--   AgencyEarningsView ships with 4 states (Pending / Earned / Payable
--   / Lost). The Paid state was parked pending a backing table. Owner
--   wants admin to mark commission payouts against agency users per
--   quote (multi-installment supported), and accountants to export
--   the ledger as CSV. This file ships the storage layer only;
--   Phase 101.A3 JSX follows after VERIFY PASS.
--
-- WHAT THIS FILE DOES (idempotent):
--   1. agency_commission_payouts table — per-quote granularity
--      (quote_id FK ON DELETE CASCADE so wiping a quote cleans its
--      payouts trail; admin shouldn't delete won quotes anyway per
--      Phase 11b). No UNIQUE on quote_id — multi-installment allowed.
--      Shape mirrors Phase 37 salary_payouts with month_year replaced
--      by quote_id (per-quote vs per-month semantic).
--   2. Two indexes: (user_id, quote_id) for AgencyEarningsView
--      per-quote aggregation, (paid_date DESC) for admin's date-range
--      filter on AgencyCommissionAdminV2.
--   3. RLS: acp_admin_all (admin / co_owner full read+write — Phase
--      37 precedent + §41 mixed-convention) + acp_self_read (agency
--      reads own payouts). Vishal §42 doctrine drift documented in
--      header — co_owner sees PRIVATE-segment agency commissions
--      because RLS doesn't segment-scope here. Owner-approved
--      consistency with Phase 37 salary_payouts. Tighten later if
--      Vishal-private-leak ever surfaces (Phase 101.A3.1 candidate).
--
-- WHAT THIS FILE DOES NOT TOUCH:
--   - payments table (client→Untitled cash; commission payouts are
--     Untitled→agency disbursement — different transaction class)
--   - quotes pricing / signer / status
--   - Phase 101.A1 users.agency_commission_percent column
--   - compute_monthly_salary RPC (agency short-circuit unchanged)
--   - AgencyEarningsView Phase 101.A2 component (JSX ships in 101.A3 JSX)
--   - V2AppShell ADMIN_NAV (JSX ships in 101.A3 JSX)
--
-- =====================================================================


-- ─────────────────────────────────────────────────────────────────────
-- (1) Table
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.agency_commission_payouts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users(id)   ON DELETE CASCADE,
  quote_id        uuid NOT NULL REFERENCES public.quotes(id)  ON DELETE CASCADE,
  amount_paid     numeric NOT NULL CHECK (amount_paid > 0),
  is_full_payment boolean NOT NULL DEFAULT false,
  paid_date       date NOT NULL DEFAULT CURRENT_DATE,
  paid_by         uuid REFERENCES public.users(id),
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now()
);


-- ─────────────────────────────────────────────────────────────────────
-- (2) Indexes
-- ─────────────────────────────────────────────────────────────────────

-- AgencyEarningsView aggregates payouts per (user_id, quote_id) for
-- the Paid-state derivation. Covers the common SELECT pattern.
CREATE INDEX IF NOT EXISTS idx_acp_user_quote
  ON public.agency_commission_payouts (user_id, quote_id);

-- AgencyCommissionAdminV2 filter row sorts by paid_date desc to show
-- recent payouts first + date-range filter narrows the same column.
CREATE INDEX IF NOT EXISTS idx_acp_paid_date
  ON public.agency_commission_payouts (paid_date DESC);


-- ─────────────────────────────────────────────────────────────────────
-- (3) RLS
-- ─────────────────────────────────────────────────────────────────────
-- Phase 37 precedent + §41 mixed-convention: admin / co_owner full
-- read+write. Vishal's §42 government-scoping doctrine is NOT
-- enforced here — he sees PRIVATE-segment agency commission rows.
-- Owner-approved equivalent of Phase 37 salary_payouts pattern.
-- Document for future tightening if needed.

ALTER TABLE public.agency_commission_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "acp_admin_all"  ON public.agency_commission_payouts;
DROP POLICY IF EXISTS "acp_self_read"  ON public.agency_commission_payouts;

CREATE POLICY "acp_admin_all" ON public.agency_commission_payouts
  FOR ALL TO authenticated
  USING      (public.get_my_role() IN ('admin', 'co_owner'))
  WITH CHECK (public.get_my_role() IN ('admin', 'co_owner'));

-- Self-read scoped strictly to the agency's own user_id. Agency
-- cannot insert / update / delete via PostgREST (no acp_self_write
-- policy). Admin marks all payouts via AgencyCommissionAdminV2.
CREATE POLICY "acp_self_read" ON public.agency_commission_payouts
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());


-- ─────────────────────────────────────────────────────────────────────
-- Refresh PostgREST schema cache
-- ─────────────────────────────────────────────────────────────────────

NOTIFY pgrst, 'reload schema';


-- =====================================================================
-- VERIFY (paste each block in Studio after applying)
-- =====================================================================
--
-- V1: table present
--   SELECT count(*) FROM information_schema.tables
--    WHERE table_schema='public' AND table_name='agency_commission_payouts';
--   Expected: 1
--
-- V2: RLS enabled + 2 policies present
--   SELECT relrowsecurity FROM pg_class
--    WHERE oid = 'public.agency_commission_payouts'::regclass;
--   Expected: t
--   SELECT count(*) FROM pg_policies
--    WHERE schemaname='public' AND tablename='agency_commission_payouts';
--   Expected: 2
--
-- V3: indexes present
--   SELECT indexname FROM pg_indexes
--    WHERE schemaname='public' AND tablename='agency_commission_payouts'
--    ORDER BY indexname;
--   Expected: 3 rows — primary key + idx_acp_paid_date + idx_acp_user_quote
--
-- V4 (admin smoke — insert as admin, then read):
--   Find Hamesh's id + a real won quote_id of his:
--     SELECT q.id AS quote_id, u.id AS user_id, q.quote_number, q.subtotal
--       FROM public.quotes q JOIN public.users u ON u.id = q.created_by
--      WHERE u.name='Hamesh Modi' AND q.status='won'
--      LIMIT 5;
--   Pick one quote_id + Hamesh's user_id. Then:
--     INSERT INTO public.agency_commission_payouts
--       (user_id, quote_id, amount_paid, paid_by, note)
--     VALUES
--       ('<HAMESH_UUID>'::uuid, '<QUOTE_UUID>'::uuid, 1000,
--        (SELECT id FROM users WHERE name='Brijesh Solanki'), 'V4 smoke');
--   Expected: 1 row inserted, no error.
--   Then:
--     SELECT id, amount_paid, paid_date, note FROM public.agency_commission_payouts
--      WHERE note='V4 smoke';
--   Expected: 1 row, amount_paid=1000, paid_date=today.
--
-- V5 (self-read smoke — Hamesh-as-auth-user reads own):
--   This requires a logged-in agency session. Defer to JSX phase
--   smoke — Hamesh logs in, AgencyEarningsView fetches own payouts.
--
-- V6 (CHECK constraint smoke — try amount_paid = 0):
--   INSERT INTO public.agency_commission_payouts
--     (user_id, quote_id, amount_paid)
--   VALUES
--     ('<HAMESH_UUID>'::uuid, '<QUOTE_UUID>'::uuid, 0);
--   Expected: ERROR 23514 — amount_paid CHECK fails.
--
-- V7 (cleanup V4 row before JSX phase):
--   DELETE FROM public.agency_commission_payouts WHERE note='V4 smoke';
--   Expected: 1 row deleted.
--
-- =====================================================================
-- ROLLBACK (paste in Studio only if VERIFY fails)
-- =====================================================================
--
-- a) Drop policies
--   DROP POLICY IF EXISTS "acp_admin_all"  ON public.agency_commission_payouts;
--   DROP POLICY IF EXISTS "acp_self_read"  ON public.agency_commission_payouts;
--
-- b) Drop indexes (DROP TABLE cleans these too; explicit for clarity)
--   DROP INDEX IF EXISTS public.idx_acp_user_quote;
--   DROP INDEX IF EXISTS public.idx_acp_paid_date;
--
-- c) Drop table
--   DROP TABLE IF EXISTS public.agency_commission_payouts;
--
-- d) Refresh PostgREST
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
