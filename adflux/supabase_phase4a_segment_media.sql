-- =====================================================================
-- ADFLUX → UNTITLED OS  •  PHASE 4A
-- Migration: add segment + media_type + rate_type to quotes
-- =====================================================================
--
-- WHAT THIS DOES:
--   1. Adds three new columns to the existing `quotes` table:
--        • segment     — 'GOVERNMENT' or 'PRIVATE'
--        • media_type  — LED_OTHER | AUTO_HOOD | GSRTC_LED | HOARDING |
--                        MALL | CINEMA | DIGITAL | OTHER
--        • rate_type   — 'DAVP' or 'AGENCY'
--   2. Backfills the ~50 existing AdFlux quotes to the legacy values
--      (PRIVATE / LED_OTHER / AGENCY) so nothing breaks.
--   3. Locks the columns NOT NULL with CHECK constraints, including a
--      defense-in-depth check that prevents Government from ever being
--      assigned to anything other than AUTO_HOOD or GSRTC_LED.
--
-- DECISIONS BEHIND THIS:
--   - Owner decision (Brijesh, 30 Apr 2026): Government quotes are
--     locked to Auto Hood and GSRTC LED only — no DAVP for hoardings,
--     malls, cinemas, digital, or other media. The check constraint
--     enforces this at the database level even if the UI ever fails.
--   - Existing 50 AdFlux quotes are all Private LED — they get
--     backfilled to (PRIVATE, LED_OTHER, AGENCY) and keep their existing
--     UA-YYYY-NNNN ref numbers.
--
-- WHAT THIS DOES *NOT* TOUCH:
--   - quote_cities (existing line items for LED quotes — still used for
--     Private × LED_OTHER only)
--   - The quote_number_seq sequence (Government formats added in phase4d)
--   - RLS policies (handled separately in phase4e)
--
-- SAFE TO RUN ON STAGING (untitled-os branch + new Supabase) ONLY.
-- DO NOT run on production main yet.
--
-- IDEMPOTENT: re-running this script is safe — all ALTERs use IF NOT
-- EXISTS or guard against existing state.
-- =====================================================================


-- 1) Add columns nullable so backfill can happen first ----------------
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS segment    text,
  ADD COLUMN IF NOT EXISTS media_type text,
  ADD COLUMN IF NOT EXISTS rate_type  text;


-- 2) Backfill existing rows to legacy Private-LED values --------------
UPDATE public.quotes
   SET segment    = 'PRIVATE',
       media_type = 'LED_OTHER',
       rate_type  = 'AGENCY'
 WHERE segment    IS NULL
    OR media_type IS NULL
    OR rate_type  IS NULL;


-- 3) Lock columns NOT NULL --------------------------------------------
ALTER TABLE public.quotes
  ALTER COLUMN segment    SET NOT NULL,
  ALTER COLUMN media_type SET NOT NULL,
  ALTER COLUMN rate_type  SET NOT NULL;


-- 4) Apply CHECK constraints ------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'quotes_segment_check'
  ) THEN
    ALTER TABLE public.quotes
      ADD CONSTRAINT quotes_segment_check
      CHECK (segment IN ('GOVERNMENT', 'PRIVATE'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'quotes_media_type_check'
  ) THEN
    ALTER TABLE public.quotes
      ADD CONSTRAINT quotes_media_type_check
      CHECK (media_type IN (
        'LED_OTHER',
        'AUTO_HOOD',
        'GSRTC_LED',
        'HOARDING',
        'MALL',
        'CINEMA',
        'DIGITAL',
        'OTHER'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'quotes_rate_type_check'
  ) THEN
    ALTER TABLE public.quotes
      ADD CONSTRAINT quotes_rate_type_check
      CHECK (rate_type IN ('DAVP', 'AGENCY'));
  END IF;

  -- Defense-in-depth: Government can ONLY be Auto Hood or GSRTC LED.
  -- This enforces the owner decision even if the wizard UI fails.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'quotes_govt_media_check'
  ) THEN
    ALTER TABLE public.quotes
      ADD CONSTRAINT quotes_govt_media_check
      CHECK (
        segment <> 'GOVERNMENT'
        OR media_type IN ('AUTO_HOOD', 'GSRTC_LED')
      );
  END IF;
END $$;


-- 5) Sensible defaults for new inserts --------------------------------
--    App layer will override these explicitly; defaults only matter if
--    something inserts a row without specifying segment/media/rate.
ALTER TABLE public.quotes
  ALTER COLUMN segment    SET DEFAULT 'PRIVATE',
  ALTER COLUMN media_type SET DEFAULT 'LED_OTHER',
  ALTER COLUMN rate_type  SET DEFAULT 'AGENCY';


-- 6) Indexes for dashboard segment/media filters ----------------------
CREATE INDEX IF NOT EXISTS idx_quotes_segment      ON public.quotes (segment);
CREATE INDEX IF NOT EXISTS idx_quotes_media_type   ON public.quotes (media_type);
CREATE INDEX IF NOT EXISTS idx_quotes_seg_media    ON public.quotes (segment, media_type);


-- =====================================================================
-- VERIFY (run after migration; should return ~50 rows in one bucket):
--
--   SELECT segment, media_type, rate_type, COUNT(*)
--     FROM public.quotes
--    GROUP BY 1,2,3
--    ORDER BY 1,2,3;
--
-- Expected output:
--   PRIVATE | LED_OTHER | AGENCY | ~50
--
-- =====================================================================
