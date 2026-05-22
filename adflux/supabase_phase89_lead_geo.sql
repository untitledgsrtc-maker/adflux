-- supabase_phase89_lead_geo.sql
--
-- Phase 89.3 — Permanent lead pins on the live field map.
--
-- Owner directive 23 May 2026:
--   "Permanent lead address pin (lat/lng on leads table, set once
--    via address). Phase 89.3 candidate. Needs SQL + LeadFormV2
--    capture. ... and it must seen. alway in map. via date filter
--    we can see all meeting leads"
--
-- Strategy
--   • cities master gets lat / lng columns (additive).
--   • leads gets lat / lng columns (additive).
--   • Trigger on leads INSERT/UPDATE: if lat IS NULL AND city IS
--     NOT NULL, look up the city in cities master + inherit
--     lat/lng. Sales rep never sees the field — fully automatic.
--   • Backfill: existing leads pick up the city centroid the
--     first time the trigger runs after the seed below populates
--     ~12 main Gujarat cities.
--
-- Coverage: 12 cities = the entire current lead distribution from
-- the production Cronberry import. Other cities stay null → no
-- pin, no harm. Admin can extend cities lat/lng via Master tab in
-- a follow-up commit (Phase 89.3b).
--
-- Idempotent.

ALTER TABLE public.cities
  ADD COLUMN IF NOT EXISTS lat numeric,
  ADD COLUMN IF NOT EXISTS lng numeric;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS lat numeric,
  ADD COLUMN IF NOT EXISTS lng numeric;

-- ─────────────────────────────────────────────────────────────────
-- Seed ~12 main Gujarat city centroids on the cities master.
-- Coordinates are from public Google Maps city centers (decimal
-- degrees, WGS84). Idempotent: only sets lat/lng if currently null
-- so admin edits via the Master tab (Phase 89.3b) won't be
-- overwritten on re-run.
-- ─────────────────────────────────────────────────────────────────
UPDATE public.cities SET lat = 22.3072, lng = 73.1812 WHERE name ILIKE 'Vadodara' AND lat IS NULL;
UPDATE public.cities SET lat = 23.0225, lng = 72.5714 WHERE name ILIKE 'Ahmedabad' AND lat IS NULL;
UPDATE public.cities SET lat = 21.1702, lng = 72.8311 WHERE name ILIKE 'Surat'    AND lat IS NULL;
UPDATE public.cities SET lat = 22.3039, lng = 70.8022 WHERE name ILIKE 'Rajkot'   AND lat IS NULL;
UPDATE public.cities SET lat = 21.7645, lng = 72.1519 WHERE name ILIKE 'Bhavnagar' AND lat IS NULL;
UPDATE public.cities SET lat = 21.5222, lng = 70.4579 WHERE name ILIKE 'Junagadh' AND lat IS NULL;
UPDATE public.cities SET lat = 22.4707, lng = 70.0577 WHERE name ILIKE 'Jamnagar' AND lat IS NULL;
UPDATE public.cities SET lat = 22.5645, lng = 72.9289 WHERE name ILIKE 'Anand'    AND lat IS NULL;
UPDATE public.cities SET lat = 22.6939, lng = 72.8628 WHERE name ILIKE 'Nadiad'   AND lat IS NULL;
UPDATE public.cities SET lat = 21.6048, lng = 71.2207 WHERE name ILIKE 'Amreli'   AND lat IS NULL;
UPDATE public.cities SET lat = 21.6417, lng = 69.6293 WHERE name ILIKE 'Porbandar' AND lat IS NULL;
UPDATE public.cities SET lat = 23.2156, lng = 72.6369 WHERE name ILIKE 'Gandhinagar' AND lat IS NULL;
UPDATE public.cities SET lat = 21.7051, lng = 73.0027 WHERE name ILIKE 'Bharuch'  AND lat IS NULL;
UPDATE public.cities SET lat = 23.5880, lng = 72.3693 WHERE name ILIKE 'Mehsana'  AND lat IS NULL;
UPDATE public.cities SET lat = 24.5854, lng = 72.7081 WHERE name ILIKE 'Palanpur' AND lat IS NULL;
UPDATE public.cities SET lat = 22.6716, lng = 71.5724 WHERE name ILIKE 'Surendranagar' AND lat IS NULL;

-- ─────────────────────────────────────────────────────────────────
-- Trigger: when a lead is inserted or its city changes, inherit
-- lat/lng from the cities master if not already set. Manual
-- overrides win (lat or lng explicitly provided survives).
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fill_lead_geo_from_city()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_lat numeric;
  v_lng numeric;
BEGIN
  -- Only act when lat/lng aren't manually supplied AND city is set.
  IF (NEW.lat IS NULL OR NEW.lng IS NULL) AND NEW.city IS NOT NULL THEN
    SELECT lat, lng INTO v_lat, v_lng
      FROM public.cities
      WHERE name ILIKE NEW.city
      LIMIT 1;
    IF v_lat IS NOT NULL AND v_lng IS NOT NULL THEN
      NEW.lat := COALESCE(NEW.lat, v_lat);
      NEW.lng := COALESCE(NEW.lng, v_lng);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fill_lead_geo_from_city ON public.leads;
CREATE TRIGGER trg_fill_lead_geo_from_city
  BEFORE INSERT OR UPDATE OF city, lat, lng
  ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.fill_lead_geo_from_city();

-- ─────────────────────────────────────────────────────────────────
-- Backfill existing leads: bump them through the trigger by
-- touching `city`. Touching the column with its own value triggers
-- the BEFORE UPDATE → lat/lng fills if it was null. RLS-safe:
-- runs as the SQL editor's role (admin).
-- ─────────────────────────────────────────────────────────────────
UPDATE public.leads SET city = city WHERE lat IS NULL AND city IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- VERIFY
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='leads'
--      AND column_name IN ('lat','lng');
--   → 2 rows.
--
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='cities'
--      AND column_name IN ('lat','lng');
--   → 2 rows.
--
--   SELECT COUNT(*) FROM public.cities WHERE lat IS NOT NULL;
--   → ≥ 12 (the seed) — more if owner added rows manually.
--
--   SELECT COUNT(*) FROM public.leads WHERE lat IS NOT NULL;
--   → expected count = leads whose city matches a seeded master row.
--
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'public.leads'::regclass
--      AND tgname = 'trg_fill_lead_geo_from_city';
--   → 1 row.
