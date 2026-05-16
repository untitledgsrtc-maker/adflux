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

CREATE OR REPLACE FUNCTION public.compute_monthly_salary(
  p_user_id uuid,
  p_year    int,
  p_month   int
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month_start    date;
  v_month_end      date;
  v_fy             text;
  v_paid_quota     numeric;
  v_unpaid_divisor int;

  v_monthly_salary numeric := 0;
  v_base           numeric := 0;
  v_variable       numeric := 0;
  v_score_pct      numeric := 0;
  v_working_days   int     := 0;

  v_incentive      numeric := 0;
  v_ta_da          numeric := 0;

  v_leave_total    numeric := 0;
  v_leave_paid     numeric := 0;
  v_leave_unpaid   numeric := 0;
  v_paid_used_ytd  numeric := 0;
  v_unpaid_deduction numeric := 0;

  v_fy_start       date;
  v_net            numeric;
  v_score_row      record;
BEGIN
  v_month_start := make_date(p_year, p_month, 1);
  v_month_end   := (v_month_start + INTERVAL '1 month' - INTERVAL '1 day')::date;
  v_fy          := public.fy_for_date(v_month_start);
  v_fy_start    := CASE WHEN p_month >= 4
                          THEN make_date(p_year, 4, 1)
                          ELSE make_date(p_year - 1, 4, 1) END;

  -- Policy lookup
  SELECT paid_quota_days, unpaid_divisor
    INTO v_paid_quota, v_unpaid_divisor
    FROM public.salary_policy WHERE fy = v_fy;
  v_paid_quota     := COALESCE(v_paid_quota, 12);
  v_unpaid_divisor := COALESCE(v_unpaid_divisor, 26);

  -- Base + variable via existing monthly_score function (Phase 33E).
  -- Returns: working_days, avg_score_pct, monthly_salary, base_amount,
  --          variable_cap, variable_earned, total_payable
  SELECT * INTO v_score_row
    FROM public.monthly_score(p_user_id, v_month_start)
    LIMIT 1;
  v_monthly_salary := COALESCE(v_score_row.monthly_salary, 0);
  v_base           := COALESCE(v_score_row.base_amount, 0);
  v_variable       := COALESCE(v_score_row.variable_earned, 0);
  v_score_pct      := COALESCE(v_score_row.avg_score_pct, 0);
  v_working_days   := COALESCE(v_score_row.working_days, 0);

  -- Incentive payouts marked paid in this calendar month.
  SELECT COALESCE(SUM(amount), 0) INTO v_incentive
    FROM public.incentive_payouts
   WHERE user_id = p_user_id
     AND COALESCE(status, 'paid') IN ('paid', 'approved')
     AND COALESCE(payout_date, created_at::date)
         BETWEEN v_month_start AND v_month_end;

  -- TA/DA — sum daily_ta amount for the month.
  SELECT COALESCE(SUM(ta_amount), 0) INTO v_ta_da
    FROM public.daily_ta
   WHERE user_id = p_user_id
     AND ta_date BETWEEN v_month_start AND v_month_end;

  -- Approved leave days this month (half-day = 0.5).
  SELECT COALESCE(SUM(CASE WHEN is_half_day THEN 0.5 ELSE 1 END), 0)
    INTO v_leave_total
    FROM public.leaves
   WHERE user_id = p_user_id
     AND status = 'approved'
     AND leave_date BETWEEN v_month_start AND v_month_end;

  -- YTD paid quota consumed BEFORE this month (so we know how much of
  -- this month's leave is paid vs unpaid).
  SELECT COALESCE(SUM(CASE WHEN is_half_day THEN 0.5 ELSE 1 END), 0)
    INTO v_paid_used_ytd
    FROM public.leaves
   WHERE user_id = p_user_id
     AND status = 'approved'
     AND leave_date >= v_fy_start
     AND leave_date <  v_month_start;

  -- Split this month's leave: paid first (up to remaining quota),
  -- rest is unpaid.
  v_leave_paid   := LEAST(v_leave_total, GREATEST(0, v_paid_quota - v_paid_used_ytd));
  v_leave_unpaid := GREATEST(0, v_leave_total - v_leave_paid);

  -- Deduction: base / divisor per unpaid day.
  IF v_base > 0 AND v_unpaid_divisor > 0 THEN
    v_unpaid_deduction := round((v_base / v_unpaid_divisor) * v_leave_unpaid);
  ELSE
    v_unpaid_deduction := 0;
  END IF;

  v_net := round(v_base + v_variable + v_incentive + v_ta_da - v_unpaid_deduction);

  RETURN jsonb_build_object(
    'user_id',           p_user_id,
    'year',              p_year,
    'month',             p_month,
    'fy',                v_fy,
    'monthly_salary',    v_monthly_salary,
    'base',              round(v_base),
    'variable',          round(v_variable),
    'score_pct',         round(v_score_pct, 1),
    'working_days',      v_working_days,
    'incentive',         v_incentive,
    'ta_da',             v_ta_da,
    'leave_days_total',  v_leave_total,
    'leave_days_paid',   v_leave_paid,
    'leave_days_unpaid', v_leave_unpaid,
    'paid_quota',        v_paid_quota,
    'paid_used_ytd',     v_paid_used_ytd,
    'unpaid_divisor',    v_unpaid_divisor,
    'unpaid_deduction',  v_unpaid_deduction,
    'net_payable',       v_net
  );
END $$;

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
