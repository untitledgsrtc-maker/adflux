-- ============================================================================
-- db/functions/eligible_for_paid_leave.sql — CANONICAL HOME (Phase 178 / Stage 2)
-- ============================================================================
-- ⭐ The ONE place eligible_for_paid_leave lives (§71). Was in phase36_10 + phase97_2.
-- WHAT: returns true if the user has crossed the §36.10 PAID-leave tenure gate —
--   join_date <= today − 9 months. Drives the paid-vs-unpaid leave choice + the
--   compute_monthly_salary unpaid-deduction split.
-- 🔒 LOCKED: 9-month tenure window (§36.10 — Indian probation norm; don't change
--   without owner sign-off, it moves pay). §97.2 `_assert_self_or_admin(p_user_id)`
--   gate (a rep checks only their own eligibility; admin checks anyone). STABLE.
-- PROVENANCE: live dump 2026-06-24 (phase97_2 body). SECURITY DEFINER + pg_temp.
-- SUPERSEDES: supabase_phase36_10_paid_leave_tenure.sql · supabase_phase97_2_rpc_role_gates.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eligible_for_paid_leave(p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public._assert_self_or_admin(p_user_id);
  RETURN COALESCE(
    (SELECT join_date <= (CURRENT_DATE - INTERVAL '9 months')
       FROM public.staff_incentive_profiles
      WHERE user_id = p_user_id),
    false
  );
END $function$;

NOTIFY pgrst, 'reload schema';
-- VERIFY: LIKE '%_assert_self_or_admin%' (gate) AND '%9 months%' (tenure) — both TRUE.
