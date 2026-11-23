-- ============================================================================
-- db/functions/reject_leave.sql — CANONICAL HOME (Sales Head P3, 2026-08-07)
-- ============================================================================
-- ⭐ The ONE place reject_leave lives (§71). NEW — LeavesAdminV2's reject was a
--   direct UPDATE with no RPC; this gives it a gated counterpart so a Sales Head
--   (manager P3) can reject her team's leaves without a broad leaves-write policy.
-- WHAT: admin / co_owner / sales-head rejects a pending leave → status='rejected'
--   (+ optional admin_note) → recompute that day's compute_daily_score (a rejected
--   leave day is NOT excluded, so the score reflects it). Mirrors approve_leave.
-- 🔒 §41 NULL-guard: fail-closed on a NULL role (the `role IS NULL OR` short-circuit).
-- ============================================================================

-- Phase 644 (2026-11-23): gate also admits is_team_head_of(row owner) = an active
-- team_role='sales_manager' deciding for HIS reps (manager_id = him), never his own; the
-- score recompute runs under a transaction-local app.score_for = rep id so
-- _assert_self_or_admin lets it through (see supabase_phase644_team_head_approvals.sql).
CREATE OR REPLACE FUNCTION public.reject_leave(p_leave_id uuid, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row record;
BEGIN
  SELECT user_id, leave_date, status INTO v_row FROM leaves WHERE id = p_leave_id;

  IF public.get_my_role() IS NULL
     OR (public.get_my_role() NOT IN ('admin', 'co_owner')
         AND NOT public.is_sales_head()
         AND NOT public.is_team_head_of(v_row.user_id)) THEN
    RAISE EXCEPTION 'Only admin/co_owner/sales-head can reject leaves'
      USING ERRCODE = '42501';
  END IF;

  IF v_row.user_id IS NULL OR v_row.status = 'rejected' THEN RETURN; END IF;

  UPDATE leaves
     SET status = 'rejected',
         admin_note = COALESCE(NULLIF(BTRIM(p_note), ''), admin_note)
   WHERE id = p_leave_id;

  PERFORM set_config('app.score_for', v_row.user_id::text, true);
  PERFORM public.compute_daily_score(v_row.user_id, v_row.leave_date);
  PERFORM set_config('app.score_for', '', true);
END $$;

GRANT EXECUTE ON FUNCTION public.reject_leave(uuid, text) TO authenticated;
NOTIFY pgrst, 'reload schema';

-- VERIFY (all TRUE): fn present · sales-head gate · NULL-guard · recompute.
SELECT
  to_regprocedure('public.reject_leave(uuid,text)') IS NOT NULL          AS fn_present,
  position('NOT public.is_sales_head' in pg_get_functiondef(p.oid)) > 0  AS admits_sales_head,
  position('get_my_role() IS NULL'    in pg_get_functiondef(p.oid)) > 0  AS has_null_guard,
  position('compute_daily_score'      in pg_get_functiondef(p.oid)) > 0  AS has_recompute
FROM pg_proc p WHERE p.proname = 'reject_leave' LIMIT 1;
