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

-- Phase 644 (2026-11-23): gate also admits is_team_head_of(row owner) = an active
-- team_role='sales_manager' deciding for HIS reps (manager_id = him), never his own; the
-- score recompute runs under a transaction-local app.score_for = rep id so
-- _assert_self_or_admin lets it through (see supabase_phase644_team_head_approvals.sql).
CREATE OR REPLACE FUNCTION public.approve_leave(p_leave_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row record;
BEGIN
  SELECT user_id, leave_date, status INTO v_row FROM leaves WHERE id = p_leave_id;

  -- §41 NULL-guard kept: a NULL role never passes.
  IF public.get_my_role() IS NULL
     OR (public.get_my_role() NOT IN ('admin', 'co_owner')
         AND NOT public.is_sales_head()
         AND NOT public.is_team_head_of(v_row.user_id)) THEN
    RAISE EXCEPTION 'Only admin/co_owner/sales-head can approve leaves'
      USING ERRCODE = '42501';
  END IF;

  IF v_row.user_id IS NULL OR v_row.status = 'approved' THEN RETURN; END IF;

  UPDATE leaves SET status = 'approved' WHERE id = p_leave_id;

  PERFORM set_config('app.score_for', v_row.user_id::text, true);
  PERFORM public.compute_daily_score(v_row.user_id, v_row.leave_date);
  PERFORM set_config('app.score_for', '', true);
END $$;

NOTIFY pgrst, 'reload schema';
-- VERIFY (all TRUE): gate present · sales-head widen · recompute · NULL-guard.
SELECT
  position('can approve leaves'    in pg_get_functiondef(oid)) > 0 AS has_gate,
  position('NOT public.is_sales_head' in pg_get_functiondef(oid)) > 0 AS admits_sales_head,
  position('compute_daily_score'   in pg_get_functiondef(oid)) > 0 AS has_recompute,
  position('get_my_role() IS NULL' in pg_get_functiondef(oid)) > 0 AS has_null_guard
FROM pg_proc WHERE proname = 'approve_leave' LIMIT 1;
