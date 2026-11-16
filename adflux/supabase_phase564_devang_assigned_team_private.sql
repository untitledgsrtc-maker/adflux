-- =====================================================================
-- Phase 564 — Devang sees ONLY his assigned reps, PRIVATE data only (2026-11-16)
-- =====================================================================
-- Owner: all sales + telecallers EXCEPT Gandhinagar are assigned to Devang
-- (users.manager_id). He must see only those people's data, private segment
-- only. Supersedes the team-wide Sales Head idea for Devang (flags stay OFF).
--   (1) assign 7 reps to Devang (manager_id) — Gandhinagar left unassigned
--   (2) leads: manager rules (ALL + UPDATE) limited to segment='PRIVATE'
--   (3) NEW read-only manager policies for his assigned reps' quotes,
--       quote_cities, follow_ups, lead_activities, payments, gps_pings,
--       daily_performance, daily_ta — no Government rows (via segment)
-- ADDITIVE for everyone else: each new policy starts with the cached
-- (SELECT is_sales_manager()) so non-managers short-circuit (no extra work).
-- No write access added except what leads_manager_* already gave.
-- =====================================================================

-- (1) assignment (idempotent; only fills empty manager_id)
UPDATE public.users u
   SET manager_id = (SELECT id FROM public.users WHERE name = 'Devang' AND team_role = 'sales_manager' AND is_active)
 WHERE u.is_active
   AND u.role IN ('sales','telecaller')
   AND u.team_role IN ('sales','telecaller')
   AND u.name <> 'Gandhinagar'
   AND u.manager_id IS NULL;

-- (2) leads: private-only
DROP POLICY IF EXISTS leads_manager_team ON public.leads;
CREATE POLICY leads_manager_team ON public.leads
  FOR ALL
  USING (
    (SELECT public.is_sales_manager())
    AND segment = 'PRIVATE'
    AND ( assigned_to IN (SELECT id FROM public.users WHERE manager_id = (SELECT auth.uid()))
       OR telecaller_id IN (SELECT id FROM public.users WHERE manager_id = (SELECT auth.uid()))
       OR assigned_to = (SELECT auth.uid()) OR telecaller_id = (SELECT auth.uid()) )
  );

DROP POLICY IF EXISTS leads_manager_update ON public.leads;
CREATE POLICY leads_manager_update ON public.leads
  FOR UPDATE
  USING (
    (SELECT public.is_sales_manager()) AND segment = 'PRIVATE'
    AND ( assigned_to IN (SELECT id FROM public.users WHERE manager_id = (SELECT auth.uid()))
       OR telecaller_id IN (SELECT id FROM public.users WHERE manager_id = (SELECT auth.uid())) ))
  WITH CHECK (
    (SELECT public.is_sales_manager()) AND segment = 'PRIVATE'
    AND ( assigned_to IN (SELECT id FROM public.users WHERE manager_id = (SELECT auth.uid()))
       OR telecaller_id IN (SELECT id FROM public.users WHERE manager_id = (SELECT auth.uid())) ));

-- (3) read-only team policies
DROP POLICY IF EXISTS quotes_manager_read ON public.quotes;
CREATE POLICY quotes_manager_read ON public.quotes FOR SELECT USING (
  (SELECT public.is_sales_manager()) AND segment = 'PRIVATE'
  AND created_by IN (SELECT id FROM public.users WHERE manager_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS qc_manager_read ON public.quote_cities;
CREATE POLICY qc_manager_read ON public.quote_cities FOR SELECT USING (
  (SELECT public.is_sales_manager()) AND EXISTS (
    SELECT 1 FROM public.quotes q WHERE q.id = quote_cities.quote_id AND q.segment = 'PRIVATE'
      AND q.created_by IN (SELECT id FROM public.users WHERE manager_id = (SELECT auth.uid()))));

DROP POLICY IF EXISTS payments_manager_read ON public.payments;
CREATE POLICY payments_manager_read ON public.payments FOR SELECT USING (
  (SELECT public.is_sales_manager()) AND EXISTS (
    SELECT 1 FROM public.quotes q WHERE q.id = payments.quote_id AND q.segment = 'PRIVATE'
      AND q.created_by IN (SELECT id FROM public.users WHERE manager_id = (SELECT auth.uid()))));

DROP POLICY IF EXISTS follow_ups_manager_read ON public.follow_ups;
CREATE POLICY follow_ups_manager_read ON public.follow_ups FOR SELECT USING (
  (SELECT public.is_sales_manager())
  AND assigned_to IN (SELECT id FROM public.users WHERE manager_id = (SELECT auth.uid()))
  AND (lead_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.id = follow_ups.lead_id AND l.segment <> 'PRIVATE')));

DROP POLICY IF EXISTS lead_activities_manager_read ON public.lead_activities;
CREATE POLICY lead_activities_manager_read ON public.lead_activities FOR SELECT USING (
  (SELECT public.is_sales_manager())
  AND created_by IN (SELECT id FROM public.users WHERE manager_id = (SELECT auth.uid()))
  AND (lead_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_activities.lead_id AND l.segment <> 'PRIVATE')));

DROP POLICY IF EXISTS gps_pings_manager_read ON public.gps_pings;
CREATE POLICY gps_pings_manager_read ON public.gps_pings FOR SELECT USING (
  (SELECT public.is_sales_manager())
  AND user_id IN (SELECT id FROM public.users WHERE manager_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS daily_performance_manager_read ON public.daily_performance;
CREATE POLICY daily_performance_manager_read ON public.daily_performance FOR SELECT USING (
  (SELECT public.is_sales_manager())
  AND user_id IN (SELECT id FROM public.users WHERE manager_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS daily_ta_manager_read ON public.daily_ta;
CREATE POLICY daily_ta_manager_read ON public.daily_ta FOR SELECT USING (
  (SELECT public.is_sales_manager())
  AND user_id IN (SELECT id FROM public.users WHERE manager_id = (SELECT auth.uid())));

NOTIFY pgrst, 'reload schema';

-- VERIFY: 7 reps under Devang, Gandhinagar not; 9 new/limited policies present.
SELECT
  (SELECT count(*) FROM public.users WHERE manager_id = (SELECT id FROM public.users WHERE name='Devang' AND team_role='sales_manager')) AS reps_under_devang,
  (SELECT manager_id IS NULL FROM public.users WHERE name='Gandhinagar') AS gandhinagar_unassigned,
  (SELECT count(*) FROM pg_policies WHERE policyname IN ('quotes_manager_read','qc_manager_read','payments_manager_read','follow_ups_manager_read','lead_activities_manager_read','gps_pings_manager_read','daily_performance_manager_read','daily_ta_manager_read')) AS new_policies,
  (SELECT bool_and(qual LIKE '%PRIVATE%') FROM pg_policies WHERE policyname IN ('leads_manager_team','leads_manager_update')) AS leads_private;
