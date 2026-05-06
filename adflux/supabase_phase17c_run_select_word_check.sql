-- =====================================================================
-- Phase 17c — Co-Pilot fix: replace regex \b (which Postgres treats as
-- backspace, not word boundary) with explicit first-word extraction.
-- =====================================================================
-- Diagnosis (6 May 2026): Claude returns valid plain SELECT queries
-- like  "SELECT COUNT(*) as count FROM leads WHERE created_at IS NOT NULL;"
-- but the regex `^\s*(select|with)\b` still rejects them because
-- Postgres POSIX regex treats `\b` as literal backspace (\x08), NOT
-- the word boundary I expected. The previous fix only LOOKED right.
--
-- This version extracts the first word with split_part(trim(sql_text), ' ', 1),
-- lowercases it, and compares against the allow-list. Deterministic.
-- No regex flavor surprises.
--
-- Block list still uses regex but with `\m` / `\M` (Postgres word
-- boundaries) so DDL/DML detection works correctly.
--
-- IDEMPOTENT: CREATE OR REPLACE.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.run_select(sql_text text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
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
$$;

GRANT EXECUTE ON FUNCTION public.run_select(text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- VERIFY (all should succeed):
--   SELECT public.run_select('SELECT count(*) FROM leads');
--   SELECT public.run_select('SELECT count(*) FROM leads;');
--   SELECT public.run_select('  SELECT id FROM users LIMIT 3');
--   SELECT public.run_select('WITH t AS (SELECT count(*) c FROM leads) SELECT * FROM t');
--
-- VERIFY (these should fail with clear errors):
--   SELECT public.run_select('UPDATE leads SET name=''x''');
--   SELECT public.run_select('DROP TABLE leads');
-- =====================================================================
