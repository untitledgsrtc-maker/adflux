-- supabase_phase33h_ta_module.sql
--
-- Phase 33H (item D) — TA (Travel Allowance) auto-calculator.
--
-- Owner directive: TA should be computed automatically from the GPS
-- pings already logged via Phase 31Z (gps_pings table, 5-min interval
-- during /work check-in). Finance team sees per-rep daily breakdown
-- and pays accordingly.
--
-- Ceiling sheet from owner (20 cities):
--   • Daily DA: ₹200 flat across all categories
--   • Bike:     ₹3/km flat across all categories
--   • Hotel:    A=₹1100, B=₹900, C=₹700 (incl. GST)
--
-- v1 scope:
--   1. city_da_ceilings master — centroid + radius for "in which city"
--      detection. Category drives hotel rate only.
--   2. daily_ta — one row per rep per day with km / DA / bike / hotel
--      / total / status (pending / approved / paid / rejected).
--   3. compute_daily_ta(user_id, date) — aggregator.
--      a. Read gps_pings for the day, ordered by captured_at.
--      b. Discard accuracy_m > 200 (bad fix).
--      c. Compute pairwise haversine_km between consecutive pings.
--      d. Discard segments < 0.03 km (30m jitter at standstill).
--      e. Discard segments implying speed > 200 km/h (bad data).
--      f. Sum remaining → total km.
--      g. Bucket pings into cities via detect_city(lat, lng). Primary
--         city = the one with the most pings.
--      h. If primary city is Vadodara (home) → DA = 0 (local work).
--      i. da_amount = city.daily_da
--         bike_amount = round(total_km * city.bike_per_km)
--         hotel_amount = 0 in v1 (admin can edit manually).
--      j. Upsert into daily_ta with status='pending'.
--   4. backfill_ta(user_id, month_start) — loops over a month.
--   5. RLS — rep reads own; admin/co_owner full CRUD.
--
-- NOT in v1 (defer):
--   - Auto-hotel detection (overnight stay logic).
--   - Per-city CRUD UI (admin edits via Supabase Studio for now).
--   - Edge Function nightly cron — admin clicks "recompute" button
--     from the TA page instead.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
-- DROP POLICY IF EXISTS / CREATE POLICY, ON CONFLICT DO NOTHING seeds.

-- ─── 1. city_da_ceilings ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.city_da_ceilings (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  city_name       text NOT NULL UNIQUE,
  category        text NOT NULL CHECK (category IN ('A','B','C')),
  daily_da        numeric NOT NULL DEFAULT 200,
  bike_per_km     numeric NOT NULL DEFAULT 3,
  hotel_rate      numeric NOT NULL DEFAULT 700,
  center_lat      numeric(10,7) NOT NULL,
  center_lng      numeric(10,7) NOT NULL,
  -- Radius (km) within which a GPS ping counts as "in this city".
  radius_km       numeric NOT NULL DEFAULT 15,
  -- is_home flag — Vadodara HQ. DA/bike skipped when primary city is home.
  is_home         boolean NOT NULL DEFAULT false,
  is_active       boolean NOT NULL DEFAULT true,
  display_order   int NOT NULL DEFAULT 0,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_city_da_ceilings_active
  ON public.city_da_ceilings (is_active);

-- ─── 2. daily_ta ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.daily_ta (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ta_date         date NOT NULL,
  primary_city    text,
  city_category   text,
  km_traveled     numeric NOT NULL DEFAULT 0,
  da_amount       numeric NOT NULL DEFAULT 0,
  bike_amount     numeric NOT NULL DEFAULT 0,
  hotel_amount    numeric NOT NULL DEFAULT 0,
  total_amount    numeric NOT NULL DEFAULT 0,
  -- pending = freshly computed, awaiting admin review
  -- approved = admin signed off, ready for finance
  -- paid = finance has paid it out
  -- rejected = admin marked invalid (e.g., suspect GPS, no real visit)
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','paid','rejected')),
  gps_pings_count int NOT NULL DEFAULT 0,
  notes           text,
  computed_at     timestamptz DEFAULT now(),
  approved_by     uuid REFERENCES users(id),
  approved_at     timestamptz,
  UNIQUE (user_id, ta_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_ta_user_date
  ON public.daily_ta (user_id, ta_date DESC);

CREATE INDEX IF NOT EXISTS idx_daily_ta_status
  ON public.daily_ta (status);

-- ─── 3. Helper: haversine_km ──────────────────────────────────────
-- Earth distance between two lat/lng points in kilometres.
-- Mean Earth radius = 6371 km. Numerically stable across small deltas.
CREATE OR REPLACE FUNCTION public.haversine_km(
  lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric
) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  r       constant numeric := 6371;
  dlat    numeric;
  dlng    numeric;
  a       numeric;
  c       numeric;
BEGIN
  IF lat1 IS NULL OR lat2 IS NULL OR lng1 IS NULL OR lng2 IS NULL THEN
    RETURN 0;
  END IF;
  dlat := radians(lat2 - lat1);
  dlng := radians(lng2 - lng1);
  a := sin(dlat/2)^2
       + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlng/2)^2;
  c := 2 * atan2(sqrt(a), sqrt(1 - a));
  RETURN r * c;
END $$;

-- ─── 4. Helper: detect_city ───────────────────────────────────────
-- Returns the nearest active city whose radius contains the point.
-- If multiple cities cover the point (overlapping radii), pick the
-- one whose centroid is closest.
CREATE OR REPLACE FUNCTION public.detect_city(
  p_lat numeric, p_lng numeric
) RETURNS TABLE (
  city_name text,
  category  text,
  is_home   boolean,
  daily_da  numeric,
  bike_per_km numeric,
  hotel_rate  numeric,
  distance_km numeric
)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT c.city_name, c.category, c.is_home,
         c.daily_da, c.bike_per_km, c.hotel_rate,
         public.haversine_km(c.center_lat, c.center_lng, p_lat, p_lng) AS d
    FROM public.city_da_ceilings c
   WHERE c.is_active = true
     AND public.haversine_km(c.center_lat, c.center_lng, p_lat, p_lng) <= c.radius_km
   ORDER BY d ASC
   LIMIT 1;
END $$;

-- ─── 5. compute_daily_ta(user_id, date) ───────────────────────────
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
  -- Walk the day's pings in time order. Apply noise filters as we go.
  FOR v_ping IN
    SELECT captured_at, lat, lng, accuracy_m
      FROM public.gps_pings
     WHERE user_id = p_user_id
       AND captured_at >= p_date::timestamptz
       AND captured_at <  (p_date + 1)::timestamptz
       AND (accuracy_m IS NULL OR accuracy_m <= 200)  -- discard bad fixes
     ORDER BY captured_at ASC
  LOOP
    v_ping_count := v_ping_count + 1;

    IF v_prev_lat IS NOT NULL THEN
      v_seg_km  := public.haversine_km(v_prev_lat, v_prev_lng, v_ping.lat, v_ping.lng);
      v_seg_hrs := GREATEST(EXTRACT(EPOCH FROM (v_ping.captured_at - v_prev_ts)) / 3600.0, 0.0001);
      v_seg_speed := v_seg_km / v_seg_hrs;

      -- Jitter at standstill: < 30m. Skip.
      -- Impossible speed: > 200 km/h. Skip (bad data).
      IF v_seg_km >= 0.03 AND v_seg_speed <= 200 THEN
        v_total_km := v_total_km + v_seg_km;
      END IF;
    END IF;

    v_prev_lat := v_ping.lat;
    v_prev_lng := v_ping.lng;
    v_prev_ts  := v_ping.captured_at;
  END LOOP;

  -- Primary city = most-frequent city across all today's pings.
  -- Pings outside any city's radius are simply not counted in this
  -- groupby. If NO ping fell inside any city, primary_city stays NULL
  -- and DA = 0.
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

  -- Home city (Vadodara) → no TA. Reps don't claim DA for local work.
  IF v_is_home THEN
    v_da_amount    := 0;
    v_bike_amount  := 0;
  ELSIF v_primary_city IS NOT NULL THEN
    v_da_amount    := v_daily_da;
    v_bike_amount  := ROUND(v_total_km * v_bike_rate, 0);
  END IF;

  v_total_amount := v_da_amount + v_bike_amount;  -- hotel = 0 in v1

  -- Upsert.
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
        -- hotel_amount preserved on update — admin may have set it.
        total_amount    = EXCLUDED.da_amount + EXCLUDED.bike_amount + daily_ta.hotel_amount,
        gps_pings_count = EXCLUDED.gps_pings_count,
        computed_at     = now()
    -- Only re-update rows still in 'pending' status. If admin already
    -- approved/paid, leave it alone — admin would have to flip back
    -- to pending before a re-compute lands.
    WHERE daily_ta.status = 'pending';
END $$;

GRANT EXECUTE ON FUNCTION public.compute_daily_ta(uuid, date) TO authenticated;

-- ─── 6. backfill_ta(user_id, month_start) ─────────────────────────
CREATE OR REPLACE FUNCTION public.backfill_ta(
  p_user_id uuid, p_month_start date
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d  date;
  n  int := 0;
BEGIN
  FOR d IN
    SELECT generate_series(
      p_month_start,
      LEAST((p_month_start + INTERVAL '1 month' - INTERVAL '1 day')::date, CURRENT_DATE),
      '1 day'
    )::date
  LOOP
    PERFORM public.compute_daily_ta(p_user_id, d);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

GRANT EXECUTE ON FUNCTION public.backfill_ta(uuid, date) TO authenticated;

-- ─── 7. RLS ───────────────────────────────────────────────────────
ALTER TABLE public.city_da_ceilings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_ta         ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ceilings_read_all ON public.city_da_ceilings;
DROP POLICY IF EXISTS ceilings_admin    ON public.city_da_ceilings;
DROP POLICY IF EXISTS ta_self_read      ON public.daily_ta;
DROP POLICY IF EXISTS ta_admin_all      ON public.daily_ta;

-- Every authenticated user reads ceilings (so reps can see why
-- their TA was X). Only admin/co_owner edits.
CREATE POLICY ceilings_read_all ON public.city_da_ceilings
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY ceilings_admin ON public.city_da_ceilings
  FOR ALL USING (public.get_my_role() IN ('admin','co_owner'))
  WITH CHECK (public.get_my_role() IN ('admin','co_owner'));

-- Reps see their own TA rows; admin sees everyone's.
CREATE POLICY ta_self_read ON public.daily_ta
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY ta_admin_all ON public.daily_ta
  FOR ALL USING (public.get_my_role() IN ('admin','co_owner'))
  WITH CHECK (public.get_my_role() IN ('admin','co_owner'));

-- ─── 8. Seed city ceilings ────────────────────────────────────────
-- Source: owner's TA expense ceilings doc (20 cities + Vadodara HQ).
-- Coordinates are city-centre approximations. Radius set by category:
--   A = 30 km (large metro)
--   B = 20 km (mid)
--   C = 15 km (small)
-- Vadodara HQ uses 25 km — local work radius for the home office.
INSERT INTO public.city_da_ceilings
  (city_name, category, daily_da, bike_per_km, hotel_rate, center_lat, center_lng, radius_km, is_home, display_order)
VALUES
  ('Vadodara',         'A', 0,   3, 0,    22.3072, 73.1812, 25, true,  0),  -- HQ
  ('Anand',            'C', 200, 3, 700,  22.5645, 72.9289, 15, false, 1),
  ('Kheda / Nadiad',   'C', 200, 3, 700,  22.6939, 72.8634, 15, false, 2),
  ('Gandhinagar',      'B', 200, 3, 900,  23.2156, 72.6369, 20, false, 3),
  ('Himmatnagar',      'C', 200, 3, 700,  23.5984, 72.9636, 15, false, 4),
  ('Dahod',            'C', 200, 3, 700,  22.8367, 74.2588, 15, false, 5),
  ('Godhra',           'C', 200, 3, 700,  22.7758, 73.6147, 15, false, 6),
  ('Ankleshwar GIDC',  'B', 200, 3, 900,  21.6356, 73.0089, 20, false, 7),
  ('Surat (City)',     'A', 200, 3, 1100, 21.1702, 72.8311, 30, false, 8),
  ('Valsad / Vapi',    'B', 200, 3, 900,  20.6113, 72.9342, 20, false, 9),
  ('Chikhli',          'C', 200, 3, 700,  20.7572, 72.9942, 15, false, 10),
  ('Botad',            'C', 200, 3, 700,  22.1736, 71.6675, 15, false, 11),
  ('Bhavnagar',        'B', 200, 3, 900,  21.7645, 72.1519, 20, false, 12),
  ('Veraval',          'C', 200, 3, 700,  20.9047, 70.3597, 15, false, 13),
  ('Junagadh',         'B', 200, 3, 900,  21.5222, 70.4579, 20, false, 14),
  ('Porbandar',        'C', 200, 3, 700,  21.6417, 69.6293, 15, false, 15),
  ('Dwarka',           'C', 200, 3, 700,  22.2394, 68.9678, 15, false, 16),
  ('Jamnagar',         'B', 200, 3, 900,  22.4707, 70.0577, 20, false, 17),
  ('Morbi',            'C', 200, 3, 700,  22.8173, 70.8378, 15, false, 18),
  ('Bhachau (Kutch)',  'C', 200, 3, 700,  23.2839, 70.3439, 15, false, 19),
  ('Surendranagar',    'C', 200, 3, 700,  22.7196, 71.6369, 15, false, 20)
ON CONFLICT (city_name) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- VERIFY:
-- 1. Cities seeded:
--    SELECT COUNT(*) FROM city_da_ceilings;
--    Expect: 21 (Vadodara + 20 travel cities).
-- 2. Test detect_city against a known coord (Surat):
--    SELECT * FROM detect_city(21.1702, 72.8311);
--    Expect: row with city_name='Surat (City)', category='A'.
-- 3. Compute TA for a rep on a recent date:
--    SELECT compute_daily_ta('<rep_uuid>', current_date - 1);
--    SELECT * FROM daily_ta
--      WHERE user_id='<rep_uuid>' AND ta_date=current_date - 1;
-- 4. Backfill the current month for one rep:
--    SELECT backfill_ta('<rep_uuid>', date_trunc('month', current_date)::date);
