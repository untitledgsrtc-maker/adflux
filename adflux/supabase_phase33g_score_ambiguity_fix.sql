-- supabase_phase33g_score_ambiguity_fix.sql
--
-- Phase 33G.5 — fix "column reference user_id is ambiguous" on
-- /my-performance.
--
-- Root cause: monthly_score() declares user_id as a RETURNS TABLE
-- column. Inside the function body, the two `WHERE user_id = p_user_id`
-- clauses (one on daily_performance, one on staff_incentive_profiles)
-- collided with that return-column name. Postgres treats the function-
-- output names as in-scope inside the body, so it can't decide which
-- user_id you mean.
--
-- Fix: qualify both references with the table name. No logic change,
-- no signature change, no RLS change — pure ambiguity resolution.
--
-- Run order: this REPLACES the function from supabase_phase33e_performance_score.sql.
-- Safe to run on top of Phase 33E. Idempotent (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION public.monthly_score(
  p_user_id uuid, p_month_start date
) RETURNS TABLE (
  user_id          uuid,
  month_start      date,
  working_days     int,
  avg_score_pct    numeric,
  monthly_salary   numeric,
  base_amount      numeric,
  variable_cap     numeric,
  variable_earned  numeric,
  total_payable    numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_avg     numeric := 0;
  v_days    int := 0;
  v_salary  numeric := 0;
  v_base    numeric;
  v_var_cap numeric;
  v_var_earned numeric;
BEGIN
  -- Phase 33G.5 — qualified daily_performance.user_id to avoid the
  -- ambiguity with the RETURNS TABLE column also named user_id.
  SELECT AVG(score_pct), COUNT(*)
    INTO v_avg, v_days
    FROM daily_performance dp
   WHERE dp.user_id = p_user_id
     AND dp.work_date >= p_month_start
     AND dp.work_date < (p_month_start + INTERVAL '1 month')
     AND dp.is_excluded = false;

  -- Same fix here — qualified staff_incentive_profiles.user_id.
  SELECT COALESCE(sip.monthly_salary, 0) INTO v_salary
    FROM staff_incentive_profiles sip
   WHERE sip.user_id = p_user_id;

  v_base    := v_salary * 0.70;
  v_var_cap := v_salary * 0.30;

  -- No working days (whole month leave) → full variable.
  IF v_days = 0 THEN
    v_avg := 100;
    v_var_earned := v_var_cap;
  -- Below 50% threshold → zero variable.
  ELSIF v_avg < 50 THEN
    v_var_earned := 0;
  -- Above 50% → linear scale (avg/100) × variable cap.
  ELSE
    v_var_earned := (v_avg / 100.0) * v_var_cap;
  END IF;

  RETURN QUERY
  SELECT p_user_id, p_month_start, v_days,
         ROUND(v_avg, 1), v_salary, ROUND(v_base, 0),
         ROUND(v_var_cap, 0), ROUND(v_var_earned, 0),
         ROUND(v_base + v_var_earned, 0);
END $$;

GRANT EXECUTE ON FUNCTION public.monthly_score(uuid, date) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY:
-- SELECT * FROM public.monthly_score(auth.uid(), date_trunc('month', current_date)::date);
-- Expect: 1 row, no error.
