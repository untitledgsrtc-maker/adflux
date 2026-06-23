-- supabase_phase36_7_claim_kinds_hotel_other.sql
-- Phase 36.7 — extend ta_da_requests.kind to include 'hotel' and 'other'.
-- 17 May 2026
--
-- Owner directive: reps need to claim hotel stay reimbursement and
-- a generic "Other" expense (with description). Existing kinds were
-- only ta_override + da_night. Schema change is a CHECK-constraint
-- swap + RPC update to fold approved hotel/other amounts into TA/DA.
--
-- Idempotent — drops + re-adds the CHECK constraint, re-creates RPC.

-- ─── 1. Extend kind enum ─────────────────────────────────────────
ALTER TABLE public.ta_da_requests
  DROP CONSTRAINT IF EXISTS ta_da_requests_kind_check;

ALTER TABLE public.ta_da_requests
  ADD  CONSTRAINT ta_da_requests_kind_check
       CHECK (kind IN ('ta_override','da_night','hotel','other'));


-- ─── 2. Update compute_monthly_salary to include hotel + other ───
-- -------------------------------------------------------------------------
-- compute_monthly_salary REMOVED from this file (Phase 178).
-- Canonical: db/functions/compute_monthly_salary.sql  (MONEY — payroll).
-- Do NOT re-add it here. Edit the canonical file only (§71).
-- -------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.compute_monthly_salary(uuid, int, int) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY: confirm CHECK accepts new kinds + RPC body has hotel/other.
SELECT
  (SELECT pg_get_constraintdef(oid) LIKE '%hotel%'
     FROM pg_constraint
     WHERE conname = 'ta_da_requests_kind_check')         AS kind_check_extended,
  (SELECT pg_get_functiondef(oid) LIKE '%hotel%''other%' OR
          pg_get_functiondef(oid) LIKE '%da_night%hotel%'
     FROM pg_proc
     WHERE proname = 'compute_monthly_salary')            AS rpc_includes_new_kinds;
