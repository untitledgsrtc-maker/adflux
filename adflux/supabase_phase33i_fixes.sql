-- supabase_phase33i_fixes.sql
--
-- Phase 33I — fixes for the audit issues B4, B5.
--
-- B4: leaves delete doesn't fully undo a backfilled leave.
--     Root cause: compute_daily_score has a fallback path that reads
--     work_sessions.is_off_day. After the leaves backfill, BOTH rows
--     exist. Deleting a leaves row leaves is_off_day=true in place.
--     The score function still excludes the day via fallback.
--
--     Fix: drop the is_off_day fallback entirely. leaves table is now
--     the only source of truth for off-days. work_sessions.is_off_day
--     column stays in the schema (we're not breaking historical data)
--     but stops being consulted by the score function.
--
--     Safe because the Phase 33G.8 backfill already copied every
--     is_off_day=true row into the leaves table. So the score function
--     reading leaves only is equivalent for all existing data, and
--     correct for all future data.
--
-- B5: Vadodara local work pays zero for bike. Owner's TA doc lists
--     only 20 travel cities — Vadodara HQ wasn't defined. I assumed
--     zero. Owner clarification: reps doing local Vadodara work
--     should still be reimbursed for actual km traveled.
--
--     Fix: home city → DA = 0 (no daily allowance for being home),
--     but bike_amount STILL = km × bike_per_km (real fuel/wear
--     reimbursement).
--
-- Idempotent: CREATE OR REPLACE on both functions.

-- ─── B4: drop is_off_day fallback ────────────────────────────────
CREATE OR REPLACE FUNCTION public.compute_daily_score(
  p_user_id uuid, p_date date
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_done     int := 0;
  v_target   int := 5;
  v_pct      numeric;
  v_excluded boolean := false;
  v_reason   text;
  v_dow      int;
  v_targets  jsonb;
  v_leave    record;
BEGIN
  -- Sunday? Skip — not a workday.
  v_dow := EXTRACT(DOW FROM p_date)::int;
  IF v_dow = 0 THEN
    v_excluded := true;
    v_reason   := 'Sunday';
  END IF;

  -- National / Gujarat / company holiday?
  IF NOT v_excluded AND EXISTS (
    SELECT 1 FROM holidays
    WHERE holiday_date = p_date AND is_active = true
  ) THEN
    v_excluded := true;
    SELECT name INTO v_reason FROM holidays
      WHERE holiday_date = p_date AND is_active = true LIMIT 1;
    v_reason := COALESCE('Holiday: ' || v_reason, 'Holiday');
  END IF;

  -- Phase 33I (B4) — leaves table is the only off-day source now.
  -- Dropped the work_sessions.is_off_day fallback.
  IF NOT v_excluded THEN
    SELECT * INTO v_leave FROM public.is_leave_day(p_user_id, p_date);
    IF v_leave.is_leave THEN
      v_excluded := true;
      v_reason   := v_leave.reason;
    END IF;
  END IF;

  -- Pull target from users.daily_targets (Phase 32M default 5).
  SELECT daily_targets INTO v_targets FROM users WHERE id = p_user_id;
  v_target := COALESCE((v_targets->>'meetings')::int, 5);

  -- Pull actual from work_sessions.daily_counters.
  SELECT COALESCE((daily_counters->>'meetings')::int, 0)
    INTO v_done
    FROM work_sessions
   WHERE user_id = p_user_id AND work_date = p_date;
  v_done := COALESCE(v_done, 0);

  -- Compute %. Cap at 100.
  IF v_target = 0 THEN
    v_pct := 100;
  ELSE
    v_pct := LEAST(100, (v_done::numeric / v_target::numeric) * 100);
  END IF;

  -- Upsert.
  INSERT INTO daily_performance (
    user_id, work_date, meetings_done, meetings_target,
    score_pct, is_excluded, excluded_reason, calculated_at
  ) VALUES (
    p_user_id, p_date, v_done, v_target,
    v_pct, v_excluded, v_reason, now()
  )
  ON CONFLICT (user_id, work_date) DO UPDATE
    SET meetings_done    = EXCLUDED.meetings_done,
        meetings_target  = EXCLUDED.meetings_target,
        score_pct        = EXCLUDED.score_pct,
        is_excluded      = EXCLUDED.is_excluded,
        excluded_reason  = EXCLUDED.excluded_reason,
        calculated_at    = EXCLUDED.calculated_at;
END $$;

GRANT EXECUTE ON FUNCTION public.compute_daily_score(uuid, date) TO authenticated;

-- ─── B5: Vadodara local work pays bike (DA still 0) ──────────────
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
BEGIN
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

  -- Phase 33I (B5) — Vadodara local work pays bike. DA stays 0
  -- (you don't get a "going out of town" DA for being home), but
  -- bike per km is real fuel/wear reimbursement that should pay.
  IF v_is_home THEN
    v_da_amount    := 0;
    v_bike_amount  := ROUND(v_total_km * v_bike_rate, 0);
  ELSIF v_primary_city IS NOT NULL THEN
    v_da_amount    := v_daily_da;
    v_bike_amount  := ROUND(v_total_km * v_bike_rate, 0);
  END IF;

  v_total_amount := v_da_amount + v_bike_amount;

  INSERT INTO public.daily_ta (
    user_id, ta_date, primary_city, city_category,
    km_traveled, da_amount, bike_amount, hotel_amount, total_amount,
    status, gps_pings_count, computed_at
  ) VALUES (
    p_user_id, p_date, v_primary_city, v_category,
    ROUND(v_total_km, 2), v_da_amount, v_bike_amount, 0, v_total_amount,
    'pending', v_ping_count, now()
  )
  ON CONFLICT (user_id, ta_date) DO UPDATE
    SET primary_city    = EXCLUDED.primary_city,
        city_category   = EXCLUDED.city_category,
        km_traveled     = EXCLUDED.km_traveled,
        da_amount       = EXCLUDED.da_amount,
        bike_amount     = EXCLUDED.bike_amount,
        total_amount    = EXCLUDED.da_amount + EXCLUDED.bike_amount + daily_ta.hotel_amount,
        gps_pings_count = EXCLUDED.gps_pings_count,
        computed_at     = now()
    WHERE daily_ta.status = 'pending';
END $$;

GRANT EXECUTE ON FUNCTION public.compute_daily_ta(uuid, date) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY:
-- 1. Drop a leave for a rep + day → score for that day re-includes
--    that day in the average (no fallback excluding it):
--      DELETE FROM leaves WHERE user_id='<rep>' AND leave_date='<d>';
--      SELECT compute_daily_score('<rep>', '<d>');
--      SELECT is_excluded FROM daily_performance
--        WHERE user_id='<rep>' AND work_date='<d>';
--      Expect: is_excluded = false (unless Sunday/holiday).
--
-- 2. Backfill Vadodara local day:
--      SELECT compute_daily_ta('<rep>', '<d>');
--      SELECT * FROM daily_ta WHERE user_id='<rep>' AND ta_date='<d>';
--      Expect: primary_city='Vadodara', da_amount=0, bike_amount > 0
--      if rep moved within Vadodara.
