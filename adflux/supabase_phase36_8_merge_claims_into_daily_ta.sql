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
CREATE OR REPLACE FUNCTION public.compute_monthly_salary(
  p_user_id uuid,
  p_year    int,
  p_month   int
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month_start    date;
  v_month_end      date;
  v_month_year     text;
  v_fy             text;
  v_paid_quota     numeric;
  v_unpaid_divisor int;

  v_monthly_salary numeric := 0;
  v_base           numeric := 0;
  v_variable       numeric := 0;
  v_score_pct      numeric := 0;
  v_working_days   int     := 0;

  v_incentive      numeric := 0;
  v_ta_da          numeric := 0;

  v_leave_total    numeric := 0;
  v_leave_paid     numeric := 0;
  v_leave_unpaid   numeric := 0;
  v_paid_used_ytd  numeric := 0;
  v_unpaid_deduction numeric := 0;

  v_fy_start       date;
  v_net            numeric;
  v_score_row      record;
BEGIN
  v_month_start := make_date(p_year, p_month, 1);
  v_month_end   := (v_month_start + INTERVAL '1 month' - INTERVAL '1 day')::date;
  v_month_year  := to_char(v_month_start, 'YYYY-MM');
  v_fy          := public.fy_for_date(v_month_start);
  v_fy_start    := CASE WHEN p_month >= 4
                          THEN make_date(p_year, 4, 1)
                          ELSE make_date(p_year - 1, 4, 1) END;

  SELECT paid_quota_days, unpaid_divisor
    INTO v_paid_quota, v_unpaid_divisor
    FROM public.salary_policy WHERE fy = v_fy;
  v_paid_quota     := COALESCE(v_paid_quota, 12);
  v_unpaid_divisor := COALESCE(v_unpaid_divisor, 26);

  SELECT * INTO v_score_row
    FROM public.monthly_score(p_user_id, v_month_start)
    LIMIT 1;
  v_monthly_salary := COALESCE(v_score_row.monthly_salary, 0);
  v_base           := COALESCE(v_score_row.base_amount, 0);
  v_variable       := COALESCE(v_score_row.variable_earned, 0);
  v_score_pct      := COALESCE(v_score_row.avg_score_pct, 0);
  v_working_days   := COALESCE(v_score_row.working_days, 0);

  SELECT COALESCE(SUM(amount_paid), 0) INTO v_incentive
    FROM public.incentive_payouts
   WHERE staff_id = p_user_id
     AND month_year = v_month_year;

  -- Phase 36.8 — daily_ta.total_amount now includes approved claims
  -- (merged by extended compute_daily_ta). Single source of truth.
  -- Old v_ta_from_claims sum-from-ta_da_requests block removed to
  -- prevent double-counting.
  SELECT COALESCE(SUM(total_amount), 0) INTO v_ta_da
    FROM public.daily_ta
   WHERE user_id = p_user_id
     AND ta_date BETWEEN v_month_start AND v_month_end;

  SELECT COALESCE(SUM(CASE WHEN is_half_day THEN 0.5 ELSE 1 END), 0)
    INTO v_leave_total
    FROM public.leaves
   WHERE user_id = p_user_id
     AND status = 'approved'
     AND leave_date BETWEEN v_month_start AND v_month_end;

  SELECT COALESCE(SUM(CASE WHEN is_half_day THEN 0.5 ELSE 1 END), 0)
    INTO v_paid_used_ytd
    FROM public.leaves
   WHERE user_id = p_user_id
     AND status = 'approved'
     AND leave_date >= v_fy_start
     AND leave_date <  v_month_start;

  v_leave_paid   := LEAST(v_leave_total, GREATEST(0, v_paid_quota - v_paid_used_ytd));
  v_leave_unpaid := GREATEST(0, v_leave_total - v_leave_paid);

  IF v_base > 0 AND v_unpaid_divisor > 0 THEN
    v_unpaid_deduction := round((v_base / v_unpaid_divisor) * v_leave_unpaid);
  ELSE
    v_unpaid_deduction := 0;
  END IF;

  v_net := round(v_base + v_variable + v_incentive + v_ta_da - v_unpaid_deduction);

  RETURN jsonb_build_object(
    'user_id',           p_user_id,
    'year',              p_year,
    'month',             p_month,
    'fy',                v_fy,
    'monthly_salary',    v_monthly_salary,
    'base',              round(v_base),
    'variable',          round(v_variable),
    'score_pct',         round(v_score_pct, 1),
    'working_days',      v_working_days,
    'incentive',         v_incentive,
    'ta_da',             v_ta_da,
    'leave_days_total',  v_leave_total,
    'leave_days_paid',   v_leave_paid,
    'leave_days_unpaid', v_leave_unpaid,
    'paid_quota',        v_paid_quota,
    'paid_used_ytd',     v_paid_used_ytd,
    'unpaid_divisor',    v_unpaid_divisor,
    'unpaid_deduction',  v_unpaid_deduction,
    'net_payable',       v_net
  );
END $$;

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
