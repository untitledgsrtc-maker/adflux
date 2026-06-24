-- ============================================================================
-- db/functions/run_select.sql — CANONICAL HOME (Phase 178 / Stage 2)
-- ============================================================================
--
-- ⭐ The ONE place run_select is allowed to live. EDIT THIS FILE to change it;
--    never re-paste it into a new phaseN file (§71). It lived in 3 phase files
--    (phase13_ai_copilot_support, phase17_copilot_run_select_cte,
--    phase17c_run_select_word_check).
--
-- WHAT IT DOES: the AI Co-Pilot's SQL executor (§13). The co-pilot turns a
--    Gujarati/English question into a SELECT; this RPC validates it is read-only,
--    runs it, and returns the rows as jsonb (capped at 100). It executes ARBITRARY
--    caller-supplied SQL — so the security model below is the whole point.
--
-- 🔒 SECURITY MODEL (do NOT weaken any of these):
--    • SECURITY INVOKER — runs as the CALLING user, so RLS applies and a rep can
--      only read their own RLS-visible rows. ⚠ NEVER change to SECURITY DEFINER —
--      that would run as the owner and BYPASS RLS, letting any rep read everyone's
--      data (a breach). Made EXPLICIT here (the live dump implied it via the
--      default; behaviour is identical — invoker IS the default).
--    • First token must be 'select' or 'with' (after stripping a leading comment +
--      trailing ';'); anything else RAISEs.
--    • Write/DDL keyword guard — \m(insert|update|delete|drop|truncate|alter|
--      create|grant|revoke)\M anywhere → RAISE. Defense-in-depth on top of RLS.
--    • 100-row cap applied in jsonb space (a LIMIT in the SQL would mangle CTEs).
--
-- PROVENANCE: captured byte-for-byte from the LIVE DB 2026-06-23 (the phase17c
--    word-check version) — the only addition vs the dump is the explicit
--    SECURITY INVOKER keyword (a no-op clarity guard, see above). Single
--    signature (text). Running this file is a behaviour NO-OP.
--
-- SUPERSEDES (Phase 178 removed the body from each):
--      supabase_phase13_ai_copilot_support.sql
--      supabase_phase17_copilot_run_select_cte.sql
--      supabase_phase17c_run_select_word_check.sql
--
-- REVERT: re-run this file. TRIPWIRE: VERIFY block at the bottom — the
-- `not_security_definer` check is the breach tripwire; it MUST stay TRUE.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.run_select(sql_text text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
AS $function$
DECLARE
  result      jsonb;
  cleaned     text;
  first_word  text;
BEGIN
  -- Strip a leading SQL comment (single line) if Claude prefixed one.
  cleaned := regexp_replace(sql_text, '^\s*--[^\n]*\n', '', 'n');
  cleaned := trim(cleaned);

  -- Extract the first whitespace-delimited token, lowercase it.
  first_word := lower(regexp_replace(cleaned, '\s.*$', ''));
  -- regexp_replace strips a trailing semicolon if the SQL is just `select;`
  first_word := regexp_replace(first_word, ';.*$', '');

  IF first_word NOT IN ('select', 'with') THEN
    RAISE EXCEPTION 'Only SELECT or WITH … SELECT statements allowed (got: %)', first_word;
  END IF;

  -- DDL/DML guard. Postgres POSIX word boundaries are \m (start) and
  -- \M (end). Don't use \b — that's backspace.
  IF cleaned ~* '\m(insert|update|delete|drop|truncate|alter|create|grant|revoke)\M' THEN
    RAISE EXCEPTION 'Write/DDL keywords are forbidden in run_select';
  END IF;

  -- Strip trailing semicolon — EXECUTE format() doesn't like it inside
  -- the subquery wrapper.
  cleaned := regexp_replace(cleaned, ';\s*$', '');

  EXECUTE format('SELECT coalesce(jsonb_agg(t), ''[]''::jsonb) FROM (%s) t', cleaned)
    INTO result;

  -- Cap at 100 rows in jsonb space (LIMIT inside the SQL would mangle CTEs).
  IF jsonb_array_length(result) > 100 THEN
    result := (
      SELECT jsonb_agg(elem)
      FROM jsonb_array_elements(result) WITH ORDINALITY AS arr(elem, idx)
      WHERE idx <= 100
    );
  END IF;

  RETURN result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.run_select(text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY / TRIPWIRE — read-only, run any time. All six must be TRUE.
-- not_security_definer is the BREACH tripwire (SECURITY DEFINER would bypass RLS).
-- ============================================================================
-- SELECT
--   pg_get_functiondef(p.oid) NOT LIKE '%SECURITY DEFINER%'          AS not_security_definer,
--   pg_get_functiondef(p.oid) LIKE '%first_word NOT IN (''select'', ''with'')%' AS select_with_only,
--   pg_get_functiondef(p.oid) LIKE '%Write/DDL keywords are forbidden%' AS ddl_guard,
--   pg_get_functiondef(p.oid) LIKE '%truncate|alter|create%'          AS keyword_blocklist,
--   pg_get_functiondef(p.oid) LIKE '%jsonb_agg%'                      AS jsonb_wrapper,
--   pg_get_functiondef(p.oid) LIKE '%idx <= 100%'                     AS row_cap_100
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = 'run_select';
