-- supabase_phase37_salary_payouts.sql
-- Phase 37 — salary_payouts table for multi-installment salary payments.
-- 17 May 2026
--
-- Owner directive: when final salary is counted, accounts must be able
-- to pay out in single OR multiple instalments and see history of who
-- paid what, when. Mirrors the incentive_payouts pattern (Phase 2).
--
-- Schema:
--   id, user_id, month_year, amount_paid, is_full_payment,
--   paid_date, paid_by, note, created_at
--
-- RLS:
--   admin / co_owner — full read+write
--   rep              — SELECT own rows (so rep sees own payout history)
--
-- Idempotent.

-- ─── 1. Table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.salary_payouts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  month_year      text NOT NULL,                       -- '2026-05'
  amount_paid     numeric NOT NULL CHECK (amount_paid > 0),
  is_full_payment boolean NOT NULL DEFAULT false,
  paid_date       date NOT NULL DEFAULT CURRENT_DATE,
  paid_by         uuid REFERENCES public.users(id),
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_salary_payouts_user_month
  ON public.salary_payouts (user_id, month_year DESC);
CREATE INDEX IF NOT EXISTS idx_salary_payouts_month
  ON public.salary_payouts (month_year);


-- ─── 2. RLS ──────────────────────────────────────────────────────
ALTER TABLE public.salary_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sp_admin_all"  ON public.salary_payouts;
DROP POLICY IF EXISTS "sp_self_read"  ON public.salary_payouts;

CREATE POLICY "sp_admin_all" ON public.salary_payouts
  FOR ALL TO authenticated
  USING      (public.get_my_role() IN ('admin', 'co_owner'))
  WITH CHECK (public.get_my_role() IN ('admin', 'co_owner'));

CREATE POLICY "sp_self_read" ON public.salary_payouts
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());


NOTIFY pgrst, 'reload schema';


-- ─── VERIFY ──────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.tables
    WHERE table_schema='public' AND table_name='salary_payouts')          AS table_present,
  (SELECT count(*) FROM pg_policies
    WHERE schemaname='public' AND tablename='salary_payouts')             AS rls_count;
