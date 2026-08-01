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
--    • Phase 184 Rule 1 — a SALES/TELECALLER whose this-month business
--      (new_client_revenue + renewal_revenue) >= 3 × monthly_salary earns the
--      FULL variable cap, score ignored. Other roles never get this override.
--    • variable_earned (when Rule 1 does NOT apply) — 0 working days → full cap
--      (avg forced 100); avg < 50 → 0; avg > 75 → full cap (Phase 270 Rule 3);
--      50–75 → (avg/100) × cap.
--    • avg + working_days from daily_performance WHERE is_excluded = false.
--    • monthly_salary from staff_incentive_profiles; business from monthly_sales_data.
--    • _assert_self_or_admin(p_user_id) gate. STABLE SECURITY DEFINER + pg_temp.
--
-- PROVENANCE: Phase 184 (2026-07-02) CHANGE — added Rule 1 (3×-business full
--    variable, sales/TC only) to the byte-captured phase97.2 body. Phase 270
--    (2026-07-28) CHANGE — added Rule 3 (score > 75% → full variable). Both
--    owner-approved + shadow-compared. Single signature (uuid, date) → RETURNS TABLE.
--    To revert Rule 3, delete the `ELSIF v_avg > 75 THEN … v_var_cap;` branch.
--    To revert Rule 1, delete the `v_role IN ('sales','telecaller') … >= v_salary * 3` branch.
--    RETROACTIVE: no effective-date gate — recomputes live for EVERY month queried
--    (both rules only RAISE variable for high scorers → no clawback, favorable).
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
  v_role    text;
  v_business numeric := 0;
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

  -- Phase 184 Rule 1 inputs: role + this month's business (new-client + renewal
  -- revenue). A sales/telecaller whose business >= 3x salary earns the FULL 30%
  -- variable regardless of daily score.
  -- Fail-closed on purpose: if the row is missing, v_role stays NULL and the
  -- `v_role IN (...)` allow-list below evaluates NULL → false, so Rule 1 simply
  -- doesn't fire. Do NOT "fix" this with a NULL branch — that would change behavior.
  SELECT role INTO v_role FROM public.users WHERE id = p_user_id;

  SELECT COALESCE(SUM(COALESCE(new_client_revenue,0) + COALESCE(renewal_revenue,0)), 0)
    INTO v_business
    FROM public.monthly_sales_data
   WHERE staff_id = p_user_id
     AND month_year = to_char(p_month_start, 'YYYY-MM');

  v_avg     := COALESCE(v_avg, 0);
  v_base    := v_salary * 0.70;
  v_var_cap := v_salary * 0.30;

  IF v_role IN ('sales','telecaller') AND v_salary > 0 AND v_business >= v_salary * 3 THEN
    -- Rule 1 (Phase 184): 3x-business override — full variable, score ignored (sales/TC only).
    v_var_earned := v_var_cap;
  ELSIF v_days = 0 THEN
    v_avg := 100;
    v_var_earned := v_var_cap;
  ELSIF v_avg < 50 THEN
    v_var_earned := 0;
  ELSIF v_avg > 75 THEN
    -- Rule 3 (Phase 270): score ABOVE 75% earns the FULL variable cap (owner
    -- 2026-07-28). 50–75% stays proportional (below); < 50% stays 0 (above).
    v_var_earned := v_var_cap;
  ELSE
    v_var_earned := (v_avg / 100.0) * v_var_cap;   -- 50–75% → proportional
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
--   pg_get_functiondef(p.oid) LIKE '%v_business >= v_salary * 3%' AS rule1_3x_override,
--   pg_get_functiondef(p.oid) LIKE '%v_avg > 75%'                 AS rule3_above75_full,
--   pg_get_functiondef(p.oid) LIKE '%v_avg < 50%'                 AS sub50_zero_variable,
--   pg_get_functiondef(p.oid) LIKE '%daily_performance%'          AS reads_daily_perf,
--   pg_get_functiondef(p.oid) LIKE '%staff_incentive_profiles%'   AS reads_salary_profile
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = 'monthly_score';
