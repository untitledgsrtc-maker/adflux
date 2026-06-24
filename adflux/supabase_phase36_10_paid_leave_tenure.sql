-- supabase_phase36_10_paid_leave_tenure.sql
-- Phase 36.10 — rep chooses Paid vs Unpaid at leave request time.
-- 17 May 2026
--
-- Owner directive: "When a salesperson requests leave, it should
-- ask paid or unpaid. But from joining date he must be 9 months
-- old, then only he can claim paid leave."
--
-- Changes:
-- 1. leaves.is_paid_request column (boolean, default true). Rep's
--    explicit choice — paid or unpaid. Old rows default true.
-- 2. compute_monthly_salary deduction logic now respects rep choice:
--      paid quota used  = count(approved AND is_paid_request=true)
--      unpaid deduction = count(approved AND is_paid_request=false)
--                       + any paid-request days OVER the annual quota
--    Days marked unpaid at request time always count as unpaid even
--    if the rep still had quota left. Rep's choice respected.
-- 3. Optional: simple gate function eligible_for_paid_leave(uuid)
--    returns true if tenure >= 9 months from staff_incentive_profiles
--    .join_date. Used by rep panel via SELECT to enable/disable the
--    Paid option.
--
-- Idempotent.

-- ─── 1. leaves.is_paid_request column ────────────────────────────
ALTER TABLE public.leaves
  ADD COLUMN IF NOT EXISTS is_paid_request boolean NOT NULL DEFAULT true;


-- ─── 2. eligible_for_paid_leave helper ───────────────────────────
-- Returns true when user has been with the company for >= 9 months
-- (per staff_incentive_profiles.join_date). Used by rep UI to
-- enable/disable the Paid radio button.
-- -------------------------------------------------------------------------
-- eligible_for_paid_leave REMOVED from this file (Phase 178). Canonical: db/functions/eligible_for_paid_leave.sql
-- Do NOT re-add (§71). Trigger/grant wiring stays.
-- -------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.eligible_for_paid_leave(uuid) TO authenticated;


-- ─── 3. compute_monthly_salary — respect rep's paid/unpaid choice ─
-- -------------------------------------------------------------------------
-- compute_monthly_salary REMOVED from this file (Phase 178).
-- Canonical: db/functions/compute_monthly_salary.sql  (MONEY — payroll).
-- Do NOT re-add it here. Edit the canonical file only (§71).
-- -------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.compute_monthly_salary(uuid, int, int) TO authenticated;


NOTIFY pgrst, 'reload schema';


-- VERIFY
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='leaves'
      AND column_name='is_paid_request')                   AS is_paid_request_col,
  (SELECT count(*) FROM pg_proc
    WHERE proname='eligible_for_paid_leave')                AS gate_fn_present,
  (SELECT pg_get_functiondef(oid) LIKE '%v_leave_paid_req%'
    FROM pg_proc WHERE proname='compute_monthly_salary')    AS salary_rpc_respects_choice;
