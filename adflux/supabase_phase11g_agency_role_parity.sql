-- =====================================================================
-- ADFLUX → UNTITLED OS  •  PHASE 11g
-- Agency role — sales-equivalent access for partner channel
-- =====================================================================
--
-- WHY (owner spec, 4 May 2026):
--   "i want one more role / agency / its same like sale person but
--    just name agency"
--
--   Phase 8E added 'agency' to users_role_check, but only as a
--   signature option — RLS and the incentive-profile trigger were
--   never extended. Result: agency users couldn't see their own
--   quotes (RLS blocked them), couldn't insert payments, didn't
--   auto-get an incentive profile. This migration brings agency to
--   full parity with sales for ownership, payments, and incentives.
--
-- DESIGN:
--   1. auto_create_incentive_profile trigger fires for sales OR agency
--      (drops the role <> 'sales' early-return).
--   2. RLS policies that name 'sales' get a sister policy (or the
--      check broadens to include 'agency').
--      Affected policies (from grep): quotes_sales_own,
--      qc_sales_own, payments_sales_read_own, payments_sales_insert_own,
--      payments_sales_update_own, payments_sales_delete_own,
--      sip_sales_own, ip_sales_own, fu_sales_own, msd_sales_own.
--   3. We use a helper get_my_role() IN ('sales','agency') pattern.
--
-- IDEMPOTENT — DROP + CREATE on every policy.
-- =====================================================================


-- 1) Trigger: auto-create incentive profile for sales OR agency ------
CREATE OR REPLACE FUNCTION public.auto_create_incentive_profile()
RETURNS TRIGGER AS $$
DECLARE
  s incentive_settings%ROWTYPE;
BEGIN
  IF NEW.role NOT IN ('sales', 'agency') THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM staff_incentive_profiles WHERE user_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  SELECT * INTO s FROM incentive_settings LIMIT 1;

  INSERT INTO staff_incentive_profiles (
    user_id, monthly_salary, sales_multiplier,
    new_client_rate, renewal_rate, flat_bonus,
    join_date, is_active
  ) VALUES (
    NEW.id, 0,
    COALESCE(s.default_multiplier, 5),
    COALESCE(s.new_client_rate, 0.05),
    COALESCE(s.renewal_rate, 0.02),
    COALESCE(s.default_flat_bonus, 10000),
    CURRENT_DATE, true
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- 2) RLS — quotes ----------------------------------------------------
DROP POLICY IF EXISTS "quotes_sales_own"   ON public.quotes;
CREATE POLICY "quotes_sales_own" ON public.quotes FOR ALL
  USING (public.get_my_role() IN ('sales', 'agency') AND created_by = auth.uid());


-- 3) RLS — quote_cities ----------------------------------------------
DROP POLICY IF EXISTS "qc_sales_own" ON public.quote_cities;
CREATE POLICY "qc_sales_own" ON public.quote_cities FOR ALL
  USING (
    public.get_my_role() IN ('sales', 'agency') AND
    quote_id IN (SELECT id FROM public.quotes WHERE created_by = auth.uid())
  );


-- 4) RLS — payments (read / insert / update / delete) ---------------
DROP POLICY IF EXISTS "payments_sales_read_own"   ON public.payments;
CREATE POLICY "payments_sales_read_own" ON public.payments FOR SELECT
  USING (
    public.get_my_role() IN ('sales', 'agency')
    AND quote_id IN (SELECT id FROM public.quotes WHERE created_by = auth.uid())
  );

DROP POLICY IF EXISTS "payments_sales_insert_own" ON public.payments;
CREATE POLICY "payments_sales_insert_own" ON public.payments FOR INSERT
  WITH CHECK (
    public.get_my_role() IN ('sales', 'agency')
    AND quote_id IN (SELECT id FROM public.quotes WHERE created_by = auth.uid())
    AND approval_status = 'pending'
  );

DROP POLICY IF EXISTS "payments_sales_update_own" ON public.payments;
CREATE POLICY "payments_sales_update_own" ON public.payments FOR UPDATE
  USING (
    public.get_my_role() IN ('sales', 'agency')
    AND quote_id IN (SELECT id FROM public.quotes WHERE created_by = auth.uid())
    AND approval_status = 'pending'
  );

DROP POLICY IF EXISTS "payments_sales_delete_own" ON public.payments;
CREATE POLICY "payments_sales_delete_own" ON public.payments FOR DELETE
  USING (
    public.get_my_role() IN ('sales', 'agency')
    AND quote_id IN (SELECT id FROM public.quotes WHERE created_by = auth.uid())
    AND approval_status = 'pending'
  );


-- 5) RLS — staff_incentive_profiles (own row) ------------------------
DROP POLICY IF EXISTS "sip_sales_own" ON public.staff_incentive_profiles;
CREATE POLICY "sip_sales_own" ON public.staff_incentive_profiles FOR SELECT
  USING (public.get_my_role() IN ('sales', 'agency') AND user_id = auth.uid());


-- 6) RLS — incentive_payouts (own row) -------------------------------
DROP POLICY IF EXISTS "ip_sales_own" ON public.incentive_payouts;
CREATE POLICY "ip_sales_own" ON public.incentive_payouts FOR SELECT
  USING (public.get_my_role() IN ('sales', 'agency') AND staff_id = auth.uid());


-- 7) RLS — follow_ups (own quotes) -----------------------------------
DROP POLICY IF EXISTS "fu_sales_own" ON public.follow_ups;
CREATE POLICY "fu_sales_own" ON public.follow_ups FOR ALL
  USING (
    public.get_my_role() IN ('sales', 'agency')
    AND assigned_to = auth.uid()
  );


-- 8) RLS — monthly_sales_data (own row) ------------------------------
DROP POLICY IF EXISTS "msd_sales_own" ON public.monthly_sales_data;
CREATE POLICY "msd_sales_own" ON public.monthly_sales_data FOR SELECT
  USING (public.get_my_role() IN ('sales', 'agency') AND staff_id = auth.uid());


-- 9) Tell PostgREST to refresh the cache so the new policies become
--    immediately effective on the API surface.
NOTIFY pgrst, 'reload schema';


-- =====================================================================
-- VERIFY:
--
--   -- As an agency user, this should return their own quotes:
--   SELECT id, quote_number FROM quotes WHERE created_by = auth.uid();
--
--   -- Check trigger fires:
--   INSERT INTO users (id, name, email, role) VALUES
--     (uuid_generate_v4(), 'Test Agency', 'agencytest@x.com', 'agency');
--   SELECT * FROM staff_incentive_profiles
--    WHERE user_id = (SELECT id FROM users WHERE email = 'agencytest@x.com');
--   -- expect 1 row with monthly_salary=0, defaults from incentive_settings
--
-- =====================================================================
