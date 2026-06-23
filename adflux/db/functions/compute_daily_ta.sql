-- ============================================================================
-- db/functions/compute_daily_ta.sql — CANONICAL HOME (Phase 178 / Stage 2)
-- ============================================================================
--
-- ⭐ The ONE place compute_daily_ta is allowed to live. EDIT THIS FILE to change
--    it; never re-paste it into a new phaseN file (§71). It lived in 7 files
--    (33h, 33i, 33q, 36.8, 68, 97.2, 103.d6 — the TA-rules evolution).
--
-- 💰 MONEY FUNCTION — this computes the TA payout (₹/km bike + DA + hotel +
--    claim merges) into daily_ta. A change here moves real rupees. Per §71 rule 3,
--    any future CHANGE needs shadow-compare (new vs old on real data, prove the
--    numbers match) + owner-verify + a one-command revert, never mid-workday.
--    THIS commit is a CAPTURE, not a change — the body is byte-for-byte the live
--    function (dumped 2026-06-23), zero DB run → zero payout change.
--
-- WHAT IT DOES: recomputes daily_ta for (user, day) from gps_pings. Walks pings
--    in time order, sums segment km, ×bike rate. Then merges approved ta_da_requests
--    (da_night/other → DA, hotel → hotel, ta_override → REPLACE km), sets overnight.
--    Called per-ping by the TA recompute trigger + by the claim-approve trigger.
--
-- THRESHOLDS (verified live = §44.7, EXCEPT the cap — see below):
--    • accuracy: ping counts only if accuracy_m IS NULL OR <= 50 (metres)
--    • segment:  a segment counts only if >= 0.010 km (10 m) — drops GPS jitter
--    • speed:    a segment counts only if <= 120 km/h — drops GPS teleport spikes
--    • bike rate: default ₹3/km (v_bike_rate := 3), overridden by the detected
--                 city's bike_per_km.
--
-- ✅ 200 km DAILY CAP (Phase 178.1, owner 23-06-2026). The original live body had
--    NO daily cap (§44.7's "600km" was never in the code). After a 90-day shadow
--    check (only 1 unapproved day fleet-wide exceeded 200km — Mayur 318), the owner
--    set a hard 200 km/day ceiling: LEAST(v_total_km, 200) on the GPS km. An admin
--    ta_override claim stays uncapped (deliberate approval). This is the ONE line
--    that differs from the 2026-06-23 capture → running this file APPLIES the cap.
--
-- 🔒 PAYOUT-SAFETY GUARDS (do NOT remove):
--    • _assert_self_or_admin(p_user_id) — Phase 97.2 security gate.
--    • ON CONFLICT ... DO UPDATE ... WHERE daily_ta.status = 'pending' — a recompute
--      NEVER overwrites an already-APPROVED TA payout. Critical.
--    • ta_override (approved claim) REPLACES the GPS km (admin override path).
--
-- PROVENANCE: captured from the LIVE DB 2026-06-23 via pg_get_functiondef (the
--    phase103_d6 "seg10" version), PLUS the Phase 178.1 200km cap line (the only
--    diff vs the dump). Single signature (uuid, date). Running this file APPLIES
--    the 200km cap — owner must run it once in Studio to make the cap live.
--
-- TRIGGER WIRING (the per-ping TA recompute trigger + the claim-approve
--    trg_ta_claim_recompute in phase36.8) lives in the phase files — NOT here.
--    This canonical owns the function body only.
--
-- SUPERSEDES (Phase 178 removed the body from each; triggers / siblings stay):
--      supabase_phase33h_ta_module.sql            (keeps 3 fns)
--      supabase_phase33i_fixes.sql
--      supabase_phase33q_rep_workflows.sql        (keeps 2 fns)
--      supabase_phase36_8_merge_claims_into_daily_ta.sql (keeps 2 fns + trigger)
--      supabase_phase68_ta_fixes.sql
--      supabase_phase97_2_rpc_role_gates.sql      (keeps 13 fns)
--      supabase_phase103_d6_daily_ta_seg10.sql    (the live body)
--
-- REVERT: re-run this file. TRIPWIRE: VERIFY block at the bottom.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.compute_daily_ta(p_user_id uuid, p_date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
      IF v_seg_km >= 0.010 AND v_seg_speed <= 120 THEN
        v_total_km := v_total_km + v_seg_km;
      END IF;
    END IF;
    v_prev_lat := v_ping.lat;
    v_prev_lng := v_ping.lng;
    v_prev_ts  := v_ping.captured_at;
  END LOOP;

  -- Phase 178.1 (owner 23-06-2026) — hard 200 km/day ceiling on the GPS-computed
  -- km. The per-segment <=120 km/h filter catches teleport spikes; this catches
  -- the rare day that still sums absurdly (e.g. Mayur's 318 km on a bike — the
  -- ONLY >200 day in 90 days across the fleet, unapproved). Applied to GPS km
  -- only; an admin ta_override claim (below) is a deliberate approval and is NOT
  -- capped. Decided after a 90-day shadow check: zero approved days exceed 200.
  v_total_km := LEAST(v_total_km, 200);

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
    COALESCE(SUM(CASE WHEN kind IN ('da_night', 'other') THEN COALESCE(claim_amount, 0) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN kind = 'hotel' THEN COALESCE(claim_amount, 0) ELSE 0 END), 0),
    MAX(CASE WHEN kind = 'ta_override' THEN COALESCE(claim_km, 0) ELSE NULL END)
  INTO v_claim_da, v_claim_hotel, v_override_km
  FROM public.ta_da_requests
  WHERE user_id = p_user_id AND claim_date = p_date AND status = 'approved';

  IF v_override_km IS NOT NULL AND v_override_km > 0 THEN
    v_total_km    := v_override_km;
    v_bike_amount := ROUND(v_override_km * v_bike_rate, 0);
  END IF;

  v_da_amount    := v_da_amount + v_claim_da;
  v_hotel_amount := v_claim_hotel;
  v_total_amount := v_da_amount + v_bike_amount + v_hotel_amount;

  SELECT COALESCE(overnight_stay, false) INTO v_overnight
    FROM work_sessions WHERE user_id = p_user_id AND work_date = p_date;
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

GRANT EXECUTE ON FUNCTION public.compute_daily_ta(uuid, date) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY / TRIPWIRE — read-only, run any time. All six must be TRUE.
-- A FALSE = an older copy was re-run and changed a TA rule → re-run this file.
-- ============================================================================
-- SELECT
--   pg_get_functiondef(p.oid) LIKE '%_assert_self_or_admin%'         AS p97_2_gate,
--   pg_get_functiondef(p.oid) LIKE '%accuracy_m <= 50%'              AS acc_50m,
--   pg_get_functiondef(p.oid) LIKE '%>= 0.010%'                      AS seg_10m,
--   pg_get_functiondef(p.oid) LIKE '%v_seg_speed <= 120%'            AS speed_120,
--   pg_get_functiondef(p.oid) LIKE '%ta_override%'                   AS claim_override_path,
--   pg_get_functiondef(p.oid) LIKE '%daily_ta.status = ''pending''%' AS never_overwrite_approved,
--   pg_get_functiondef(p.oid) LIKE '%LEAST(v_total_km, 200)%'        AS daily_cap_200_live
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = 'compute_daily_ta';
