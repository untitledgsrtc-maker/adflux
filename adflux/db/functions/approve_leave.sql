-- ============================================================================
-- db/functions/approve_leave.sql — CANONICAL HOME (Phase 178 / Stage 2)
-- ============================================================================
-- ⭐ The ONE place approve_leave lives (§71). Was in phase33l + phase97_2.
-- WHAT: admin/co_owner approves a pending leave row → status='approved' → recomputes
--   that day's compute_daily_score (an approved leave day is excluded from the score
--   denominator, so the rep isn't penalised).
-- 🔒 LOCKED: gate = admin / co_owner only (42501 on deny); only flips a row that
--   isn't already approved; PERFORM compute_daily_score(user, leave_date) AFTER —
--   keep the recompute (else the approved day still drags the score).
--
-- ✅ §41 NULL-guard CLOSED (Phase 209, 2026-07-06, security-advisor remediation):
--   the gate now `IF get_my_role() IS NULL OR ... NOT IN ('admin','co_owner')` so a
--   NULL-role (no users row / JWT-less) caller can no longer self-approve leave via
--   the 3-valued-logic hole. Matches accept_user_profile's §87.5b.1 pattern. Owner
--   surfaced it via the Supabase Security Advisor + approved the 1-line fix.
--
-- PROVENANCE: live dump 2026-06-24 (phase97_2 body). SECURITY DEFINER + pg_temp.
-- SUPERSEDES: supabase_phase33l_history_workflow.sql · supabase_phase97_2_rpc_role_gates.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.approve_leave(p_leave_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row record;
BEGIN
  -- §41 NULL-guard (Phase 209): a NULL-role caller must NOT slip through the
  -- 3-valued-logic hole (NULL NOT IN (...) → NULL → IF skips). Fail closed.
  IF public.get_my_role() IS NULL
     OR public.get_my_role() NOT IN ('admin', 'co_owner') THEN
    RAISE EXCEPTION 'Only admin/co_owner can approve leaves'
      USING ERRCODE = '42501';
  END IF;

  SELECT user_id, leave_date INTO v_row
    FROM leaves WHERE id = p_leave_id AND status <> 'approved';
  IF NOT FOUND THEN RETURN; END IF;

  UPDATE leaves SET status = 'approved' WHERE id = p_leave_id;

  PERFORM public.compute_daily_score(v_row.user_id, v_row.leave_date);
END $function$;

NOTIFY pgrst, 'reload schema';
-- VERIFY (all TRUE): gate present · recompute present · NULL-guard present.
SELECT
  position('admin/co_owner can approve' in pg_get_functiondef(oid)) > 0 AS has_gate,
  position('compute_daily_score'        in pg_get_functiondef(oid)) > 0 AS has_recompute,
  position('get_my_role() IS NULL'      in pg_get_functiondef(oid)) > 0 AS has_null_guard
FROM pg_proc WHERE proname = 'approve_leave' LIMIT 1;
