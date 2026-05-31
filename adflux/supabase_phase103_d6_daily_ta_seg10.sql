-- =====================================================================
-- ADFLUX → UNTITLED OS  •  PHASE 103.D.6 SQL
-- compute_daily_ta — drift floor 100m -> 10m (accurate km for dense pings)
-- 2026-05-31 (Brijesh Solanki)
-- =====================================================================
--
-- WHY:
--   The Phase 103.D.3 native foreground service writes a GPS fix every
--   ~20s (vs the old sparse 5-min pings). The 100m segment floor (Phase
--   68) was tuned for sparse data; with dense pings, real city / slow
--   driving makes <100m segments that the 100m floor wrongly DROPS, so
--   km massively under-counts (Dixita's 10.7 km Google drive → 7.0 km
--   server / 3.6 km truncated display).
--
--   CALIBRATED against that exact drive (1901 segments, accuracy<=50m,
--   speed<=120 km/h):
--       raw, no floor : 41.64 km   (pure jitter — far too high)
--       >= 10 m floor : 10.79 km   ← matches Google's 10.7
--       >= 25 m floor :  8.14 km
--       >= 35 m floor :  7.75 km
--       >= 100 m floor:  7.04 km   (current — under-counts)
--   The 10 m floor cleanly separates real movement from GPS jitter.
--   Client gpsDistance.js MIN_SEG_KM moves to 0.010 in the SAME commit.
--
-- WHAT THIS CHANGES (ONE line):
--   Line `IF v_seg_km >= 0.10 ...` → `>= 0.010`. Everything else in the
--   function is the live Phase 97.2 body VERBATIM — the
--   _assert_self_or_admin gate, the approved-claim merge (Phase 36.8),
--   the ta_override, city detection, daily_ta upsert. Nothing else moves.
--
-- WHAT THIS DOES NOT TOUCH:
--   - The TA payout FORMULA (km × bike_rate + DA + hotel) — unchanged.
--   - The Phase 34Z.67 trigger that calls this on gps_pings INSERT.
--   - accuracy filter (50m), speed cap (120 km/h), daily logic.
--
-- MONEY NOTE: TA payable rises toward accurate km for reps on the dense
--   service (they were under-counted). This is a data-accuracy fix, not
--   a rate change. Verify daily_ta.km_traveled vs a real drive before
--   the month-end TA payout.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.compute_daily_ta(p_user_id uuid, p_date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
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

  v_claim_da     numeric := 0;
  v_claim_hotel  numeric := 0;
  v_override_km  numeric;
BEGIN
  PERFORM public._assert_self_or_admin(p_user_id);

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
      -- Phase 103.D.6 — drift floor 0.10 -> 0.010 (10 m). Calibrated to
      -- Dixita's 10.7 km drive (>=10m floor = 10.79 km vs Google 10.7).
      IF v_seg_km >= 0.010 AND v_seg_speed <= 120 THEN
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

  v_da_amount    := 0;
  v_bike_amount  := ROUND(v_total_km * v_bike_rate, 0);

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

  IF v_override_km IS NOT NULL AND v_override_km > 0 THEN
    v_total_km    := v_override_km;
    v_bike_amount := ROUND(v_override_km * v_bike_rate, 0);
  END IF;

  v_da_amount    := v_da_amount + v_claim_da;
  v_hotel_amount := v_claim_hotel;

  v_total_amount := v_da_amount + v_bike_amount + v_hotel_amount;

  SELECT COALESCE(overnight_stay, false) INTO v_overnight
    FROM work_sessions
   WHERE user_id = p_user_id AND work_date = p_date;
  v_overnight := COALESCE(v_overnight, false);

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
END $function$;


NOTIFY pgrst, 'reload schema';


-- =====================================================================
-- VERIFY
-- =====================================================================
-- V1: the floor is now 0.010 (not 0.10) in the live function
--   SELECT pg_get_functiondef('public.compute_daily_ta(uuid,date)'::regprocedure)
--     LIKE '%v_seg_km >= 0.010%' AS floor_is_10m;
--   Expected: true.
--
-- V2: recompute Dixita today + check km matches the calibration (~10.79)
--   SELECT public.compute_daily_ta('caa6236a-844b-4097-8d93-f71d9b28ffae', '2026-05-31');
--   SELECT km_traveled, gps_pings_count FROM public.daily_ta
--    WHERE user_id='caa6236a-844b-4097-8d93-f71d9b28ffae' AND ta_date='2026-05-31';
--   Expected: km_traveled ≈ 10.79 (was ~7.04 at the 100m floor).
--   NOTE: only recomputes if the row is still status='pending'.
--
-- =====================================================================
-- ROLLBACK
-- =====================================================================
--   Re-run supabase_phase97_2_rpc_role_gates.sql section 5.5 (the
--   0.10 version), OR change 0.010 back to 0.10 here and re-run.
-- =====================================================================
