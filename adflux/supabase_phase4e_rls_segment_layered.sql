-- =====================================================================
-- ADFLUX → UNTITLED OS  •  PHASE 4E   (FINAL of Sprint 1)
-- Migration: layered RLS — wire segment_access into quote/payment ACLs
-- =====================================================================
--
-- WHAT THIS DOES:
--   Replaces the sales-side RLS policies on quotes / quote_cities /
--   payments / follow_ups with segment-aware versions. Admin policies
--   stay untouched (admin always sees all).
--
--   New rule for sales role: must own the quote AND have segment_access
--   that matches the quote's segment (or be 'ALL').
--
--     sales user with segment_access='PRIVATE'
--       → only sees their own quotes WHERE segment='PRIVATE'
--     sales user with segment_access='GOVERNMENT'
--       → only sees their own quotes WHERE segment='GOVERNMENT'
--     sales user with segment_access='ALL'
--       → sees all their own quotes regardless of segment
--
-- DECISIONS BEHIND THIS:
--   - Policy NAMES retained (drop-then-create) so any debugging by
--     policy name continues to work. Only the USING clause changes.
--   - Uses get_my_segment_access() helper from phase4b — SECURITY
--     DEFINER, mirrors the existing get_my_role() pattern.
--   - 'ALL' bypasses the segment check entirely. Useful as an escape
--     hatch and for the admin user (who is already at 'ALL' from
--     phase4b backfill).
--   - Defensive: if get_my_segment_access() ever returns NULL,
--     NULL IN ('ALL', segment) is NULL → policy denies access.
--
-- WHAT THIS DOES *NOT* TOUCH:
--   - Admin policies (quotes_admin_all, qc_admin_all, etc.)
--   - users / cities / staff_incentive_profiles / monthly_sales_data
--     / incentive_settings — segment doesn't apply at this stage.
--   - Master tables from phase4c — already RLS'd correctly.
--   - Triggers, indexes, sequences — no behavior change.
--
-- IDEMPOTENT.
-- =====================================================================


-- 1) QUOTES — sales sees own quotes + segment match ------------------
DROP POLICY IF EXISTS "quotes_sales_own" ON public.quotes;
CREATE POLICY "quotes_sales_own" ON public.quotes FOR ALL
  USING (
    public.get_my_role() = 'sales'
    AND created_by = auth.uid()
    AND public.get_my_segment_access() IN ('ALL', segment)
  );


-- 2) QUOTE_CITIES — sales sees line items of own quotes + seg match --
DROP POLICY IF EXISTS "qc_sales_own" ON public.quote_cities;
CREATE POLICY "qc_sales_own" ON public.quote_cities FOR ALL
  USING (
    public.get_my_role() = 'sales'
    AND quote_id IN (
      SELECT id FROM public.quotes
       WHERE created_by = auth.uid()
         AND public.get_my_segment_access() IN ('ALL', segment)
    )
  );


-- 3) PAYMENTS — sales reads/inserts on own quotes + seg match --------
DROP POLICY IF EXISTS "payments_sales_read_own"   ON public.payments;
CREATE POLICY "payments_sales_read_own" ON public.payments FOR SELECT
  USING (
    public.get_my_role() = 'sales'
    AND quote_id IN (
      SELECT id FROM public.quotes
       WHERE created_by = auth.uid()
         AND public.get_my_segment_access() IN ('ALL', segment)
    )
  );

DROP POLICY IF EXISTS "payments_sales_insert_own" ON public.payments;
CREATE POLICY "payments_sales_insert_own" ON public.payments FOR INSERT
  WITH CHECK (
    public.get_my_role() = 'sales'
    AND quote_id IN (
      SELECT id FROM public.quotes
       WHERE created_by = auth.uid()
         AND public.get_my_segment_access() IN ('ALL', segment)
    )
  );


-- 4) FOLLOW_UPS — assignee + own-quote segment check -----------------
DROP POLICY IF EXISTS "fu_sales_own" ON public.follow_ups;
CREATE POLICY "fu_sales_own" ON public.follow_ups FOR ALL
  USING (
    public.get_my_role() = 'sales'
    AND assigned_to = auth.uid()
    AND quote_id IN (
      SELECT id FROM public.quotes
       WHERE public.get_my_segment_access() IN ('ALL', segment)
    )
  );


-- =====================================================================
-- VERIFY:
--
--   -- 1. Confirm new policies exist with expected names
--   SELECT tablename, policyname, cmd
--     FROM pg_policies
--    WHERE schemaname = 'public'
--      AND tablename IN ('quotes', 'quote_cities', 'payments', 'follow_ups')
--      AND policyname LIKE '%sales%'
--    ORDER BY tablename, policyname;
--
--   -- expected (5 rows):
--   --   follow_ups   | fu_sales_own              | ALL
--   --   payments     | payments_sales_insert_own | INSERT
--   --   payments     | payments_sales_read_own   | SELECT
--   --   quote_cities | qc_sales_own              | ALL
--   --   quotes       | quotes_sales_own          | ALL
--
--   -- 2. Confirm helper functions exist
--   SELECT proname
--     FROM pg_proc
--    WHERE proname IN ('get_my_role', 'get_my_segment_access')
--    ORDER BY 1;
--   -- expect 2 rows
--
-- FUNCTIONAL TESTING (after Sprint 2 wizard + a real seed user):
--   - Create user with role='sales', segment_access='PRIVATE'.
--     Insert a Private quote — visible. Insert a Government quote
--     attempt — denied by RLS / CHECK constraint.
--   - Create user with segment_access='GOVERNMENT'. Mirror.
--   - Admin user — sees both segments.
-- =====================================================================
