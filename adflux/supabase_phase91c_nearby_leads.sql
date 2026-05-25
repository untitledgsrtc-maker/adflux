-- =====================================================================
-- Phase 91c — Nearby leads RPC for /work proximity card
-- 24 May 2026
--
-- WHY
--
-- Sales reps are in the field with GPS already on. Today there's no
-- "lead X is 800m away — drop in" surface. /work has a Google Maps
-- panel (Phase 89.11) but it only shows the rep's own meeting pins,
-- not other open leads nearby.
--
-- This RPC returns leads assigned to the calling rep within a radius
-- of a passed-in lat/lng, sorted by distance ascending. Frontend
-- (NearbyLeadsCard.jsx) calls it with `navigator.geolocation` coords
-- and a 2km default radius. Renders only when ≥1 result.
--
-- WHAT
--
-- 1. nearby_leads_for_user(p_user uuid, p_lat float, p_lng float,
--                          p_radius_m int) — Haversine distance.
--    Excludes Won / Lost stages (no point routing rep to a closed deal).
--    Excludes leads without coords (lat IS NULL OR lng IS NULL).
--    Sorted ASC by distance, capped at 20 rows.
--
-- 2. Reuses existing idx_leads_lat_lng partial index from Phase 34C.
--    No new index needed.
--
-- 3. SECURITY INVOKER. Caller's RLS on leads enforces
--    assigned_to=auth.uid() — the function does NOT bypass that.
--
-- Idempotent. CREATE OR REPLACE FUNCTION.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.nearby_leads_for_user(
  p_user     uuid,
  p_lat      double precision,
  p_lng      double precision,
  p_radius_m int DEFAULT 2000
)
RETURNS TABLE (
  id          uuid,
  name        text,
  company     text,
  phone       text,
  city        text,
  heat        text,
  stage       text,
  lat         numeric,
  lng         numeric,
  distance_m  int
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    l.id,
    l.name,
    l.company,
    l.phone,
    l.city,
    l.heat,
    l.stage,
    l.lat,
    l.lng,
    (6371000 * 2 * asin(sqrt(
        power(sin(radians((l.lat::double precision - p_lat) / 2)), 2) +
        cos(radians(p_lat)) * cos(radians(l.lat::double precision)) *
        power(sin(radians((l.lng::double precision - p_lng) / 2)), 2)
    )))::int AS distance_m
  FROM public.leads l
  WHERE l.assigned_to = p_user
    AND l.lat IS NOT NULL
    AND l.lng IS NOT NULL
    AND l.stage NOT IN ('Won', 'Lost')
    AND (6371000 * 2 * asin(sqrt(
        power(sin(radians((l.lat::double precision - p_lat) / 2)), 2) +
        cos(radians(p_lat)) * cos(radians(l.lat::double precision)) *
        power(sin(radians((l.lng::double precision - p_lng) / 2)), 2)
    ))) <= p_radius_m
  ORDER BY distance_m ASC
  LIMIT 20;
$$;

GRANT EXECUTE ON FUNCTION public.nearby_leads_for_user(uuid, double precision, double precision, int) TO authenticated;

NOTIFY pgrst, 'reload schema';


-- ─── VERIFY ──────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM pg_proc WHERE proname='nearby_leads_for_user') AS rpc_exists,
  (SELECT count(*) FROM pg_indexes
    WHERE indexname='idx_leads_lat_lng') AS index_exists,
  (SELECT count(*) FROM information_schema.routine_privileges
    WHERE routine_name='nearby_leads_for_user' AND grantee='authenticated') AS grant_exists;
