-- supabase_phase36_5_salary_incentive_columns.sql
-- Phase 36.5 — fix incentive_payouts column-name assumptions in
--              compute_monthly_salary.
-- 16 May 2026.
--
-- Phase 36 / 36.4 assumed incentive_payouts had columns:
--   user_id, amount, status, payout_date, created_at
--
-- Actual columns (per src/components/incentives/IncentivePayoutModal.jsx):
--   staff_id, amount_paid, month_year (text 'YYYY-MM'), is_full_payment,
--   paid_date, paid_by, note
--
-- No `status` column — every row is implicitly paid (admin-only writes).
-- Filter by `month_year` text equality (e.g. '2026-05') instead of a
-- date-range on a non-existent `payout_date`.
--
-- Idempotent. CREATE OR REPLACE.

-- -------------------------------------------------------------------------
-- compute_monthly_salary REMOVED from this file (Phase 178).
-- Canonical: db/functions/compute_monthly_salary.sql  (MONEY — payroll).
-- Do NOT re-add it here. Edit the canonical file only (§71).
-- -------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.compute_monthly_salary(uuid, int, int) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────
-- Confirm body now references `staff_id` + `amount_paid` + `month_year`.
SELECT
  pg_get_functiondef(oid) LIKE '%staff_id = p_user_id%'   AS staff_id_fix,
  pg_get_functiondef(oid) LIKE '%amount_paid%'            AS amount_paid_fix,
  pg_get_functiondef(oid) LIKE '%month_year = v_month_year%' AS month_year_fix
  FROM pg_proc WHERE proname = 'compute_monthly_salary';
