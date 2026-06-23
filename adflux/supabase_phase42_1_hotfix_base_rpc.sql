-- supabase_phase42_1_hotfix_base_rpc.sql
-- HOTFIX for Phase 42 — restore _compute_monthly_salary_base
-- 18 May 2026
--
-- Bug: Phase 42 SQL did CREATE OR REPLACE on compute_monthly_salary
-- (the wrapper) BEFORE the DO block tried to rename the original
-- to _compute_monthly_salary_base. By that point the original body
-- was already overwritten. Result: the wrapper now calls a function
-- (_base) that doesn't exist → Salary tab throws on every load.
--
-- Fix: CREATE _compute_monthly_salary_base with the exact Phase
-- 36.10 body (copied from supabase_phase36_10_paid_leave_tenure.sql
-- lines 53-189). Wrapper compute_monthly_salary stays as-is and
-- now resolves _base correctly.
--
-- Idempotent: CREATE OR REPLACE on _base.

-- -------------------------------------------------------------------------
-- _compute_monthly_salary_base REMOVED from this file (Phase 178).
-- Canonical: db/functions/_compute_monthly_salary_base.sql  (MONEY — payroll).
-- Do NOT re-add it here. Edit the canonical file only (§71).
-- -------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public._compute_monthly_salary_base(uuid, int, int) TO authenticated;

NOTIFY pgrst, 'reload schema';


-- ─── VERIFY ──────────────────────────────────────────────────────
-- All 3 functions should exist now: wrapper, base, helper.
SELECT
  (SELECT count(*) FROM pg_proc
    WHERE proname IN ('compute_monthly_salary','_compute_monthly_salary_base','is_sales_manager')
      AND pronamespace='public'::regnamespace)                          AS rpc_fn_count;

-- Expected: rpc_fn_count = 3.

-- Smoke test: call the wrapper for any rep + current month. Should
-- return jsonb with net_payable. Replace the UUID with a real user
-- (e.g. Brijesh's id) and current year/month.
--   SELECT public.compute_monthly_salary(
--     (SELECT id FROM public.users WHERE name='Brijesh' LIMIT 1),
--     2026, 5
--   );
