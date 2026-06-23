-- supabase_phase36_4_salary_include_claims.sql
-- Phase 36.4 — fold approved TA/DA claim requests into compute_monthly_salary
-- 16 May 2026
--
-- Two fixes in one file:
--
-- 1. Phase 36 RPC referenced `daily_ta.ta_amount` which does NOT exist —
--    the column is `total_amount`. Bug shipped in Phase 36; without this
--    fix the salary RPC threw "column ta_amount does not exist" the
--    moment any rep had a daily_ta row for the month. Replace the wrong
--    column name with the correct one.
--
-- 2. Approved rep-side claim requests (ta_da_requests, Phase 34Z.37)
--    were sitting in the DB as an audit trail but didn't flow into the
--    monthly salary numbers. Admin approved a ₹700 DA night claim, but
--    /admin/salary still showed the GPS-only TA/DA total. Fix: add
--    SUM of approved claims for the month to v_ta_da.
--    - kind='da_night'    → claim_amount (₹, direct)
--    - kind='ta_override' → claim_km × 3  (flat bike-rate; matches
--                                          Phase 33I default of ₹3/km)
--
-- New JSON keys returned: ta_from_pings, ta_from_claims (so the admin
-- page can show the split if it wants to). `ta_da` total = sum of
-- both (back-compat).
--
-- Idempotent — CREATE OR REPLACE.

-- -------------------------------------------------------------------------
-- compute_monthly_salary REMOVED from this file (Phase 178).
-- Canonical: db/functions/compute_monthly_salary.sql  (MONEY — payroll).
-- Do NOT re-add it here. Edit the canonical file only (§71).
-- -------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.compute_monthly_salary(uuid, int, int) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────
-- Confirm the function exists + accepts the same signature.
SELECT
  proname,
  pronargs,
  pg_get_function_arguments(oid) AS args
  FROM pg_proc
 WHERE proname = 'compute_monthly_salary';

-- Smoke test (replace UUID with a real user_id):
-- SELECT compute_monthly_salary(
--   '00000000-0000-0000-0000-000000000000'::uuid, 2026, 5
-- );
