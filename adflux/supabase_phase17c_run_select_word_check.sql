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

-- -------------------------------------------------------------------------
-- run_select REMOVED from this file (Phase 178).
-- Canonical: db/functions/run_select.sql (Co-Pilot SQL executor; SECURITY INVOKER).
-- Do NOT re-add it here. Edit the canonical file only (§71).
-- -------------------------------------------------------------------------

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
