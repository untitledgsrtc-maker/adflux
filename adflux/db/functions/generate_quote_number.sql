-- ============================================================================
-- db/functions/generate_quote_number.sql — CANONICAL HOME (Phase 178 / Stage 2)
-- ============================================================================
--
-- ⭐ The ONE place generate_quote_number is allowed to live (for PHASE-FILE work).
--    EDIT THIS FILE to change it; never re-paste it into a new phaseN file (§71).
--    It lived in 2 phase files (phase4d, quote_number_fix) + the 2 base snapshots.
--
-- WHAT IT DOES: BEFORE-INSERT trigger on quotes. Always stamps a fresh server-side
--    quote_number by media_type (ignores whatever the client sent). Three sequences.
--
-- §4 LOCKED REF FORMATS (do NOT change — existing 50+ quotes depend on them):
--    • AUTO_HOOD → 'UA/AUTO/'  || fy || '/' || LPAD(seq,4)   (quote_number_seq_auto)
--    • GSRTC_LED → 'UA/GSRTC/' || fy || '/' || LPAD(seq,4)   (quote_number_seq_gsrtc)
--    • else      → 'UA-' || YYYY || '-' || LPAD(seq,4)       (quote_number_seq, legacy)
--      (LED_OTHER, HOARDING, MALL, CINEMA, DIGITAL, OTHER all use the legacy form.)
--
-- PROVENANCE: captured byte-for-byte from the LIVE DB 2026-06-23 via
--    pg_get_functiondef. Single signature (trigger fn). Running this file is a NO-OP.
--
-- ⚠ BASE SNAPSHOTS keep their copy ON PURPOSE: supabase_all_migrations.sql +
--    supabase_schema.sql are full-schema fresh-install dumps — they must stay
--    COMPLETE to bootstrap a new DB, so their generate_quote_number is NOT removed.
--    They are excluded from check-duplication.sh's count (they are generated
--    artifacts, not the phase-file disease). Only the 2 PHASE-FILE copies were
--    defused. If the snapshots are ever regenerated, regenerate from this canonical.
--
-- TRIGGER WIRING (quotes_quote_number BEFORE INSERT on quotes) lives in the
--    snapshots — NOT here. This canonical owns the function body only.
--
-- SUPERSEDES (Phase 178 removed the body from the 2 phase files):
--      supabase_phase4d_ref_number_extension.sql
--      supabase_quote_number_fix.sql
--
-- REVERT: re-run this file. TRIPWIRE: VERIFY block at the bottom.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.generate_quote_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY / TRIPWIRE — read-only, run any time. All five must be TRUE.
-- ============================================================================
-- SELECT
--   pg_get_functiondef(p.oid) LIKE '%UA/AUTO/%'                 AS auto_hood_format,
--   pg_get_functiondef(p.oid) LIKE '%UA/GSRTC/%'                AS gsrtc_format,
--   pg_get_functiondef(p.oid) LIKE '%UA-%'                      AS legacy_format,
--   pg_get_functiondef(p.oid) LIKE '%quote_number_seq_auto%'    AS auto_sequence,
--   pg_get_functiondef(p.oid) LIKE '%quote_number_seq_gsrtc%'   AS gsrtc_sequence
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = 'generate_quote_number';
