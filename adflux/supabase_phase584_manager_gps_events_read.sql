-- =====================================================================
-- Phase 584 — sales manager can read his reps' GPS-off / network-off events
-- =====================================================================
-- The GPS track page (/admin/gps/:userId) now opens for a sales manager for
-- his assigned reps (users.manager_id). Its timeline also shows GPS-off and
-- internet-off events; those tables only allowed self / admin / hr, so the
-- manager saw blank rows. Add read-only policies scoped to his reps.
-- Same pattern as supabase_phase564 (cached is_sales_manager() first, so
-- other users short-circuit).
-- =====================================================================

DROP POLICY IF EXISTS gps_off_events_manager_read ON public.gps_off_events;
CREATE POLICY gps_off_events_manager_read ON public.gps_off_events FOR SELECT USING (
  (SELECT public.is_sales_manager())
  AND user_id IN (SELECT id FROM public.users WHERE manager_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS network_off_events_manager_read ON public.network_off_events;
CREATE POLICY network_off_events_manager_read ON public.network_off_events FOR SELECT USING (
  (SELECT public.is_sales_manager())
  AND user_id IN (SELECT id FROM public.users WHERE manager_id = (SELECT auth.uid())));

NOTIFY pgrst, 'reload schema';

-- VERIFY: both policies present.
SELECT count(*) AS policies FROM pg_policies
 WHERE policyname IN ('gps_off_events_manager_read', 'network_off_events_manager_read');
