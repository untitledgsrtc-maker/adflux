-- Phase 587 — Sales manager (Devang) reads his assigned reps' clients (2026-11-17)
-- Clients page showed 0 for Devang: clients were readable only by their creator or
-- admin. Read-only, same team scope as Phase 564 (users.manager_id = me). His reps are
-- PRIVATE-segment (segment_access) so their client book is the private book; clients
-- has no segment column. Edit/delete stay own-only (clients_sales_update_own unchanged).
-- Additive: no existing policy touched.

DROP POLICY IF EXISTS clients_manager_read ON public.clients;
CREATE POLICY clients_manager_read ON public.clients FOR SELECT USING (
  (SELECT public.is_sales_manager())
  AND created_by IN (SELECT id FROM public.users WHERE manager_id = (SELECT auth.uid())));

NOTIFY pgrst, 'reload schema';

-- VERIFY:
-- SELECT policyname FROM pg_policies WHERE tablename='clients' AND policyname='clients_manager_read';  -- 1 row
