-- ============================================================================
-- db/functions/monthly_score.sql — CANONICAL HOME (Phase 178 / Stage 2)
-- ============================================================================
--
-- ⭐ The ONE place monthly_score is allowed to live. EDIT THIS FILE to change it;
--    never re-paste it into a new phaseN file (§71). It lived in 3 phase files
--    (phase33e, phase33g_score_ambiguity_fix, phase97_2).
--
-- 💰 MONEY-ADJACENT — monthly_score is the INPUT to compute_monthly_salary: its
--    _compute_monthly_salary_base reads this function's base_amount + variable_earned
--    + avg_score_pct + working_days. A change here moves salary. Per §71 rule 3, a
--    future CHANGE needs shadow-compare + owner-verify. THIS commit is a CAPTURE,
--    not a change — byte-for-byte the live function (dumped 2026-06-23), zero DB run.
--
-- WHAT IT DOES: returns the monthly score breakdown for (user, month_start) —
--    working_days, avg_score_pct (from daily_performance, excluding off/holiday
--    days), and the 70/30 salary split.
--
-- LOCKED CONTRACTS (a diff that changes any is owner-sign-off):
--    • 70/30 split — base = monthly_salary × 0.70, variable cap = × 0.30.
--    • variable_earned — 0 working days → full cap (avg forced 100); avg < 50 → 0;
--      else (avg/100) × cap (proportional to the average daily score).
--    • avg + working_days from daily_performance WHERE is_excluded = false.
--    • monthly_salary from staff_incentive_profiles.
--    • _assert_self_or_admin(p_user_id) gate. STABLE SECURITY DEFINER + pg_temp.
--
-- PROVENANCE: captured byte-for-byte from the LIVE DB 2026-06-23 (the phase97.2
--    version). Single signature (uuid, date) → RETURNS TABLE. Running this = NO-OP.
--
-- SUPERSEDES (Phase 178 removed the body from each):
--      supabase_phase33e_performance_score.sql
--      supabase_phase33g_score_ambiguity_fix.sql
--      supabase_phase97_2_rpc_role_gates.sql
--
-- REVERT: re-run this file. TRIPWIRE: VERIFY block at the bottom.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.monthly_score(p_user_id uuid, p_month_start date)
 RETURNS TABLE(user_id uuid, month_start date, working_days integer, avg_score_pct numeric, monthly_salary numeric, base_amount numeric, variable_cap numeric, variable_earned numeric, total_payable numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_avg     numeric := 0;
  v_days    int := 0;
  v_salary  numeric := 0;
  v_base    numeric;
  v_var_cap numeric;
  v_var_earned numeric;
BEGIN
  PERFORM public._assert_self_or_admin(p_user_id);

  SELECT AVG(score_pct), COUNT(*)
    INTO v_avg, v_days
    FROM daily_performance dp
   WHERE dp.user_id = p_user_id
     AND dp.work_date >= p_month_start
     AND dp.work_date < (p_month_start + INTERVAL '1 month')
     AND dp.is_excluded = false;

  SELECT COALESCE(sip.monthly_salary, 0) INTO v_salary
    FROM staff_incentive_profiles sip
   WHERE sip.user_id = p_user_id;

  v_base    := v_salary * 0.70;
  v_var_cap := v_salary * 0.30;

  IF v_days = 0 THEN
    v_avg := 100;
    v_var_earned := v_var_cap;
  ELSIF v_avg < 50 THEN
    v_var_earned := 0;
  ELSE
    v_var_earned := (v_avg / 100.0) * v_var_cap;
  END IF;

  RETURN QUERY
  SELECT p_user_id, p_month_start, v_days,
         ROUND(v_avg, 1), v_salary, ROUND(v_base, 0),
         ROUND(v_var_cap, 0), ROUND(v_var_earned, 0),
         ROUND(v_base + v_var_earned, 0);
END $function$;

GRANT EXECUTE ON FUNCTION public.monthly_score(uuid, date) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY / TRIPWIRE — read-only, run any time. All six must be TRUE.
-- ============================================================================
-- SELECT
--   pg_get_functiondef(p.oid) LIKE '%_assert_self_or_admin%'      AS auth_gate,
--   pg_get_functiondef(p.oid) LIKE '%* 0.70%'                     AS base_70,
--   pg_get_functiondef(p.oid) LIKE '%* 0.30%'                     AS variable_cap_30,
--   pg_get_functiondef(p.oid) LIKE '%v_avg < 50%'                 AS sub50_zero_variable,
--   pg_get_functiondef(p.oid) LIKE '%daily_performance%'          AS reads_daily_perf,
--   pg_get_functiondef(p.oid) LIKE '%staff_incentive_profiles%'   AS reads_salary_profile
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = 'monthly_score';
