-- ============================================================================
-- supabase_ops_p8_approvals.sql — Operation-head approves the FIELD TEAM's
-- leave + TA/DA (owner "manage 10 techs" brainstorm, 2026-08-28).
-- ============================================================================
-- Gated DEFINER RPCs so an operation_head can approve/reject their team's leave
-- + TA/DA claims — WITHOUT a broad leaves / ta_da_requests write policy (the
-- §84/§150 broad-RLS trap; the §172 sales-head pattern). Additive, self-contained.
--
-- TIGHT SCOPE (money-safety): every write is JOINed to users.role =
-- 'operation_executive', so an operation_head can ONLY ever touch a FIELD TECH's
-- row — never a sales rep's leave/TA. admin/co_owner keep their existing
-- admin/HR/accounts approval path UNCHANGED (§45); these are the ops branch.
--
-- Does NOT edit the frozen approve_leave/reject_leave canonical (§72) — the ops
-- leave RPCs just CALL compute_daily_score (an approved/rejected leave day must be
-- re-scored so the exec isn't penalised), same as the canonical does. No math copy.
--
-- Gate = admin / co_owner / operation_head, §41 NULL fail-closed. TA needs no
-- recompute — the ta_da_requests status-change trigger (§36.8) recomputes daily_ta.
-- Idempotent (CREATE OR REPLACE). Owner runs it.
-- ============================================================================

-- ── read: pending ops leave + TA claims (for the command center + approvals page)
CREATE OR REPLACE FUNCTION public.ops_pending_approvals()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_role text := public.get_my_role();
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin', 'co_owner', 'operation_head') THEN
    RETURN '{}'::jsonb;
  END IF;
  RETURN jsonb_build_object(
    'leaves', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', l.id, 'name', u.name, 'leave_date', l.leave_date, 'leave_type', l.leave_type,
        'reason', l.reason, 'is_half_day', l.is_half_day, 'is_paid_request', l.is_paid_request,
        'created_at', l.created_at
      ) ORDER BY l.leave_date)
      FROM public.leaves l
      JOIN public.users u ON u.id = l.user_id AND u.role = 'operation_executive' AND u.is_active
      WHERE l.status = 'pending'
    ), '[]'::jsonb),
    'ta', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', u.name, 'claim_date', t.claim_date, 'kind', t.kind,
        'claim_km', t.claim_km, 'claim_amount', t.claim_amount, 'city', t.city,
        'reason', t.reason, 'receipt_url', t.receipt_url, 'created_at', t.created_at
      ) ORDER BY t.claim_date)
      FROM public.ta_da_requests t
      JOIN public.users u ON u.id = t.user_id AND u.role = 'operation_executive' AND u.is_active
      WHERE t.status = 'pending'
    ), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL     ON FUNCTION public.ops_pending_approvals() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.ops_pending_approvals() TO authenticated;

-- ── approve a field tech's leave ──
CREATE OR REPLACE FUNCTION public.ops_approve_leave(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_role text := public.get_my_role(); v_uid uuid; v_date date;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin', 'co_owner', 'operation_head') THEN
    RAISE EXCEPTION 'Only ops-head/admin can approve field leave' USING ERRCODE = '42501';
  END IF;
  -- the JOIN scopes it to a FIELD TECH's leave only (never a sales rep's)
  SELECT l.user_id, l.leave_date INTO v_uid, v_date
    FROM public.leaves l
    JOIN public.users u ON u.id = l.user_id AND u.role = 'operation_executive' AND u.is_active
   WHERE l.id = p_id AND l.status <> 'approved';
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public.leaves SET status = 'approved' WHERE id = p_id;
  PERFORM public.compute_daily_score(v_uid, v_date);
END;
$$;
REVOKE ALL     ON FUNCTION public.ops_approve_leave(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.ops_approve_leave(uuid) TO authenticated;

-- ── reject a field tech's leave (optional note) ──
CREATE OR REPLACE FUNCTION public.ops_reject_leave(p_id uuid, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_role text := public.get_my_role(); v_uid uuid; v_date date;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin', 'co_owner', 'operation_head') THEN
    RAISE EXCEPTION 'Only ops-head/admin can reject field leave' USING ERRCODE = '42501';
  END IF;
  SELECT l.user_id, l.leave_date INTO v_uid, v_date
    FROM public.leaves l
    JOIN public.users u ON u.id = l.user_id AND u.role = 'operation_executive' AND u.is_active
   WHERE l.id = p_id AND l.status <> 'rejected';
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public.leaves
     SET status = 'rejected', admin_note = COALESCE(NULLIF(BTRIM(p_note), ''), admin_note)
   WHERE id = p_id;
  PERFORM public.compute_daily_score(v_uid, v_date);
END;
$$;
REVOKE ALL     ON FUNCTION public.ops_reject_leave(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.ops_reject_leave(uuid, text) TO authenticated;

-- ── approve a field tech's TA/DA claim ──
CREATE OR REPLACE FUNCTION public.ops_approve_ta_request(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_role text := public.get_my_role();
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin', 'co_owner', 'operation_head') THEN
    RAISE EXCEPTION 'Only ops-head/admin can approve field TA' USING ERRCODE = '42501';
  END IF;
  UPDATE public.ta_da_requests t
     SET status = 'approved', decided_at = now(), decided_by = auth.uid()
   WHERE t.id = p_id AND t.status <> 'approved'
     AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = t.user_id AND u.role = 'operation_executive' AND u.is_active);
END;
$$;
REVOKE ALL     ON FUNCTION public.ops_approve_ta_request(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.ops_approve_ta_request(uuid) TO authenticated;

-- ── reject a field tech's TA/DA claim (optional note) ──
CREATE OR REPLACE FUNCTION public.ops_reject_ta_request(p_id uuid, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_role text := public.get_my_role();
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin', 'co_owner', 'operation_head') THEN
    RAISE EXCEPTION 'Only ops-head/admin can reject field TA' USING ERRCODE = '42501';
  END IF;
  UPDATE public.ta_da_requests t
     SET status = 'rejected', admin_note = COALESCE(NULLIF(BTRIM(p_note), ''), admin_note), decided_at = now(), decided_by = auth.uid()
   WHERE t.id = p_id AND t.status <> 'rejected'
     AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = t.user_id AND u.role = 'operation_executive' AND u.is_active);
END;
$$;
REVOKE ALL     ON FUNCTION public.ops_reject_ta_request(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.ops_reject_ta_request(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY (all TRUE): 5 fns present · all SECURITY DEFINER · all fail-closed on NULL role
-- SELECT
--   to_regprocedure('public.ops_pending_approvals()')          IS NOT NULL AS f_read,
--   to_regprocedure('public.ops_approve_leave(uuid)')          IS NOT NULL AS f_appr_lv,
--   to_regprocedure('public.ops_reject_leave(uuid,text)')      IS NOT NULL AS f_rej_lv,
--   to_regprocedure('public.ops_approve_ta_request(uuid)')     IS NOT NULL AS f_appr_ta,
--   to_regprocedure('public.ops_reject_ta_request(uuid,text)') IS NOT NULL AS f_rej_ta,
--   (SELECT bool_and(prosecdef AND position('v_role IS NULL' in pg_get_functiondef(oid)) > 0)
--      FROM pg_proc WHERE proname IN ('ops_pending_approvals','ops_approve_leave','ops_reject_leave',
--                                     'ops_approve_ta_request','ops_reject_ta_request')) AS all_gated;
-- ============================================================================
