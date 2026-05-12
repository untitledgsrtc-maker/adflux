-- =====================================================================
-- Phase 34C — leads.lat / lng for map view + route optimizer
-- 13 May 2026
--
-- WHY
--
-- May 13 sales-module audit item 5 — map view + route optimizer for
-- /work — was blocked because `leads` had no geocoordinates and the
-- `cities` master also had none. A "where to go today" map requires
-- lat/lng per lead (or per city, then per-lead address-level later).
--
-- This migration adds the columns + a "needs geocoding" derived view
-- so the frontend can lazy-geocode rows that arrive without coords.
--
-- WHAT
--
-- 1. Add lat, lng (numeric(10,7)), geocoded_at timestamptz,
--    geocode_source text on `leads`.
-- 2. Index for the "find leads near point" query (later).
-- 3. View leads_needing_geocode — joins lead address fields and
--    returns rows where lat IS NULL but enough address signal exists
--    to attempt geocoding. Frontend reads this view in batches.
--
-- Idempotent. No data backfill; client-side geocoder hits Nominatim
-- on demand and writes back.
-- =====================================================================

-- ─── 1. lat / lng on leads ───────────────────────────────────────────
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS lat             numeric(10, 7),
  ADD COLUMN IF NOT EXISTS lng             numeric(10, 7),
  ADD COLUMN IF NOT EXISTS geocoded_at     timestamptz,
  ADD COLUMN IF NOT EXISTS geocode_source  text;

-- "Find leads near point" partial index — only rows with coords.
CREATE INDEX IF NOT EXISTS idx_leads_lat_lng
  ON public.leads (lat, lng)
  WHERE lat IS NOT NULL AND lng IS NOT NULL;

-- Helps the "needs geocode" view filter.
CREATE INDEX IF NOT EXISTS idx_leads_geocoded_at_null
  ON public.leads (geocoded_at)
  WHERE geocoded_at IS NULL;


-- ─── 2. View: leads that still need geocoding ────────────────────────
-- Returns id + addressable text the frontend can feed Nominatim.
-- We limit to leads with at least a city OR an address so we don't
-- waste API calls on rows with no signal.
CREATE OR REPLACE VIEW public.leads_needing_geocode AS
SELECT
  l.id,
  l.name,
  l.company,
  l.city,
  l.address,
  l.assigned_to
FROM public.leads l
WHERE l.lat IS NULL
  AND l.lng IS NULL
  AND (
    NULLIF(TRIM(l.city),    '') IS NOT NULL
    OR NULLIF(TRIM(l.address), '') IS NOT NULL
  )
  AND l.stage NOT IN ('Lost')
;

GRANT SELECT ON public.leads_needing_geocode TO authenticated;


-- ─── 3. RPC: writeback geocoded lat / lng ────────────────────────────
-- Frontend calls this after Nominatim succeeds. Single round-trip,
-- no race with other writers (we use UPDATE WHERE lat IS NULL so
-- already-geocoded rows are not stomped).
CREATE OR REPLACE FUNCTION public.set_lead_geocode(
  p_lead_id uuid,
  p_lat     numeric,
  p_lng     numeric,
  p_source  text DEFAULT 'nominatim'
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  UPDATE public.leads
     SET lat             = p_lat,
         lng             = p_lng,
         geocoded_at     = now(),
         geocode_source  = p_source,
         updated_at      = now()
   WHERE id = p_lead_id
     AND lat IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_lead_geocode(uuid, numeric, numeric, text) TO authenticated;


NOTIFY pgrst, 'reload schema';


-- ─── VERIFY ──────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name='leads' AND column_name='lat') AS lat_col_exists,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name='leads' AND column_name='lng') AS lng_col_exists,
  (SELECT count(*) FROM information_schema.views
    WHERE table_name='leads_needing_geocode') AS view_exists,
  (SELECT count(*) FROM pg_proc WHERE proname='set_lead_geocode') AS rpc_exists,
  (SELECT count(*) FROM pg_indexes
    WHERE indexname='idx_leads_lat_lng') AS lat_lng_index_exists;
