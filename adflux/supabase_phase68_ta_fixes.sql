-- supabase_phase68_ta_fixes.sql
-- Phase 68 (21 May 2026) — TA module bug fixes
--
-- Owner findings (20 May 2026, Dhara's TC TA row):
--   • Dhara map shows 23.8 km cleaned route, admin TA shows 94.1 km
--   • DA auto-calculates ₹200 from city detection (owner: claim-only)
--   • Bike rate × inflated km = wrong payout (₹282 vs actual ~₹75)
--
-- Three changes here:
--
-- 1. DROP auto-DA. Lines 115–121 of phase 36.8 set v_da_amount to
--    daily_da (₹200 default) when the rep was detected outside their
--    home city. Owner directive: "day always claim not auto calculate".
--    The function now leaves v_da_amount at 0 from the GPS branch.
--    Claims (kind in da_night, other) still add to DA via section B.
--
-- 2. TIGHTEN drift filter on the GPS km loop. Phase 36.8 used:
--      accuracy_m <= 200  AND  seg_km >= 0.03 (30m)  AND  speed <= 200
--    With 1710 dense pings in an urban area, 30m drift floor lets
--    GPS jitter accumulate to 90+ phantom km. New filter:
--      accuracy_m <= 50   AND  seg_km >= 0.10 (100m)  AND  speed <= 120
--    Matches the GpsTrackV2 client-side cleanTrack thresholds so
--    server km lines up with map polyline km.
--
-- 3. BACKFILL. Recompute daily_ta for every (user, day) pair with
--    GPS pings in the last 60 days. Owner confirmed no TA paid out
--    yet, so retroactive shrink is safe.
--
-- Idempotent. CREATE OR REPLACE on function body only.

-- ─── 1. compute_daily_ta — drop auto-DA + tighten drift filter ───
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
  -- ─── A. GPS-based km + city detection ───────────────────────────
  -- Phase 68 — drift filter tightened: 100m segment floor +
  -- 50m max accuracy + 120 km/h max speed. Matches GpsTrackV2
  -- client-side cleanTrack so server number = map number.
  FOR v_ping IN
    SELECT captured_at, lat, lng, accuracy_m
      FROM public.gps_pings
     WHERE user_id = p_user_id
       AND captured_at >= p_date::timestamptz
       AND captured_at <  (p_date + 1)::timestamptz
       AND (accuracy_m IS NULL OR accuracy_m <= 50)
     ORDER BY captured_at ASC
  LOOP
    v_ping_count := v_ping_count + 1;
    IF v_prev_lat IS NOT NULL THEN
      v_seg_km  := public.haversine_km(v_prev_lat, v_prev_lng, v_ping.lat, v_ping.lng);
      v_seg_hrs := GREATEST(EXTRACT(EPOCH FROM (v_ping.captured_at - v_prev_ts)) / 3600.0, 0.0001);
      v_seg_speed := v_seg_km / v_seg_hrs;
      IF v_seg_km >= 0.10 AND v_seg_speed <= 120 THEN
        v_total_km := v_total_km + v_seg_km;
      END IF;
    END IF;
    v_prev_lat := v_ping.lat;
    v_prev_lng := v_ping.lng;
    v_prev_ts  := v_ping.captured_at;
  END LOOP;

  SELECT dc.city_name, dc.category, dc.is_home, dc.bike_per_km
    INTO v_city_count
    FROM public.gps_pings gp
    CROSS JOIN LATERAL public.detect_city(gp.lat, gp.lng) dc
   WHERE gp.user_id = p_user_id
     AND gp.captured_at >= p_date::timestamptz
     AND gp.captured_at <  (p_date + 1)::timestamptz
     AND (gp.accuracy_m IS NULL OR gp.accuracy_m <= 50)
   GROUP BY dc.city_name, dc.category, dc.is_home, dc.bike_per_km
   ORDER BY COUNT(*) DESC
   LIMIT 1;

  IF v_city_count.city_name IS NOT NULL THEN
    v_primary_city := v_city_count.city_name;
    v_category     := v_city_count.category;
    v_is_home      := v_city_count.is_home;
    v_bike_rate    := v_city_count.bike_per_km;
  END IF;

  -- Phase 68 — DA is CLAIM-ONLY. GPS no longer auto-sets DA even
  -- when the rep is detected outside home city. Owner directive
  -- (21 May 2026): "day always claim not auto calculate".
  -- Bike still auto-computes from cleaned km × rate.
  v_da_amount    := 0;
  v_bike_amount  := ROUND(v_total_km * v_bike_rate, 0);

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

  -- ─── C. Overnight flag ─────────────────────────────────────────
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


-- ─── 2. Backfill — recompute every (user, day) with pings ───────
-- Last 60 days only — historical accuracy isn't needed beyond that
-- window, and limits the loop to a few thousand pairs max.
-- Skips paid rows ('paid' status) defensively even though owner
-- confirmed nothing paid out yet.
DO $$
DECLARE
  r record;
  v_count int := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT user_id, captured_at::date AS day
      FROM public.gps_pings
     WHERE captured_at >= (CURRENT_DATE - INTERVAL '60 days')
     ORDER BY user_id, day
  LOOP
    -- Skip days already paid.
    IF EXISTS (
      SELECT 1 FROM public.daily_ta
       WHERE user_id = r.user_id
         AND ta_date = r.day
         AND status  = 'paid'
    ) THEN
      CONTINUE;
    END IF;
    PERFORM public.compute_daily_ta(r.user_id, r.day);
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE 'Phase 68 backfill: recomputed % daily_ta rows', v_count;
END $$;


-- ─── 3. VERIFY ──────────────────────────────────────────────────
-- Sample Dhara's 20 May row to confirm the fix landed.
SELECT
  u.name,
  dt.ta_date,
  dt.gps_pings_count,
  dt.km_traveled,
  dt.da_amount,
  dt.bike_amount,
  dt.hotel_amount,
  dt.total_amount,
  dt.status,
  dt.primary_city,
  dt.city_category
FROM public.daily_ta dt
JOIN public.users u ON u.id = dt.user_id
WHERE dt.ta_date BETWEEN (CURRENT_DATE - INTERVAL '7 days') AND CURRENT_DATE
ORDER BY dt.ta_date DESC, u.name;

NOTIFY pgrst, 'reload schema';

SELECT 'Phase 68 TA fixes ready' AS status;
