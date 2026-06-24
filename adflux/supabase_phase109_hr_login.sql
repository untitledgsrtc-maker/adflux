-- supabase_phase109_hr_login.sql
-- Phase 109 (2026-06-01) — turn on the HR login.
--
-- Owner directive 1 Jun 2026: "i want to give HR login ... right now i
-- need basic, she can send offer as per designation, and convert user
-- into team. detailed module we will create later."
--
-- The HR pages already exist (HRV2 /hr, HRNewUserV2 /hr/new-user,
-- HROfferLetterV2 /hr/offer/:userId) and the `hr` role + the "HR"
-- designation are ALREADY seeded (Phase 50). The only things blocking
-- an HR login were:
--   1. admin_create_user RPC rejected non-admin/co_owner callers, so
--      HR could not "convert a user into team".
--   2. RLS on staff_incentive_profiles + daily_targets + hr_offers was
--      admin-only, so HR creating a user (salary + targets) and using
--      the HR home (offer list) hit permission errors.
--
-- This file is ADDITIVE for the `hr` role only. It does NOT touch the
-- admin / co_owner / govt-partner semantics (Phase 98.B doctrine: the
-- intentionally-singular admin policies stay as-is). No role-constraint
-- change (Phase 50 already allows 'hr'). No designation seed (Phase 50
-- already seeded "HR" → auth_role='hr').
--
-- HR privilege ceiling: HR may onboard staff but must NOT mint
-- admin / co_owner accounts (privilege-escalation guard in the RPC).
--
-- ⚠ SUPERSEDES the caller-check in supabase_phase66_admin_create_user.sql.
--   Re-running phase66 AFTER this file will REVERT the hr widening.
--   If you ever re-run phase66 for any reason, re-run THIS file after it.
--
-- Idempotent: CREATE OR REPLACE FUNCTION + DROP POLICY IF EXISTS / CREATE.


-- ─── 1. admin_create_user — allow HR callers (capped) ────────────────
-- Full body copied verbatim from Phase 66 with TWO changes:
--   (a) caller allow-list adds 'hr'.
--   (b) new guard: an HR caller cannot create an admin / co_owner.
-- -------------------------------------------------------------------------
-- admin_create_user REMOVED from this file (Phase 178). Canonical: db/functions/admin_create_user.sql
-- Do NOT re-add (§71). Trigger/grant wiring stays.
-- -------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.admin_create_user(text, text, text, text, text, text, text, text, text, uuid, boolean, boolean, boolean, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_create_user(text, text, text, text, text, text, text, text, text, uuid, boolean, boolean, boolean, boolean) TO authenticated;


-- ─── 2. RLS — HR write on the tables the create-user flow touches ────
-- HRNewUserV2 inserts staff_incentive_profiles (salary) + daily_targets
-- (targets) client-side AFTER the RPC returns. Those run as the HR user,
-- so HR needs write. HROfferLetterV2 reads staff_incentive_profiles for
-- the target user — the FOR ALL policy below also covers that SELECT.
-- ADDITIVE: dedicated hr-only policies. Admin / co_owner / sales policies
-- are left exactly as they are.

-- HR may read / write comp + targets for the staff they onboard, but
-- must NOT touch an admin / co_owner row (no reading, editing, or
-- deleting the owner's salary). Mirrors the RPC mint-ceiling. The
-- onboarding flow only ever writes a freshly-created NON-admin hire's
-- row, so this never blocks the legitimate path.
DROP POLICY IF EXISTS "sip_hr_write" ON public.staff_incentive_profiles;
CREATE POLICY "sip_hr_write" ON public.staff_incentive_profiles
  FOR ALL
  USING (
    public.get_my_role() = 'hr'
    AND COALESCE((SELECT u.role FROM public.users u WHERE u.id = user_id), '')
          NOT IN ('admin', 'co_owner')
  )
  WITH CHECK (
    public.get_my_role() = 'hr'
    AND COALESCE((SELECT u.role FROM public.users u WHERE u.id = user_id), '')
          NOT IN ('admin', 'co_owner')
  );

DROP POLICY IF EXISTS "dt_hr_write" ON public.daily_targets;
CREATE POLICY "dt_hr_write" ON public.daily_targets
  FOR ALL
  USING (
    public.get_my_role() = 'hr'
    AND COALESCE((SELECT u.role FROM public.users u WHERE u.id = user_id), '')
          NOT IN ('admin', 'co_owner')
  )
  WITH CHECK (
    public.get_my_role() = 'hr'
    AND COALESCE((SELECT u.role FROM public.users u WHERE u.id = user_id), '')
          NOT IN ('admin', 'co_owner')
  );


-- ─── 3. RLS — HR full access to hr_offers (the /hr home + send-offer) ─
-- HRV2 lists hr_offers + SendOfferModal inserts/updates them. Phase 98.C
-- gave hr SELECT on their OWN converted row only; the HR staffer needs
-- the full roster of offers to manage. ADDITIVE hr-only policy — does
-- NOT widen the singular admin policy (Phase 98.B govt-partner doctrine).
DROP POLICY IF EXISTS "hr_offers_hr_all" ON public.hr_offers;
CREATE POLICY "hr_offers_hr_all" ON public.hr_offers
  FOR ALL
  USING      (public.get_my_role() = 'hr')
  WITH CHECK (public.get_my_role() = 'hr');


NOTIFY pgrst, 'reload schema';


-- ─── VERIFY ──────────────────────────────────────────────────────────
-- Each must return the expected result.
--
-- 1. RPC now admits 'hr' (expect caller_allows_hr = true):
SELECT
  (pg_get_functiondef('public.admin_create_user(text,text,text,text,text,text,text,text,text,uuid,boolean,boolean,boolean,boolean)'::regprocedure)
     ILIKE '%''admin'', ''co_owner'', ''hr''%')                            AS caller_allows_hr,
  (pg_get_functiondef('public.admin_create_user(text,text,text,text,text,text,text,text,text,uuid,boolean,boolean,boolean,boolean)'::regprocedure)
     ILIKE '%HR cannot create admin%')                                     AS hr_mint_guard_present;

-- 2. Three new hr policies exist (expect 3 rows):
SELECT polname, polcmd
  FROM pg_policy
 WHERE polname IN ('sip_hr_write', 'dt_hr_write', 'hr_offers_hr_all')
 ORDER BY polname;

-- 3. "HR" designation still seeded → auth_role 'hr' (expect 1 row):
SELECT name, auth_role, team_role, default_monthly_salary
  FROM public.designations
 WHERE auth_role = 'hr' AND is_active = true;

-- Expected:
--   caller_allows_hr        = true
--   hr_mint_guard_present   = true
--   (2) 3 rows: dt_hr_write / hr_offers_hr_all / sip_hr_write (all cmd='*' ALL)
--   (3) 1 row: HR / hr / hr / 35000
