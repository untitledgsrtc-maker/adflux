-- ============================================================================
-- Phase 182 — Accounts role: payroll / finance surface grant (ADDITIVE)
-- ============================================================================
-- Gives role='accounts' admin-level access to the PAYROLL/FINANCE surface only:
-- view + edit amounts + PAY salary / TA-DA / incentives, and APPROVE + PAY TA
-- claims. Nothing operational (leads / calls / work_sessions / quote-writes /
-- campaigns / HR sign-off / user-mint / P&L).
--
-- RLS is OR/permissive → these ADD accounts policies. Every existing admin,
-- co_owner, self, HR, manager, sales, and govt_partner policy is UNTOUCHED, so
-- admin access stays byte-identical (§45). Idempotent (§8): DROP POLICY IF
-- EXISTS then CREATE.
--
-- TWO-PART CHANGE — run BOTH:
--   1) the _assert_self_or_admin widening (its home = supabase_phase97_2_
--      rpc_role_gates.sql, lines ~86-107; add 'accounts' to the IN list). The
--      payroll RPCs (compute_monthly_salary / monthly_score / compute_daily_ta
--      / compute_daily_score / eligible_for_paid_leave / _compute_monthly_
--      salary_base) gate on it — without this accounts gets 42501 on every read.
--      Per §71 the helper lives in ONE file (phase97_2); this file does NOT
--      re-paste it. Run that helper block once (given in chat / from phase97_2).
--   2) this file (the 13 additive table policies below).
--
-- 'accounts' is already a legal users.role (users_role_check, §97.E) — no
-- constraint change. city_da_ceilings SKIPPED (ceilings_read_all already admits
-- all authenticated for SELECT). users.salary write NOT granted (users RLS is
-- column-pinned §97.1); salary edits flow through staff_incentive_profiles.
-- ============================================================================

-- ---- WRITE tables (FOR ALL) --------------------------------------------------

DROP POLICY IF EXISTS daily_ta_accounts_all ON public.daily_ta;
CREATE POLICY daily_ta_accounts_all ON public.daily_ta
  FOR ALL USING (public.get_my_role() = 'accounts')
  WITH CHECK (public.get_my_role() = 'accounts');

DROP POLICY IF EXISTS incentive_payouts_accounts_all ON public.incentive_payouts;
CREATE POLICY incentive_payouts_accounts_all ON public.incentive_payouts
  FOR ALL USING (public.get_my_role() = 'accounts')
  WITH CHECK (public.get_my_role() = 'accounts');

DROP POLICY IF EXISTS salary_payouts_accounts_all ON public.salary_payouts;
CREATE POLICY salary_payouts_accounts_all ON public.salary_payouts
  FOR ALL USING (public.get_my_role() = 'accounts')
  WITH CHECK (public.get_my_role() = 'accounts');

DROP POLICY IF EXISTS ta_da_requests_accounts_all ON public.ta_da_requests;
CREATE POLICY ta_da_requests_accounts_all ON public.ta_da_requests
  FOR ALL USING (public.get_my_role() = 'accounts')
  WITH CHECK (public.get_my_role() = 'accounts');

DROP POLICY IF EXISTS leaves_accounts_all ON public.leaves;
CREATE POLICY leaves_accounts_all ON public.leaves
  FOR ALL USING (public.get_my_role() = 'accounts')
  WITH CHECK (public.get_my_role() = 'accounts');

DROP POLICY IF EXISTS staff_incentive_profiles_accounts_all ON public.staff_incentive_profiles;
CREATE POLICY staff_incentive_profiles_accounts_all ON public.staff_incentive_profiles
  FOR ALL USING (public.get_my_role() = 'accounts')
  WITH CHECK (public.get_my_role() = 'accounts');

DROP POLICY IF EXISTS salary_policy_accounts_all ON public.salary_policy;
CREATE POLICY salary_policy_accounts_all ON public.salary_policy
  FOR ALL USING (public.get_my_role() = 'accounts')
  WITH CHECK (public.get_my_role() = 'accounts');

DROP POLICY IF EXISTS incentive_settings_accounts_all ON public.incentive_settings;
CREATE POLICY incentive_settings_accounts_all ON public.incentive_settings
  FOR ALL USING (public.get_my_role() = 'accounts')
  WITH CHECK (public.get_my_role() = 'accounts');

-- ---- READ tables (FOR SELECT) ------------------------------------------------

DROP POLICY IF EXISTS monthly_sales_data_accounts_read ON public.monthly_sales_data;
CREATE POLICY monthly_sales_data_accounts_read ON public.monthly_sales_data
  FOR SELECT USING (public.get_my_role() = 'accounts');

DROP POLICY IF EXISTS payments_accounts_read ON public.payments;
CREATE POLICY payments_accounts_read ON public.payments
  FOR SELECT USING (public.get_my_role() = 'accounts');

DROP POLICY IF EXISTS daily_performance_accounts_read ON public.daily_performance;
CREATE POLICY daily_performance_accounts_read ON public.daily_performance
  FOR SELECT USING (public.get_my_role() = 'accounts');

DROP POLICY IF EXISTS gps_pings_accounts_read ON public.gps_pings;
CREATE POLICY gps_pings_accounts_read ON public.gps_pings
  FOR SELECT USING (public.get_my_role() = 'accounts');

DROP POLICY IF EXISTS quotes_accounts_read ON public.quotes;
CREATE POLICY quotes_accounts_read ON public.quotes
  FOR SELECT USING (public.get_my_role() = 'accounts');

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY — expect 13 rows (8 cmd=ALL + 5 cmd=SELECT); city_da_ceilings absent.
-- ============================================================================
-- SELECT tablename, policyname, cmd
--   FROM pg_policies
--  WHERE schemaname='public' AND policyname LIKE '%\_accounts\_%'
--  ORDER BY tablename;
--
-- And confirm the RPC gate admits accounts (should be TRUE):
-- SELECT pg_get_functiondef('public._assert_self_or_admin(uuid)'::regprocedure)
--          LIKE '%''admin'', ''co_owner'', ''accounts''%' AS gate_has_accounts;
-- ============================================================================
