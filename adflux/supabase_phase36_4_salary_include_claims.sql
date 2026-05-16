-- supabase_phase36_4_salary_include_claims.sql
-- Phase 36.4 — fold approved TA/DA claim requests into compute_monthly_salary
-- 16 May 2026
--
-- Two fixes in one file:
--
-- 1. Phase 36 RPC referenced `daily_ta.ta_amount` which does NOT exist —
--    the column is `total_amount`. Bug shipped in Phase 36; without this
--    fix the salary RPC threw "column ta_amount does not exist" the
--    moment any rep had a daily_ta row for the month. Replace the wrong
--    column name with the correct one.
--
-- 2. Approved rep-side claim requests (ta_da_requests, Phase 34Z.37)
--    were sitting in the DB as an audit trail but didn't flow into the
--    monthly salary numbers. Admin approved a ₹700 DA night claim, but
--    /admin/salary still showed the GPS-only TA/DA total. Fix: add
--    SUM of approved claims for the month to v_ta_da.
--    - kind='da_night'    → claim_amount (₹, direct)
--    - kind='ta_override' → claim_km × 3  (flat bike-rate; matches
--                                          Phase 33I default of ₹3/km)
--
-- New JSON keys returned: ta_from_pings, ta_from_claims (so the admin
-- page can show the split if it wants to). `ta_da` total = sum of
-- both (back-compat).
--
-- Idempotent — CREATE OR REPLACE.

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
  v_ta_from_pings  numeric := 0;
  v_ta_from_claims numeric := 0;
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

  -- Base + variable via monthly_score (Phase 33E).
  SELECT * INTO v_score_row
    FROM public.monthly_score(p_user_id, v_month_start)
    LIMIT 1;
  v_monthly_salary := COALESCE(v_score_row.monthly_salary, 0);
  v_base           := COALESCE(v_score_row.base_amount, 0);
  v_variable       := COALESCE(v_score_row.variable_earned, 0);
  v_score_pct      := COALESCE(v_score_row.avg_score_pct, 0);
  v_working_days   := COALESCE(v_score_row.working_days, 0);

  -- Incentive payouts marked paid/approved this calendar month.
  SELECT COALESCE(SUM(amount), 0) INTO v_incentive
    FROM public.incentive_payouts
   WHERE user_id = p_user_id
     AND COALESCE(status, 'paid') IN ('paid', 'approved')
     AND COALESCE(payout_date, created_at::date)
         BETWEEN v_month_start AND v_month_end;

  -- TA/DA from GPS pings (daily_ta.total_amount; was wrongly `ta_amount`
  -- in Phase 36 — fixed here).
  SELECT COALESCE(SUM(total_amount), 0) INTO v_ta_from_pings
    FROM public.daily_ta
   WHERE user_id = p_user_id
     AND ta_date BETWEEN v_month_start AND v_month_end;

  -- Phase 36.4 — also include approved rep-side TA/DA claim requests.
  -- da_night  : claim_amount (₹) direct
  -- ta_override: claim_km × 3  (flat bike-rate matching Phase 33I default)
  SELECT COALESCE(SUM(
    CASE
      WHEN kind = 'da_night'    THEN COALESCE(claim_amount, 0)
      WHEN kind = 'ta_override' THEN COALESCE(claim_km, 0) * 3
      ELSE 0
    END
  ), 0) INTO v_ta_from_claims
    FROM public.ta_da_requests
   WHERE user_id = p_user_id
     AND status = 'approved'
     AND claim_date BETWEEN v_month_start AND v_month_end;

  v_ta_da := v_ta_from_pings + v_ta_from_claims;

  -- Approved leave days this month (half-day = 0.5).
  SELECT COALESCE(SUM(CASE WHEN is_half_day THEN 0.5 ELSE 1 END), 0)
    INTO v_leave_total
    FROM public.leaves
   WHERE user_id = p_user_id
     AND status = 'approved'
     AND leave_date BETWEEN v_month_start AND v_month_end;

  -- YTD paid quota consumed BEFORE this month.
  SELECT COALESCE(SUM(CASE WHEN is_half_day THEN 0.5 ELSE 1 END), 0)
    INTO v_paid_used_ytd
    FROM public.leaves
   WHERE user_id = p_user_id
     AND status = 'approved'
     AND leave_date >= v_fy_start
     AND leave_date <  v_month_start;

  -- Split this month's leave: paid first (up to remaining quota), rest unpaid.
  v_leave_paid   := LEAST(v_leave_total, GREATEST(0, v_paid_quota - v_paid_used_ytd));
  v_leave_unpaid := GREATEST(0, v_leave_total - v_leave_paid);

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
    'ta_from_pings',     v_ta_from_pings,
    'ta_from_claims',    v_ta_from_claims,
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

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────
-- Confirm the function exists + accepts the same signature.
SELECT
  proname,
  pronargs,
  pg_get_function_arguments(oid) AS args
  FROM pg_proc
 WHERE proname = 'compute_monthly_salary';

-- Smoke test (replace UUID with a real user_id):
-- SELECT compute_monthly_salary(
--   '00000000-0000-0000-0000-000000000000'::uuid, 2026, 5
-- );
