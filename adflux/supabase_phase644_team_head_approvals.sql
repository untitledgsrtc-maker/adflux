-- =============================================================================
-- Phase 644 · Sales head approves HIS reps' leaves + TA/DA (2026-11-23, owner-approved)
--
-- Owner: "sales head complete role" -> approvals for his reps, payments stay with
-- the owner, Gandhinagar / Govt / agency stay out, new Private hires report to him.
--
-- 1. public.is_team_head_of(uuid): caller is an ACTIVE team_role='sales_manager'
--    AND the target's manager_id = caller AND target <> caller (never his own).
-- 2. The 5 existing gated approval RPCs (approve_leave, reject_leave,
--    sales_head_approve_ta_request, sales_head_reject_ta_request,
--    sales_head_approve_ta_rows) also accept is_team_head_of(row owner).
--    admin / co_owner / is_sales_head paths are unchanged. NULL role fails closed.
-- 3. NEW sales_head_reject_ta_rows(uuid[]) (reject a travel day) - same gate.
-- 4. Leave approve/reject recompute the rep's day score. compute_daily_score's
--    self-or-admin gate (_assert_self_or_admin) refused any non-admin, so the
--    Sales Head path always failed. approve/reject_leave now set a transaction-
--    local setting app.score_for = <rep id> just for that call; the gate accepts
--    ONLY that exact user id. No client can set it (no exposed function sets it).
-- 5. Drops leaves_manager_update + ta_requests_manager_update: they let a sales
--    manager UPDATE any column (dates, amounts) of his reps' rows directly. The
--    app now uses the RPCs above, so the broad write is no longer needed.
-- 6. New Private sales / telecaller users get manager_id = the one active Private
--    sales head, when no manager was chosen (BEFORE INSERT on users).
--
-- Not touched: payments, salary, TA amounts, mark-paid, city ceilings.
-- Safe to re-run.
-- =============================================================================

BEGIN;

-- 1 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_team_head_of(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_user IS NOT NULL
     AND p_user <> auth.uid()
     AND EXISTS (SELECT 1 FROM public.users me
                  WHERE me.id = auth.uid() AND me.team_role = 'sales_manager' AND me.is_active = true)
     AND EXISTS (SELECT 1 FROM public.users r
                  WHERE r.id = p_user AND r.manager_id = auth.uid())
$$;
REVOKE ALL ON FUNCTION public.is_team_head_of(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_team_head_of(uuid) TO authenticated;

-- 4 (gate) -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._assert_self_or_admin(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF public.get_my_role() NOT IN ('admin', 'co_owner', 'accounts')
     AND p_user_id <> auth.uid()
     -- Phase 644: set only inside approve_leave / reject_leave, for that one rep.
     AND p_user_id::text IS DISTINCT FROM NULLIF(current_setting('app.score_for', true), '') THEN
    RAISE EXCEPTION 'Restricted: cannot access another user''s data (caller=%, target=%)',
                    auth.uid(), p_user_id USING ERRCODE = '42501';
  END IF;
END $$;

-- 2 (leaves) ---------------------------------------------------------------
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

-- 2 (TA claims) ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sales_head_approve_ta_request(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_user uuid;
BEGIN
  SELECT user_id INTO v_user FROM public.ta_da_requests WHERE id = p_id;
  IF public.get_my_role() IS NULL
     OR (public.get_my_role() NOT IN ('admin','co_owner')
         AND NOT public.is_sales_head()
         AND NOT public.is_team_head_of(v_user)) THEN
    RAISE EXCEPTION 'Only admin/co_owner/sales-head can approve TA claims' USING ERRCODE='42501';
  END IF;
  UPDATE public.ta_da_requests
     SET status='approved', decided_at=now(), decided_by=auth.uid()
   WHERE id = p_id AND status <> 'approved';
END $$;

CREATE OR REPLACE FUNCTION public.sales_head_reject_ta_request(p_id uuid, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_user uuid;
BEGIN
  SELECT user_id INTO v_user FROM public.ta_da_requests WHERE id = p_id;
  IF public.get_my_role() IS NULL
     OR (public.get_my_role() NOT IN ('admin','co_owner')
         AND NOT public.is_sales_head()
         AND NOT public.is_team_head_of(v_user)) THEN
    RAISE EXCEPTION 'Only admin/co_owner/sales-head can reject TA claims' USING ERRCODE='42501';
  END IF;
  UPDATE public.ta_da_requests
     SET status='rejected', admin_note=NULLIF(BTRIM(p_note),''), decided_at=now(), decided_by=auth.uid()
   WHERE id = p_id AND status <> 'rejected';
END $$;

CREATE OR REPLACE FUNCTION public.sales_head_approve_ta_rows(p_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_n integer;
BEGIN
  IF public.get_my_role() IS NULL
     OR (public.get_my_role() NOT IN ('admin','co_owner')
         AND NOT public.is_sales_head()
         AND (p_ids IS NULL OR cardinality(p_ids) = 0
              OR EXISTS (SELECT 1 FROM public.daily_ta d
                          WHERE d.id = ANY(p_ids) AND NOT public.is_team_head_of(d.user_id)))) THEN
    RAISE EXCEPTION 'Only admin/co_owner/sales-head can approve TA rows' USING ERRCODE='42501';
  END IF;
  UPDATE public.daily_ta
     SET status='approved', approved_by=auth.uid(), approved_at=now()
   WHERE id = ANY(p_ids) AND status <> 'approved';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- 3 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sales_head_reject_ta_rows(p_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_n integer;
BEGIN
  IF public.get_my_role() IS NULL
     OR (public.get_my_role() NOT IN ('admin','co_owner')
         AND NOT public.is_sales_head()
         AND (p_ids IS NULL OR cardinality(p_ids) = 0
              OR EXISTS (SELECT 1 FROM public.daily_ta d
                          WHERE d.id = ANY(p_ids) AND NOT public.is_team_head_of(d.user_id)))) THEN
    RAISE EXCEPTION 'Only admin/co_owner/sales-head can reject TA rows' USING ERRCODE='42501';
  END IF;
  UPDATE public.daily_ta
     SET status='rejected'
   WHERE id = ANY(p_ids) AND status = 'pending';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

REVOKE ALL ON FUNCTION public.approve_leave(uuid), public.reject_leave(uuid, text),
  public.sales_head_approve_ta_request(uuid), public.sales_head_reject_ta_request(uuid, text),
  public.sales_head_approve_ta_rows(uuid[]), public.sales_head_reject_ta_rows(uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_leave(uuid), public.reject_leave(uuid, text),
  public.sales_head_approve_ta_request(uuid), public.sales_head_reject_ta_request(uuid, text),
  public.sales_head_approve_ta_rows(uuid[]), public.sales_head_reject_ta_rows(uuid[])
  TO authenticated;

-- 5 -------------------------------------------------------------------------
DROP POLICY IF EXISTS leaves_manager_update ON public.leaves;
DROP POLICY IF EXISTS ta_requests_manager_update ON public.ta_da_requests;

-- 6 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.users_auto_team_head()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_head uuid;
BEGIN
  IF NEW.manager_id IS NULL
     AND NEW.role IN ('sales', 'telecaller')
     AND COALESCE(NEW.team_role, '') <> 'sales_manager'
     AND NEW.segment_access = 'PRIVATE'
     -- a brand-new person only: admin_create_user's ON CONFLICT re-run must not
     -- overwrite an existing person's manager.
     AND NOT EXISTS (SELECT 1 FROM public.users x WHERE x.id = NEW.id) THEN
    -- Only when there is exactly ONE active Private sales head (no guessing).
    SELECT CASE WHEN count(*) = 1 THEN min(id::text)::uuid END INTO v_head
      FROM public.users
     WHERE team_role = 'sales_manager' AND is_active = true AND segment_access = 'PRIVATE';
    IF v_head IS NOT NULL AND v_head <> NEW.id THEN
      NEW.manager_id := v_head;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.users_auto_team_head() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_users_auto_team_head ON public.users;
CREATE TRIGGER trg_users_auto_team_head
  BEFORE INSERT ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.users_auto_team_head();

COMMIT;

NOTIFY pgrst, 'reload schema';

-- VERIFY:
-- SELECT proname FROM pg_proc WHERE proname IN ('is_team_head_of','sales_head_reject_ta_rows','users_auto_team_head');  -- 3 rows
-- SELECT count(*) FROM pg_policies WHERE policyname IN ('leaves_manager_update','ta_requests_manager_update');     -- 0
-- SELECT tgname FROM pg_trigger WHERE tgname = 'trg_users_auto_team_head';                                         -- 1 row
