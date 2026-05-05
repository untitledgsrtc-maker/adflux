-- =====================================================================
-- Phase 11i — clients RLS parity for the 'agency' role
-- =====================================================================
--
-- Why this exists
-- ---------------
-- Phase 11g extended quotes / quote_cities / payments / etc. policies
-- to recognise both 'sales' and 'agency' as quote-creating roles. But
-- the `clients` table policies were missed — they still only check
-- get_my_role() = 'sales'.
--
-- Symptom: a user with role='agency' creates a proposal successfully
-- (quotes RLS lets them), but syncClientFromQuote silently fails on
-- the `clients` insert (RLS denial), so the new client never shows
-- up in /clients.
--
-- Fix: rebuild the three sales policies as ('sales','agency') variants,
-- so anything that's true for sales is also true for agency.
--
-- IDEMPOTENT — DROP + CREATE on every policy.
-- =====================================================================

DROP POLICY IF EXISTS "clients_admin_all"        ON public.clients;
DROP POLICY IF EXISTS "clients_sales_select_own" ON public.clients;
DROP POLICY IF EXISTS "clients_sales_insert_own" ON public.clients;
DROP POLICY IF EXISTS "clients_sales_update_own" ON public.clients;

-- 1) Admin sees and manages everything (unchanged).
CREATE POLICY "clients_admin_all" ON public.clients
  FOR ALL USING (public.get_my_role() = 'admin');

-- 2) Sales OR agency: SELECT only their own client rows.
CREATE POLICY "clients_sales_select_own" ON public.clients
  FOR SELECT USING (
    public.get_my_role() IN ('sales', 'agency')
    AND created_by = auth.uid()
  );

-- 3) Sales OR agency: INSERT rows where they own the row.
CREATE POLICY "clients_sales_insert_own" ON public.clients
  FOR INSERT WITH CHECK (
    public.get_my_role() IN ('sales', 'agency')
    AND created_by = auth.uid()
  );

-- 4) Sales OR agency: UPDATE only their own rows.
CREATE POLICY "clients_sales_update_own" ON public.clients
  FOR UPDATE USING (
    public.get_my_role() IN ('sales', 'agency')
    AND created_by = auth.uid()
  );

-- Refresh PostgREST so the policies become live without restart.
NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- VERIFY:
--   -- As an agency user (after switching their JWT), should return rows:
--   SELECT id, name FROM clients WHERE created_by = auth.uid();
--
--   -- After creating a quote with a phone the agency user has never
--   -- seen, the syncClientFromQuote insert should succeed silently.
-- =====================================================================
