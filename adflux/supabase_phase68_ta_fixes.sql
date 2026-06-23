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
-- -------------------------------------------------------------------------
-- compute_daily_ta REMOVED from this file (Phase 178).
-- Canonical: db/functions/compute_daily_ta.sql  (MONEY function — TA payout)
-- Do NOT re-add it here. Edit the canonical file only (§71). Trigger wiring
-- (per-ping TA recompute + claim-approve) stays in the phase files.
-- -------------------------------------------------------------------------

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
