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
CREATE OR REPLACE FUNCTION public.compute_daily_ta(
  p_user_id uuid, p_date date
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_km     numeric := 0;
  v_ping_count   int := 0;
  v_primary_city text;
  v_category     text;
  v_da_amount    numeric := 0;
  v_bike_amount  numeric := 0;
  v_hotel_amount numeric := 0;
  v_total_amount numeric := 0;
  v_is_home      boolean := false;
  v_daily_da     numeric := 200;
  v_bike_rate    numeric := 3;
  v_city_count   record;
  v_prev_lat     numeric;
  v_prev_lng     numeric;
  v_prev_ts      timestamptz;
  v_ping         record;
  v_seg_km       numeric;
  v_seg_hrs      numeric;
  v_seg_speed    numeric;
  v_overnight    boolean := false;

  -- Phase 36.8 — approved-claim sums for this date.
  v_claim_da     numeric := 0;
  v_claim_hotel  numeric := 0;
  v_override_km  numeric;
BEGIN
  -- ─── A. GPS-based km + city detection (unchanged from Phase 33Q) ───
  FOR v_ping IN
    SELECT captured_at, lat, lng, accuracy_m
      FROM public.gps_pings
     WHERE user_id = p_user_id
       AND captured_at >= p_date::timestamptz
       AND captured_at <  (p_date + 1)::timestamptz
       AND (accuracy_m IS NULL OR accuracy_m <= 200)
     ORDER BY captured_at ASC
  LOOP
    v_ping_count := v_ping_count + 1;
    IF v_prev_lat IS NOT NULL THEN
      v_seg_km  := public.haversine_km(v_prev_lat, v_prev_lng, v_ping.lat, v_ping.lng);
      v_seg_hrs := GREATEST(EXTRACT(EPOCH FROM (v_ping.captured_at - v_prev_ts)) / 3600.0, 0.0001);
      v_seg_speed := v_seg_km / v_seg_hrs;
      IF v_seg_km >= 0.03 AND v_seg_speed <= 200 THEN
        v_total_km := v_total_km + v_seg_km;
      END IF;
    END IF;
    v_prev_lat := v_ping.lat;
    v_prev_lng := v_ping.lng;
    v_prev_ts  := v_ping.captured_at;
  END LOOP;

  SELECT dc.city_name, dc.category, dc.is_home, dc.daily_da, dc.bike_per_km
    INTO v_city_count
    FROM public.gps_pings gp
    CROSS JOIN LATERAL public.detect_city(gp.lat, gp.lng) dc
   WHERE gp.user_id = p_user_id
     AND gp.captured_at >= p_date::timestamptz
     AND gp.captured_at <  (p_date + 1)::timestamptz
     AND (gp.accuracy_m IS NULL OR gp.accuracy_m <= 200)
   GROUP BY dc.city_name, dc.category, dc.is_home, dc.daily_da, dc.bike_per_km
   ORDER BY COUNT(*) DESC
   LIMIT 1;

  IF v_city_count.city_name IS NOT NULL THEN
    v_primary_city := v_city_count.city_name;
    v_category     := v_city_count.category;
    v_is_home      := v_city_count.is_home;
    v_daily_da     := v_city_count.daily_da;
    v_bike_rate    := v_city_count.bike_per_km;
  END IF;

  IF v_is_home THEN
    v_da_amount    := 0;
    v_bike_amount  := ROUND(v_total_km * v_bike_rate, 0);
  ELSIF v_primary_city IS NOT NULL THEN
    v_da_amount    := v_daily_da;
    v_bike_amount  := ROUND(v_total_km * v_bike_rate, 0);
  END IF;

  -- ─── B. Phase 36.8 — fold approved claims for this date ─────────
  SELECT
    COALESCE(SUM(CASE WHEN kind IN ('da_night', 'other')
                      THEN COALESCE(claim_amount, 0)
                      ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN kind = 'hotel'
                      THEN COALESCE(claim_amount, 0)
                      ELSE 0 END), 0),
    MAX(CASE WHEN kind = 'ta_override'
             THEN COALESCE(claim_km, 0)
             ELSE NULL END)
  INTO v_claim_da, v_claim_hotel, v_override_km
  FROM public.ta_da_requests
  WHERE user_id   = p_user_id
    AND claim_date = p_date
    AND status     = 'approved';

  -- ta_override REPLACES GPS km + bike (rep asserts the real distance).
  IF v_override_km IS NOT NULL AND v_override_km > 0 THEN
    v_total_km    := v_override_km;
    v_bike_amount := ROUND(v_override_km * v_bike_rate, 0);
  END IF;

  -- da_night + other ADD to DA; hotel REPLACES hotel (only claims write here).
  v_da_amount    := v_da_amount + v_claim_da;
  v_hotel_amount := v_claim_hotel;

  v_total_amount := v_da_amount + v_bike_amount + v_hotel_amount;

  -- ─── C. Overnight flag (unchanged from Phase 33Q) ───────────────
  SELECT COALESCE(overnight_stay, false) INTO v_overnight
    FROM work_sessions
   WHERE user_id = p_user_id AND work_date = p_date;
  v_overnight := COALESCE(v_overnight, false);

  -- ─── D. Upsert daily_ta ────────────────────────────────────────
  INSERT INTO public.daily_ta (
    user_id, ta_date, primary_city, city_category,
    km_traveled, da_amount, bike_amount, hotel_amount, total_amount,
    status, gps_pings_count, hotel_requested, computed_at
  ) VALUES (
    p_user_id, p_date, v_primary_city, v_category,
    ROUND(v_total_km, 2), v_da_amount, v_bike_amount, v_hotel_amount, v_total_amount,
    'pending', v_ping_count, v_overnight, now()
  )
  ON CONFLICT (user_id, ta_date) DO UPDATE
    SET primary_city    = EXCLUDED.primary_city,
        city_category   = EXCLUDED.city_category,
        km_traveled     = EXCLUDED.km_traveled,
        da_amount       = EXCLUDED.da_amount,
        bike_amount     = EXCLUDED.bike_amount,
        hotel_amount    = EXCLUDED.hotel_amount,
        total_amount    = EXCLUDED.da_amount + EXCLUDED.bike_amount + EXCLUDED.hotel_amount,
        gps_pings_count = EXCLUDED.gps_pings_count,
        hotel_requested = EXCLUDED.hotel_requested,
        computed_at     = now()
    WHERE daily_ta.status = 'pending';
END $$;

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
