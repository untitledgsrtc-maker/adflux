-- =====================================================================
-- Cities — youtube_url per station (deck "Watch this station" video)
-- 2026-07-11
--
-- Owner uploads a YouTube link per city in Edit City. The offline pitch deck
-- fetches these live (via /api/deck-videos) when online and shows a "Watch"
-- button on the coverage slide. Additive nullable column; no existing code
-- reads it until the deck/API ship. §45-safe.
-- =====================================================================

ALTER TABLE public.cities
  ADD COLUMN IF NOT EXISTS youtube_url text;

NOTIFY pgrst, 'reload schema';

-- VERIFY (expect 1)
SELECT count(*) AS youtube_col
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'cities' AND column_name = 'youtube_url';
