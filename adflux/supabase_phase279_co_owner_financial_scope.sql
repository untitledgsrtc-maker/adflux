-- =====================================================================
-- Phase 279 — remove co_owner (Vishal) from the 3 org-wide FINANCIAL
-- tables: staff_incentive_profiles / monthly_sales_data / incentive_settings.
-- 2026-08-03
--
-- Companion to Phase 278. The security review of the co_owner leak found that
-- besides quotes/payments/etc (Phase 278), these 3 payroll/ledger tables also
-- carry *_admin_all policies that include co_owner (and a dead 'owner' role, §8).
-- Confirmed live via pg_policies 2026-08-03: all 3 = ANY('admin','owner','co_owner').
--
-- So Vishal (role=co_owner, team_role=government_partner — GOVERNMENT-only per §42,
-- "no private-side admin data / no private HR / no private P&L", owner directive
-- 2026-05-28 §42 D4) can read the WHOLE team's salary + incentive config + the
-- all-segment sales-revenue ledger via the normal client query. That breaks §42.
--
-- These tables have NO segment column — salary/incentive is one ORG-WIDE payroll,
-- not per-segment — so a GOVERNMENT-scoped govt_partner_read makes no sense (there
-- is no "government salary"). Vishal is a govt partner, not HR/finance/accounts, so
-- he needs NONE of this. FIX = admin ONLY (drop co_owner + dead 'owner').
--
-- Why this is safe (does NOT break anyone):
--   • accounts (Diya, Phase 182) reads/writes payroll via its OWN additive policies,
--     NOT via *_admin_all (accounts was never in the admin_all role array).
--   • HR writes staff_incentive_profiles via sip_hr_write (Phase 109), separate.
--   • monthly_sales_data is written by rebuild_monthly_sales (SECURITY DEFINER →
--     runs as postgres, bypasses RLS). No client co_owner write path exists.
--   • The P&L module (Sprint 3, §42) will use its OWN govt-scoped tables — these
--     3 stay admin-only regardless.
-- Admin keeps FULL read+write (no explicit WITH CHECK → defaults to USING → writes).
-- Idempotent (DROP POLICY IF EXISTS then CREATE). §8.
-- =====================================================================

DROP POLICY IF EXISTS sip_admin_all ON public.staff_incentive_profiles;
CREATE POLICY sip_admin_all ON public.staff_incentive_profiles FOR ALL
  USING (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS msd_admin_all ON public.monthly_sales_data;
CREATE POLICY msd_admin_all ON public.monthly_sales_data FOR ALL
  USING (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS is_admin_all ON public.incentive_settings;
CREATE POLICY is_admin_all ON public.incentive_settings FOR ALL
  USING (public.get_my_role() = 'admin');

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────────
-- Expect: all 3 *_admin_all quals = "(get_my_role() = 'admin'::text)".
-- NO 'co_owner' or 'owner' in any qual.
SELECT tablename, policyname, qual
FROM   pg_policies
WHERE  schemaname = 'public'
  AND  tablename IN ('staff_incentive_profiles','monthly_sales_data','incentive_settings')
  AND  policyname LIKE '%admin_all%'
ORDER  BY tablename;
