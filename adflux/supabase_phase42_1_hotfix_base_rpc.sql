-- supabase_phase42_1_hotfix_base_rpc.sql
-- HOTFIX for Phase 42 — restore _compute_monthly_salary_base
-- 18 May 2026
--
-- Bug: Phase 42 SQL did CREATE OR REPLACE on compute_monthly_salary
-- (the wrapper) BEFORE the DO block tried to rename the original
-- to _compute_monthly_salary_base. By that point the original body
-- was already overwritten. Result: the wrapper now calls a function
-- (_base) that doesn't exist → Salary tab throws on every load.
--
-- Fix: CREATE _compute_monthly_salary_base with the exact Phase
-- 36.10 body (copied from supabase_phase36_10_paid_leave_tenure.sql
-- lines 53-189). Wrapper compute_monthly_salary stays as-is and
-- now resolves _base correctly.
--
-- Idempotent: CREATE OR REPLACE on _base.

CREATE OR REPLACE FUNCTION public._compute_monthly_salary_base(
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
  v_month_year     text;
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

  v_leave_total       numeric := 0;
  v_leave_paid_req    numeric := 0;
  v_leave_unpaid_req  numeric := 0;
  v_paid_used_ytd     numeric := 0;
  v_leave_paid        numeric := 0;
  v_leave_unpaid      numeric := 0;
  v_unpaid_deduction  numeric := 0;

  v_fy_start       date;
  v_net            numeric;
  v_score_row      record;
BEGIN
  v_month_start := make_date(p_year, p_month, 1);
  v_month_end   := (v_month_start + INTERVAL '1 month' - INTERVAL '1 day')::date;
  v_month_year  := to_char(v_month_start, 'YYYY-MM');
  v_fy          := public.fy_for_date(v_month_start);
  v_fy_start    := CASE WHEN p_month >= 4
                          THEN make_date(p_year, 4, 1)
                          ELSE make_date(p_year - 1, 4, 1) END;

  SELECT paid_quota_days, unpaid_divisor
    INTO v_paid_quota, v_unpaid_divisor
    FROM public.salary_policy WHERE fy = v_fy;
  v_paid_quota     := COALESCE(v_paid_quota, 12);
  v_unpaid_divisor := COALESCE(v_unpaid_divisor, 26);

  SELECT * INTO v_score_row
    FROM public.monthly_score(p_user_id, v_month_start)
    LIMIT 1;
  v_monthly_salary := COALESCE(v_score_row.monthly_salary, 0);
  v_base           := COALESCE(v_score_row.base_amount, 0);
  v_variable       := COALESCE(v_score_row.variable_earned, 0);
  v_score_pct      := COALESCE(v_score_row.avg_score_pct, 0);
  v_working_days   := COALESCE(v_score_row.working_days, 0);

  SELECT COALESCE(SUM(amount_paid), 0) INTO v_incentive
    FROM public.incentive_payouts
   WHERE staff_id = p_user_id
     AND month_year = v_month_year;

  SELECT COALESCE(SUM(total_amount), 0) INTO v_ta_da
    FROM public.daily_ta
   WHERE user_id = p_user_id
     AND ta_date BETWEEN v_month_start AND v_month_end;

  SELECT
    COALESCE(SUM(CASE WHEN is_paid_request AND is_half_day  THEN 0.5
                      WHEN is_paid_request                  THEN 1
                      ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN NOT is_paid_request AND is_half_day THEN 0.5
                      WHEN NOT is_paid_request                  THEN 1
                      ELSE 0 END), 0)
  INTO v_leave_paid_req, v_leave_unpaid_req
    FROM public.leaves
   WHERE user_id = p_user_id
     AND status = 'approved'
     AND leave_date BETWEEN v_month_start AND v_month_end;

  v_leave_total := v_leave_paid_req + v_leave_unpaid_req;

  SELECT COALESCE(SUM(CASE WHEN is_half_day THEN 0.5 ELSE 1 END), 0)
    INTO v_paid_used_ytd
    FROM public.leaves
   WHERE user_id = p_user_id
     AND status = 'approved'
     AND is_paid_request = true
     AND leave_date >= v_fy_start
     AND leave_date <  v_month_start;

  v_leave_paid := LEAST(v_leave_paid_req,
                        GREATEST(0, v_paid_quota - v_paid_used_ytd));
  v_leave_unpaid := v_leave_unpaid_req + (v_leave_paid_req - v_leave_paid);

  IF v_base > 0 AND v_unpaid_divisor > 0 THEN
    v_unpaid_deduction := round((v_base / v_unpaid_divisor) * v_leave_unpaid);
  ELSE
    v_unpaid_deduction := 0;
  END IF;

  v_net := round(v_base + v_variable + v_incentive + v_ta_da - v_unpaid_deduction);

  RETURN jsonb_build_object(
    'user_id',            p_user_id,
    'year',               p_year,
    'month',              p_month,
    'fy',                 v_fy,
    'monthly_salary',     v_monthly_salary,
    'base',               round(v_base),
    'variable',           round(v_variable),
    'score_pct',          round(v_score_pct, 1),
    'working_days',       v_working_days,
    'incentive',          v_incentive,
    'ta_da',              v_ta_da,
    'leave_days_total',   v_leave_total,
    'leave_days_paid',    v_leave_paid,
    'leave_days_unpaid',  v_leave_unpaid,
    'leave_paid_req',     v_leave_paid_req,
    'leave_unpaid_req',   v_leave_unpaid_req,
    'paid_quota',         v_paid_quota,
    'paid_used_ytd',      v_paid_used_ytd,
    'unpaid_divisor',     v_unpaid_divisor,
    'unpaid_deduction',   v_unpaid_deduction,
    'net_payable',        v_net
  );
END $$;

GRANT EXECUTE ON FUNCTION public._compute_monthly_salary_base(uuid, int, int) TO authenticated;

NOTIFY pgrst, 'reload schema';


-- ─── VERIFY ──────────────────────────────────────────────────────
-- All 3 functions should exist now: wrapper, base, helper.
SELECT
  (SELECT count(*) FROM pg_proc
    WHERE proname IN ('compute_monthly_salary','_compute_monthly_salary_base','is_sales_manager')
      AND pronamespace='public'::regnamespace)                          AS rpc_fn_count;

-- Expected: rpc_fn_count = 3.

-- Smoke test: call the wrapper for any rep + current month. Should
-- return jsonb with net_payable. Replace the UUID with a real user
-- (e.g. Brijesh's id) and current year/month.
--   SELECT public.compute_monthly_salary(
--     (SELECT id FROM public.users WHERE name='Brijesh' LIMIT 1),
--     2026, 5
--   );
