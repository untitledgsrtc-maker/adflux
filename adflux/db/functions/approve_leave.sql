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
-- ⚠️ KNOWN GAP (captured AS-IS, NOT fixed here — owner's call):
--   This gate is `IF get_my_role() NOT IN ('admin','co_owner')` with NO `IS NULL OR`
--   arm — the §41 3-valued-logic foot-gun. A caller whose get_my_role() is NULL
--   (no users row / JWT-less) gets `NULL NOT IN (...)` → NULL → IF skips → gate
--   BYPASSED. Practical exposure is low (every authenticated rep has a non-NULL
--   role), but it should match accept_user_profile's §87.5b.1 pattern. Hardening =
--   add `public.get_my_role() IS NULL OR` to the IF — a 1-line CHANGE (run in
--   Studio), deliberately separate from this capture. Flagged to owner 2026-06-24.
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
  IF public.get_my_role() NOT IN ('admin', 'co_owner') THEN
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
-- VERIFY: LIKE '%admin/co_owner can approve%' (gate) AND
--         '%compute_daily_score%' (recompute) — both TRUE.
-- NOTE: deliberately NOT asserting an IS NULL arm — see KNOWN GAP above.
