-- =====================================================================
-- Sales Head — MANAGER module, P3: TA/DA approval RPCs (2026-08-07)
-- Owner-approved. Spec: docs/SALES_HEAD_MANAGER_SPEC.md §1 (approvals).
-- =====================================================================
-- Gated DEFINER RPCs so a Sales Head (is_sales_head=true) can approve/reject her
-- team's TA-DA — WITHOUT a broad daily_ta / ta_da_requests write policy (spec §3;
-- the §84/§150 broad-RLS trap). admin/accounts/hr keep their EXISTING direct-UPDATE
-- path in TaPayoutsAdminV2 UNCHANGED (§45) — these RPCs are the Sales-Head branch.
-- Gate = admin/co_owner OR is_sales_head, §41 NULL fail-closed. Prereq:
-- supabase_sales_head_manager_p1.sql (is_sales_head()). Leaves: db/functions/
-- approve_leave.sql (widened) + reject_leave.sql (new) are separate re-runs.
-- =====================================================================

-- bulk-approve pending daily_ta rows (the ₹3/km + DA + hotel payout rows)
CREATE OR REPLACE FUNCTION public.sales_head_approve_ta_rows(p_ids uuid[])
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_n integer;
BEGIN
  IF public.get_my_role() IS NULL
     OR (public.get_my_role() NOT IN ('admin','co_owner') AND NOT public.is_sales_head()) THEN
    RAISE EXCEPTION 'Only admin/co_owner/sales-head can approve TA rows' USING ERRCODE='42501';
  END IF;
  UPDATE public.daily_ta
     SET status='approved', approved_by=auth.uid(), approved_at=now()
   WHERE id = ANY(p_ids) AND status <> 'approved';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $fn$;
GRANT EXECUTE ON FUNCTION public.sales_head_approve_ta_rows(uuid[]) TO authenticated;

-- approve a single ta_da_requests claim
CREATE OR REPLACE FUNCTION public.sales_head_approve_ta_request(p_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
BEGIN
  IF public.get_my_role() IS NULL
     OR (public.get_my_role() NOT IN ('admin','co_owner') AND NOT public.is_sales_head()) THEN
    RAISE EXCEPTION 'Only admin/co_owner/sales-head can approve TA claims' USING ERRCODE='42501';
  END IF;
  UPDATE public.ta_da_requests
     SET status='approved', decided_at=now(), decided_by=auth.uid()
   WHERE id = p_id AND status <> 'approved';
END $fn$;
GRANT EXECUTE ON FUNCTION public.sales_head_approve_ta_request(uuid) TO authenticated;

-- reject a single ta_da_requests claim (with an optional note for the rep)
CREATE OR REPLACE FUNCTION public.sales_head_reject_ta_request(p_id uuid, p_note text DEFAULT NULL)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
BEGIN
  IF public.get_my_role() IS NULL
     OR (public.get_my_role() NOT IN ('admin','co_owner') AND NOT public.is_sales_head()) THEN
    RAISE EXCEPTION 'Only admin/co_owner/sales-head can reject TA claims' USING ERRCODE='42501';
  END IF;
  UPDATE public.ta_da_requests
     SET status='rejected', admin_note=NULLIF(BTRIM(p_note),''), decided_at=now(), decided_by=auth.uid()
   WHERE id = p_id AND status <> 'rejected';
END $fn$;
GRANT EXECUTE ON FUNCTION public.sales_head_reject_ta_request(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY (all TRUE): 3 fns present + each fail-closed on NULL role + admits sales-head
SELECT
  to_regprocedure('public.sales_head_approve_ta_rows(uuid[])')    IS NOT NULL AS f_rows,
  to_regprocedure('public.sales_head_approve_ta_request(uuid)')   IS NOT NULL AS f_appr,
  to_regprocedure('public.sales_head_reject_ta_request(uuid,text)') IS NOT NULL AS f_rej,
  (SELECT bool_and(position('get_my_role() IS NULL' in pg_get_functiondef(oid))>0
                   AND position('is_sales_head' in pg_get_functiondef(oid))>0)
     FROM pg_proc WHERE proname IN
       ('sales_head_approve_ta_rows','sales_head_approve_ta_request','sales_head_reject_ta_request')) AS all_gated;
