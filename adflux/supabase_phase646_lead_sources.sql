-- =============================================================================
-- Phase 646 · lead_sources() - distinct lead sources in one request (2026-11-23)
--
-- The Leads chart and Campaign Segments source dropdowns read leads.source with
-- .limit(2000/4000), but the server returns at most 1000 rows (random, no order)
-- out of ~13k, so rare sources could vanish from the dropdown.
-- SECURITY INVOKER: each person still sees only the sources of leads RLS lets
-- them read (same as the old query). Read-only. Safe to re-run.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.lead_sources()
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT source FROM public.leads WHERE source IS NOT NULL AND source <> '' ORDER BY 1
$$;
REVOKE ALL ON FUNCTION public.lead_sources() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lead_sources() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY:
-- SELECT count(*) FROM public.lead_sources();   -- = SELECT count(DISTINCT source) FROM leads WHERE source <> ''
