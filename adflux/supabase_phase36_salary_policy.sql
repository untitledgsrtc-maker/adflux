-- supabase_phase36_salary_policy.sql
-- Phase 36 — salary policy table + half-day leaves + monthly salary RPC.
-- 16 May 2026
--
-- Owner directive (16 May 2026): the app should auto-compute each
-- rep's monthly salary including base, variable (from score), incentive
-- payouts, TA/DA, and a LEAVE DEDUCTION based on company policy.
-- Mehulbhai still records the lump-sum SALARY in monthly_admin_expenses,
-- but admin now has a per-rep breakdown to upload exact rupees per rep
-- via the new /salary page.
--
-- Locked policy (owner-confirmed):
--   Paid quota         : 12 days/year (single bucket, no CL/SL/EL split)
--   Carry-forward cap  : 30 days
--   Unpaid formula     : base_salary / 26 per day
--   Half-day           : supported (0.5 day)
--   Sunday + holidays  : paid, not against quota
--   Saturday           : workday
--
-- Idempotent: safe to re-run.

-- ─── 1. salary_policy table ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.salary_policy (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fy                 text NOT NULL UNIQUE,           -- '2026-27'
  paid_quota_days    numeric(5,1) NOT NULL DEFAULT 12,
  carry_forward_cap  numeric(5,1) NOT NULL DEFAULT 30,
  unpaid_divisor     int NOT NULL DEFAULT 26,
  half_day_supported boolean NOT NULL DEFAULT true,
  effective_from     date NOT NULL,
  notes              text,
  created_by         uuid REFERENCES public.users(id),
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);

-- Seed FY 2026-27 row.
INSERT INTO public.salary_policy
  (fy, paid_quota_days, carry_forward_cap, unpaid_divisor, half_day_supported, effective_from, notes)
SELECT '2026-27', 12, 30, 26, true, '2026-04-01',
       'Phase 36 seed — owner-confirmed company-wide policy 16 May 2026.'
WHERE NOT EXISTS (SELECT 1 FROM public.salary_policy WHERE fy = '2026-27');


-- ─── 2. leaves.is_half_day column ────────────────────────────────
ALTER TABLE public.leaves
  ADD COLUMN IF NOT EXISTS is_half_day boolean NOT NULL DEFAULT false;


-- ─── 3. compute_monthly_salary RPC ───────────────────────────────
-- Returns per-rep monthly salary breakdown including leave deduction.
-- Reads from existing tables:
--   • staff_incentive_profiles.monthly_salary  → total comp budget
--   • monthly_score(user_id, month_start)      → variable from score
--   • incentive_payouts                        → approved + paid this month
--   • daily_ta                                 → TA/DA this month
--   • leaves                                   → days taken (with is_half_day)
--   • salary_policy                            → paid quota + divisor

-- -------------------------------------------------------------------------
-- compute_monthly_salary REMOVED from this file (Phase 178).
-- Canonical: db/functions/compute_monthly_salary.sql  (MONEY — payroll).
-- Do NOT re-add it here. Edit the canonical file only (§71).
-- -------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.compute_monthly_salary(uuid, int, int) TO authenticated;


-- ─── 4. RLS — salary_policy ──────────────────────────────────────
ALTER TABLE public.salary_policy ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "salary_policy_admin_all" ON public.salary_policy;
CREATE POLICY "salary_policy_admin_all" ON public.salary_policy
  FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin', 'co_owner'))
  WITH CHECK (public.get_my_role() IN ('admin', 'co_owner'));

DROP POLICY IF EXISTS "salary_policy_read_all" ON public.salary_policy;
CREATE POLICY "salary_policy_read_all" ON public.salary_policy
  FOR SELECT TO authenticated
  USING (true);


NOTIFY pgrst, 'reload schema';


-- ─── VERIFY ──────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM salary_policy WHERE fy='2026-27') AS policy_seeded,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name='leaves'
      AND column_name='is_half_day')                       AS half_day_col,
  (SELECT count(*) FROM pg_proc
    WHERE proname='compute_monthly_salary')                AS rpc_present;

-- Smoke test (uncomment + replace UUID):
-- SELECT compute_monthly_salary(
--   '00000000-0000-0000-0000-000000000000'::uuid, 2026, 5
-- );
