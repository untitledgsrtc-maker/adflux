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

CREATE OR REPLACE FUNCTION public.reject_leave(p_leave_id uuid, p_note text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row record;
BEGIN
  IF public.get_my_role() IS NULL
     OR (public.get_my_role() NOT IN ('admin', 'co_owner') AND NOT public.is_sales_head()) THEN
    RAISE EXCEPTION 'Only admin/co_owner/sales-head can reject leaves'
      USING ERRCODE = '42501';
  END IF;

  SELECT user_id, leave_date INTO v_row
    FROM leaves WHERE id = p_leave_id AND status <> 'rejected';
  IF NOT FOUND THEN RETURN; END IF;

  UPDATE leaves
     SET status = 'rejected',
         admin_note = COALESCE(NULLIF(BTRIM(p_note), ''), admin_note)
   WHERE id = p_leave_id;

  PERFORM public.compute_daily_score(v_row.user_id, v_row.leave_date);
END $function$;

GRANT EXECUTE ON FUNCTION public.reject_leave(uuid, text) TO authenticated;
NOTIFY pgrst, 'reload schema';

-- VERIFY (all TRUE): fn present · sales-head gate · NULL-guard · recompute.
SELECT
  to_regprocedure('public.reject_leave(uuid,text)') IS NOT NULL          AS fn_present,
  position('NOT public.is_sales_head' in pg_get_functiondef(p.oid)) > 0  AS admits_sales_head,
  position('get_my_role() IS NULL'    in pg_get_functiondef(p.oid)) > 0  AS has_null_guard,
  position('compute_daily_score'      in pg_get_functiondef(p.oid)) > 0  AS has_recompute
FROM pg_proc p WHERE p.proname = 'reject_leave' LIMIT 1;
