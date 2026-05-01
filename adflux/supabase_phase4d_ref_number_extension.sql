-- =====================================================================
-- ADFLUX → UNTITLED OS  •  PHASE 4D
-- Migration: extend ref-number generator for Government media formats
-- =====================================================================
--
-- WHAT THIS DOES:
--   1. Adds a `fy_for_date(date)` helper that returns Indian financial
--      year in 'YYYY-YY' format (e.g. April 30 2026 → '2026-27').
--   2. Creates two new race-free sequences (mirrors the existing
--      `quote_number_seq` pattern):
--        • quote_number_seq_auto   — for AUTO_HOOD media
--        • quote_number_seq_gsrtc  — for GSRTC_LED media
--   3. REPLACES the existing `generate_quote_number()` trigger function
--      with a media-aware version that branches on media_type:
--        • AUTO_HOOD  → 'UA/AUTO/2026-27/NNNN'
--        • GSRTC_LED  → 'UA/GSRTC/2026-27/NNNN'
--        • everything else (LED_OTHER, HOARDING, MALL, CINEMA, DIGITAL,
--          OTHER) → legacy 'UA-YYYY-NNNN' format
--      The trigger itself (quotes_quote_number BEFORE INSERT) is
--      unchanged — only the function body is replaced.
--
-- DECISIONS BEHIND THIS:
--   - Govt × Auto and Private × Auto share one sequence — same series
--     (per architecture v2 §9). Same logic for GSRTC.
--   - Legacy format `UA-YYYY-NNNN` is retained for Private LED quotes
--     and any supplementary media (hoarding/mall/etc.) for now. Specific
--     formats for those can be added later without breaking changes.
--   - Generation happens at INSERT (matches existing AdFlux behavior),
--     NOT at first PDF render. Switching to "PDF-render-time generation"
--     is a separate, optional change for later.
--   - `fy_for_date()` is IMMUTABLE so it can be used in indexes/queries.
--   - Existing `quote_number_seq` is kept and continues to drive the
--     legacy `UA-YYYY-NNNN` format. Numbers don't reset by year — same
--     monotonic-forever behavior the original migration set up.
--
-- WHAT THIS DOES *NOT* TOUCH:
--   - Existing 50 quotes' ref numbers — they keep their `UA-2026-NNNN`
--     identifiers untouched.
--   - The trigger (quotes_quote_number) — only the function body changes.
--   - Quote number uniqueness — sequences guarantee no collisions
--     within a series.
--
-- IDEMPOTENT.
-- =====================================================================


-- 1) Helper: fy_for_date — returns 'YYYY-YY' for any date ------------
CREATE OR REPLACE FUNCTION public.fy_for_date(d date)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN EXTRACT(MONTH FROM d) >= 4
      THEN to_char(d, 'YYYY')
        || '-'
        || to_char((d + INTERVAL '1 year')::date, 'YY')
    ELSE to_char((d - INTERVAL '1 year')::date, 'YYYY')
        || '-'
        || to_char(d, 'YY')
  END
$$;

-- Sanity tests (pure expressions, safe to run):
--   SELECT public.fy_for_date(DATE '2026-04-01');  -- expect '2026-27'
--   SELECT public.fy_for_date(DATE '2027-03-31');  -- expect '2026-27'
--   SELECT public.fy_for_date(DATE '2027-04-01');  -- expect '2027-28'


-- 2) New sequences for Government-format ref numbers -----------------
CREATE SEQUENCE IF NOT EXISTS public.quote_number_seq_auto
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;

CREATE SEQUENCE IF NOT EXISTS public.quote_number_seq_gsrtc
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;


-- 3) REPLACE generate_quote_number() with media-aware version --------
--    The trigger `quotes_quote_number BEFORE INSERT ON quotes` already
--    points at this function by name. CREATE OR REPLACE is enough.
CREATE OR REPLACE FUNCTION public.generate_quote_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fy        text;
  v_next_seq  bigint;
BEGIN
  -- Always stamp a fresh server-side number; ignore whatever the
  -- client sent. Preserves the existing AdFlux invariant.

  IF NEW.media_type = 'AUTO_HOOD' THEN
    v_fy := public.fy_for_date(CURRENT_DATE);
    v_next_seq := nextval('public.quote_number_seq_auto');
    NEW.quote_number :=
      'UA/AUTO/' || v_fy || '/' || LPAD(v_next_seq::text, 4, '0');

  ELSIF NEW.media_type = 'GSRTC_LED' THEN
    v_fy := public.fy_for_date(CURRENT_DATE);
    v_next_seq := nextval('public.quote_number_seq_gsrtc');
    NEW.quote_number :=
      'UA/GSRTC/' || v_fy || '/' || LPAD(v_next_seq::text, 4, '0');

  ELSE
    -- LED_OTHER, HOARDING, MALL, CINEMA, DIGITAL, OTHER → legacy format.
    -- Uses the existing quote_number_seq the original AdFlux code seeded.
    v_next_seq := nextval('public.quote_number_seq');
    NEW.quote_number :=
      'UA-' || to_char(CURRENT_DATE, 'YYYY')
            || '-' || LPAD(v_next_seq::text, 4, '0');
  END IF;

  RETURN NEW;
END;
$$;


-- =====================================================================
-- VERIFY:
--
--   -- 1. FY function correctness
--   SELECT
--     public.fy_for_date(DATE '2026-04-01') AS apr_2026,
--     public.fy_for_date(DATE '2027-03-31') AS mar_2027,
--     public.fy_for_date(DATE '2027-04-01') AS apr_2027;
--   -- expect: 2026-27 | 2026-27 | 2027-28
--
--   -- 2. Sequences exist
--   SELECT sequencename
--     FROM pg_sequences
--    WHERE schemaname = 'public'
--      AND sequencename LIKE 'quote_number_seq%'
--    ORDER BY 1;
--   -- expect three rows: quote_number_seq, quote_number_seq_auto,
--   --                    quote_number_seq_gsrtc
--
--   -- 3. Trigger function source has the media branching
--   SELECT prosrc
--     FROM pg_proc
--    WHERE proname = 'generate_quote_number';
--   -- look for AUTO_HOOD / GSRTC_LED in the function body
--
-- =====================================================================
