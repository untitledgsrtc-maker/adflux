-- =====================================================================
-- Phase 17 — Co-Pilot fix: allow CTEs (WITH … SELECT) in run_select
-- =====================================================================
-- Owner reported (6 May 2026): Co-Pilot opens, query goes to Claude,
-- Claude returns a plan, but the function returns "Query failed: Only
-- SELECT statements allowed". Root cause: the run_select RPC's regex
-- (`^\s*select\b`) only matches plain SELECT and rejects valid
-- WITH ... SELECT (CTE) queries that Claude often generates for
-- multi-step rollups.
--
-- This migration relaxes the entry regex to accept either SELECT or
-- WITH at the start. The DDL/DML guard (insert/update/delete/drop/
-- truncate/alter/create/grant/revoke) stays in place — a hostile
-- WITH ... INSERT is still blocked.
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
-- VERIFY:
--   -- both should succeed:
--   SELECT public.run_select('SELECT id, name FROM users LIMIT 3');
--   SELECT public.run_select('WITH t AS (SELECT count(*) c FROM leads) SELECT * FROM t');
--   -- this should still fail:
--   SELECT public.run_select('UPDATE leads SET name = ''x''');
-- =====================================================================
