-- Phase 608 — Quote price approvals for the team manager (owner 18-11-2026:
-- "approval of quote not received to sales head" -> his 7 reps only).
-- Devang (team_role='sales_manager', is_sales_head OFF per Phase 563/564) now:
--   (1) sees + decides pending price requests on PRIVATE quotes created by reps whose
--       users.manager_id = him (never his own: same own-work rule as the Sales Head policy)
--   (2) gets the "Quote needs price approval" push for those requests
-- Admin + existing is_sales_head paths unchanged. ADDITIVE ONLY.

-- (1) policy helper: caller is an active team manager of the quote's creator, PRIVATE quote
CREATE OR REPLACE FUNCTION public.qpa_is_team_manager_of(p_quote_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.quotes q
      JOIN public.users rep ON rep.id = q.created_by
      JOIN public.users me  ON me.id = auth.uid()
     WHERE q.id = p_quote_id
       AND q.segment = 'PRIVATE'
       AND rep.manager_id = me.id
       AND me.team_role = 'sales_manager'
       AND me.is_active)
$$;
REVOKE ALL ON FUNCTION public.qpa_is_team_manager_of(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qpa_is_team_manager_of(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS qpa_manager_read ON public.quote_price_approvals;
CREATE POLICY qpa_manager_read ON public.quote_price_approvals
  FOR SELECT TO authenticated
  USING (public.qpa_is_team_manager_of(quote_id));

DROP POLICY IF EXISTS qpa_manager_decide ON public.quote_price_approvals;
CREATE POLICY qpa_manager_decide ON public.quote_price_approvals
  FOR UPDATE TO authenticated
  USING (
    public.qpa_is_team_manager_of(quote_id)
    AND status = 'pending'
    AND requested_by IS DISTINCT FROM (SELECT auth.uid())
  )
  WITH CHECK (public.qpa_is_team_manager_of(quote_id) AND status IN ('approved','rejected'));

-- (2) push: same function as Phase 360 + the creator's active team manager as a recipient
CREATE OR REPLACE FUNCTION public.qpa_notify_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_client text; v_rep text; v_mgr uuid; r record;
BEGIN
  IF NEW.status <> 'pending' THEN RETURN NEW; END IF;
  IF NOT public.is_push_allowed_now() THEN RETURN NEW; END IF;

  SELECT COALESCE(NULLIF(q.client_company,''), q.client_name, '-'), q.sales_person_name,
         CASE WHEN q.segment = 'PRIVATE' THEN rep.manager_id END
    INTO v_client, v_rep, v_mgr
    FROM public.quotes q LEFT JOIN public.users rep ON rep.id = q.created_by
   WHERE q.id = NEW.quote_id;

  FOR r IN
    SELECT u.id, (u.role = 'admin') AS is_admin
      FROM public.users u
     WHERE u.is_active
       AND (u.role = 'admin' OR u.is_sales_head = true
            OR (u.id = v_mgr AND u.team_role = 'sales_manager'))
       AND u.id IS DISTINCT FROM NEW.requested_by
  LOOP
    PERFORM public.enqueue_push(
      r.id,
      'Quote needs price approval',
      v_client || ' - from Rs ' || to_char(NEW.min_rate, 'FM999999990') || '/screen'
        || COALESCE(' - ' || v_rep, ''),
      CASE WHEN r.is_admin THEN '/pending-approvals' ELSE '/quote-approvals' END,
      'qpa-' || NEW.quote_id::text
    );
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'qpa_notify_request failed (ignored): %', SQLERRM;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.qpa_notify_request() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY: 6 policies (admin_all, owner_read, sales_head_read, sales_head_decide, manager_read, manager_decide)
SELECT count(*) AS qpa_policies FROM pg_policies WHERE tablename = 'quote_price_approvals';
