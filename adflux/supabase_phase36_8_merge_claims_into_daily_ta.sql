-- supabase_phase36_8_merge_claims_into_daily_ta.sql
-- Phase 36.8 — approved TA/DA claims now reflect on the per-day
--              daily_ta row, not only in salary RPC.
-- 17 May 2026
--
-- Owner reported: admin approves a ₹3,000 "other" claim + ₹6,000
-- hotel + ₹500 DA night for RR on 13 May. /admin/salary shows
-- RR's TA/DA = ₹589 (RPC was summing claims separately). But
-- /admin/ta-payouts row for 13 May still shows ₹0 DA + ₹0 hotel.
-- The per-day table and the salary sheet disagreed.
--
-- Fix — make daily_ta the single source of truth:
--
-- 1. Extend compute_daily_ta to ALSO merge approved claims at the
--    end. After GPS-based amounts compute as before, sum approved
--    ta_da_requests for the same (user, date) and merge:
--      da_night + other → add to da_amount
--      hotel            → add to hotel_amount
--      ta_override      → REPLACE km_traveled + bike_amount
--    total_amount recalc = bike + da + hotel.
-- 2. Add trigger on ta_da_requests AFTER status flips to/from
--    'approved'. Calls compute_daily_ta(user, claim_date) so the
--    daily_ta row stays in sync without admin needing a refresh.
-- 3. Drop v_ta_from_claims block from compute_monthly_salary —
--    daily_ta.total_amount now includes claims; counting them
--    twice would inflate TA/DA on /admin/salary.
-- 4. Backfill — recompute daily_ta for every (user, claim_date)
--    pair that has at least one approved claim today, so existing
--    approvals reflect immediately without admin needing to
--    re-approve.
--
-- Idempotent. compute_daily_ta is already CREATE OR REPLACE; this
-- swap is additive (claims merge appended after existing GPS logic).
-- Touches CLAUDE.md §28 frozen contract — guardian audit advised.

-- ─── 1. compute_daily_ta — extended with claims merge ────────────
-- -------------------------------------------------------------------------
-- compute_daily_ta REMOVED from this file (Phase 178).
-- Canonical: db/functions/compute_daily_ta.sql  (MONEY function — TA payout)
-- Do NOT re-add it here. Edit the canonical file only (§71). Trigger wiring
-- (per-ping TA recompute + claim-approve) stays in the phase files.
-- -------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.compute_daily_ta(uuid, date) TO authenticated;


-- ─── 2. Trigger on ta_da_requests — recompute daily_ta on status change ───
CREATE OR REPLACE FUNCTION public.trg_ta_claim_recompute_daily()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Recompute the affected day whenever a claim moves into or out of
  -- 'approved' state. INSERT case captures admin-typed approvals.
  IF (TG_OP = 'INSERT' AND NEW.status = 'approved')
     OR (TG_OP = 'UPDATE'
         AND (NEW.status = 'approved' OR OLD.status = 'approved')
         AND NEW.status IS DISTINCT FROM OLD.status) THEN
    PERFORM public.compute_daily_ta(NEW.user_id, NEW.claim_date);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ta_claim_recompute ON public.ta_da_requests;
CREATE TRIGGER trg_ta_claim_recompute
  AFTER INSERT OR UPDATE OF status ON public.ta_da_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_ta_claim_recompute_daily();


-- ─── 3. compute_monthly_salary — drop claim sum (now in daily_ta) ─
-- -------------------------------------------------------------------------
-- compute_monthly_salary REMOVED from this file (Phase 178).
-- Canonical: db/functions/compute_monthly_salary.sql  (MONEY — payroll).
-- Do NOT re-add it here. Edit the canonical file only (§71).
-- -------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.compute_monthly_salary(uuid, int, int) TO authenticated;


-- ─── 4. Backfill — recompute daily_ta for any existing approved claim ───
-- Walks every (user, claim_date) pair that currently has at least one
-- approved claim, regardless of how old. Safe because compute_daily_ta
-- is idempotent (UPSERT with WHERE status='pending' gate; already-paid
-- rows are left alone).
DO $$
DECLARE
  v_pair RECORD;
BEGIN
  FOR v_pair IN
    SELECT DISTINCT user_id, claim_date
      FROM public.ta_da_requests
     WHERE status = 'approved'
  LOOP
    PERFORM public.compute_daily_ta(v_pair.user_id, v_pair.claim_date);
  END LOOP;
END $$;


NOTIFY pgrst, 'reload schema';


-- ─── VERIFY ──────────────────────────────────────────────────────
SELECT
  (SELECT pg_get_functiondef(oid) LIKE '%v_claim_da%'
     FROM pg_proc WHERE proname = 'compute_daily_ta')                AS daily_ta_has_claims_merge,
  (SELECT count(*) FROM pg_trigger
     WHERE tgname = 'trg_ta_claim_recompute')                         AS trigger_present,
  (SELECT pg_get_functiondef(oid) NOT LIKE '%v_ta_from_claims%'
     FROM pg_proc WHERE proname = 'compute_monthly_salary')           AS salary_rpc_no_double_count;
