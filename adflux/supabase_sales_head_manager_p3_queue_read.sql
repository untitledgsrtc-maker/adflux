-- =====================================================================
-- Sales Head P3a FIX — approval-queue READ (2026-08-10)
-- =====================================================================
-- The P3a approve/reject RPCs are is_sales_head()-gated, but the queue PAGES
-- (LeavesAdminV2 / TaPayoutsAdminV2) load leaves / daily_ta / ta_da_requests via
-- DIRECT client SELECT — RLS-scoped to the caller's OWN rows. A Sales Head
-- (telecaller, no personal leave/TA rows) sees EMPTY queues → she can't pick
-- anything to approve (silent blank page). Guardian-caught.
--
-- FIX: additive FOR SELECT policies gated on is_sales_head() so she READS every
-- rep's pending leaves + TA (she's the intended approver — spec §5 all sales+TC,
-- no sub-team filter). Permissive OR → normal reps / admin / accounts / hr are
-- BYTE-UNCHANGED (only Jayna has the flag). No write policy added — writes still
-- flow ONLY through the gated DEFINER RPCs. Prereq: is_sales_head() (P1 grant).
-- =====================================================================

DROP POLICY IF EXISTS leaves_sales_head_read ON public.leaves;
CREATE POLICY leaves_sales_head_read ON public.leaves
  FOR SELECT USING (public.is_sales_head());

DROP POLICY IF EXISTS daily_ta_sales_head_read ON public.daily_ta;
CREATE POLICY daily_ta_sales_head_read ON public.daily_ta
  FOR SELECT USING (public.is_sales_head());

DROP POLICY IF EXISTS ta_requests_sales_head_read ON public.ta_da_requests;
CREATE POLICY ta_requests_sales_head_read ON public.ta_da_requests
  FOR SELECT USING (public.is_sales_head());

NOTIFY pgrst, 'reload schema';

-- VERIFY: 3 SELECT policies present, each gated on is_sales_head().
SELECT
  (SELECT count(*) FROM pg_policies WHERE tablename='leaves'         AND policyname='leaves_sales_head_read')     AS leaves_pol,
  (SELECT count(*) FROM pg_policies WHERE tablename='daily_ta'       AND policyname='daily_ta_sales_head_read')   AS daily_ta_pol,
  (SELECT count(*) FROM pg_policies WHERE tablename='ta_da_requests' AND policyname='ta_requests_sales_head_read') AS ta_req_pol,
  (SELECT bool_and(qual LIKE '%is_sales_head%') FROM pg_policies
     WHERE policyname IN ('leaves_sales_head_read','daily_ta_sales_head_read','ta_requests_sales_head_read'))     AS all_gated;
