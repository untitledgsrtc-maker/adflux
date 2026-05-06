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

CREATE OR REPLACE FUNCTION public.run_select(sql_text text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  result jsonb;
BEGIN
  -- Hard rejects: anything that isn't a SELECT or a CTE-prefixed SELECT.
  IF NOT (sql_text ~* '^\s*(select|with)\b') THEN
    RAISE EXCEPTION 'Only SELECT or WITH … SELECT statements allowed';
  END IF;
  -- Belt and suspenders — block any DDL/DML keywords even if the entry
  -- gate let a CTE through. \m / \M are Postgres word boundaries.
  IF sql_text ~* '\m(insert|update|delete|drop|truncate|alter|create|grant|revoke)\M' THEN
    RAISE EXCEPTION 'Write/DDL keywords are forbidden in run_select';
  END IF;

  EXECUTE format('SELECT coalesce(jsonb_agg(t), ''[]''::jsonb) FROM (%s) t', sql_text)
    INTO result;

  -- Cap response size at 100 rows even if the inner query didn't have a LIMIT.
  -- We slice in JSON-land instead of wrapping the SQL in `LIMIT 100` because
  -- LIMIT after a CTE-with-aggregation can change the result shape.
  IF jsonb_array_length(result) > 100 THEN
    result := (SELECT jsonb_agg(elem) FROM jsonb_array_elements(result) WITH ORDINALITY AS arr(elem, idx) WHERE idx <= 100);
  END IF;

  RETURN result;
END;
$$;

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
