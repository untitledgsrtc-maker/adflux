-- supabase_phase28c_telecaller_quote_rls.sql
--
-- Phase 28c — extend the "sales/agency own-quote" RLS pattern to
-- include 'telecaller' (and 'sales_manager' for completeness).
--
-- Symptom: a telecaller (Rima) tried to save a GSRTC LED proposal
-- and got "new row violates row-level security policy for table
-- 'quotes'". Phase 11g pinned the policy to ('sales', 'agency')
-- only; Phase 26b added the 'telecaller' role to users but never
-- updated the RLS pattern, so telecallers could create leads but
-- couldn't escalate to a quote.
--
-- This migration touches 5 tables:
--   1. quotes                      (FOR ALL → own rows)
--   2. quote_cities                (FOR ALL → own rows via parent)
--   3. payments                    (SELECT / INSERT / UPDATE / DELETE
--                                   → own rows via parent)
--   4. clients                     (SELECT / INSERT / UPDATE
--                                   → own rows via created_by)
--   5. staff_incentive_profiles    (SELECT own profile)
--
-- Policy bodies are unchanged except for the role list:
--     OLD:  get_my_role() IN ('sales', 'agency')
--     NEW:  get_my_role() IN ('sales', 'agency', 'telecaller', 'sales_manager')
--
-- Storage (quote-attachments bucket) does NOT need updating — its
-- policy uses created_by = auth.uid() regardless of role, so the
-- moment a telecaller-owned quote exists they can upload to its
-- folder.
--
-- Idempotent.

-- ─────────────────────────────────────────────────────────────────
-- 1) quotes
-- ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "quotes_sales_own" ON public.quotes;
CREATE POLICY "quotes_sales_own" ON public.quotes FOR ALL
  USING (
    public.get_my_role() IN ('sales', 'agency', 'telecaller', 'sales_manager')
    AND created_by = auth.uid()
  )
  WITH CHECK (
    public.get_my_role() IN ('sales', 'agency', 'telecaller', 'sales_manager')
    AND created_by = auth.uid()
  );

-- ─────────────────────────────────────────────────────────────────
-- 2) quote_cities
-- ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "qc_sales_own" ON public.quote_cities;
CREATE POLICY "qc_sales_own" ON public.quote_cities FOR ALL
  USING (
    public.get_my_role() IN ('sales', 'agency', 'telecaller', 'sales_manager')
    AND quote_id IN (SELECT id FROM public.quotes WHERE created_by = auth.uid())
  )
  WITH CHECK (
    public.get_my_role() IN ('sales', 'agency', 'telecaller', 'sales_manager')
    AND quote_id IN (SELECT id FROM public.quotes WHERE created_by = auth.uid())
  );

-- ─────────────────────────────────────────────────────────────────
-- 3) payments — four separate policies (read / insert / update / delete)
-- ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "payments_sales_read_own" ON public.payments;
CREATE POLICY "payments_sales_read_own" ON public.payments FOR SELECT
  USING (
    public.get_my_role() IN ('sales', 'agency', 'telecaller', 'sales_manager')
    AND quote_id IN (SELECT id FROM public.quotes WHERE created_by = auth.uid())
  );

DROP POLICY IF EXISTS "payments_sales_insert_own" ON public.payments;
CREATE POLICY "payments_sales_insert_own" ON public.payments FOR INSERT
  WITH CHECK (
    public.get_my_role() IN ('sales', 'agency', 'telecaller', 'sales_manager')
    AND quote_id IN (SELECT id FROM public.quotes WHERE created_by = auth.uid())
    AND approval_status = 'pending'
  );

DROP POLICY IF EXISTS "payments_sales_update_own" ON public.payments;
CREATE POLICY "payments_sales_update_own" ON public.payments FOR UPDATE
  USING (
    public.get_my_role() IN ('sales', 'agency', 'telecaller', 'sales_manager')
    AND quote_id IN (SELECT id FROM public.quotes WHERE created_by = auth.uid())
    AND approval_status = 'pending'
  );

DROP POLICY IF EXISTS "payments_sales_delete_own" ON public.payments;
CREATE POLICY "payments_sales_delete_own" ON public.payments FOR DELETE
  USING (
    public.get_my_role() IN ('sales', 'agency', 'telecaller', 'sales_manager')
    AND quote_id IN (SELECT id FROM public.quotes WHERE created_by = auth.uid())
    AND approval_status = 'pending'
  );

-- ─────────────────────────────────────────────────────────────────
-- 4) clients — read / insert / update by created_by
-- ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "clients_sales_read_own" ON public.clients;
CREATE POLICY "clients_sales_read_own" ON public.clients FOR SELECT
  USING (
    public.get_my_role() IN ('sales', 'agency', 'telecaller', 'sales_manager')
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS "clients_sales_insert_own" ON public.clients;
CREATE POLICY "clients_sales_insert_own" ON public.clients FOR INSERT
  WITH CHECK (
    public.get_my_role() IN ('sales', 'agency', 'telecaller', 'sales_manager')
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS "clients_sales_update_own" ON public.clients;
CREATE POLICY "clients_sales_update_own" ON public.clients FOR UPDATE
  USING (
    public.get_my_role() IN ('sales', 'agency', 'telecaller', 'sales_manager')
    AND created_by = auth.uid()
  );

-- ─────────────────────────────────────────────────────────────────
-- 5) staff_incentive_profiles — telecallers may have their own profile
--    so My Performance can compute their target. Policy reads by user_id.
-- ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "sip_sales_read_own" ON public.staff_incentive_profiles;
CREATE POLICY "sip_sales_read_own" ON public.staff_incentive_profiles FOR SELECT
  USING (
    public.get_my_role() IN ('sales', 'agency', 'telecaller', 'sales_manager')
    AND user_id = auth.uid()
  );

NOTIFY pgrst, 'reload schema';

-- VERIFY:
-- SELECT polname, polcmd, pg_get_expr(polqual, polrelid) AS using_expr
--   FROM pg_policy
--  WHERE polrelid = 'public.quotes'::regclass;
--
-- As Rima (telecaller), opening a fresh GSRTC LED quote should now
-- save without "new row violates row-level security policy" error.
