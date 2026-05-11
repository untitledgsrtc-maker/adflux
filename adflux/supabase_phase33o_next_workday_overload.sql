-- supabase_phase33o_next_workday_overload.sql
--
-- Phase 33O — fix the stage-change error owner caught on /leads/:id:
--   Stage change failed: function public.next_workday(timestamp
--   without time zone) does not exist
--
-- Root cause: Phase 33D.6's next_workday signature is (date).
-- Internal callers pass `p_base + (X || ' days')::interval` which
-- Postgres promotes to `timestamp without time zone` when p_base
-- is a date. Postgres requires exact type match for function
-- dispatch — no implicit timestamp → date coercion.
--
-- Fix: add an overload that accepts timestamp and casts internally.
-- The original date-version function is preserved.

CREATE OR REPLACE FUNCTION public.next_workday(ts timestamp)
RETURNS date
LANGUAGE sql IMMUTABLE
AS $$
  SELECT public.next_workday(ts::date);
$$;

-- Same for timestamptz just in case anything passes a tz-aware value.
CREATE OR REPLACE FUNCTION public.next_workday(ts timestamptz)
RETURNS date
LANGUAGE sql IMMUTABLE
AS $$
  SELECT public.next_workday(ts::date);
$$;

GRANT EXECUTE ON FUNCTION public.next_workday(timestamp)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_workday(timestamptz) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY:
--   SELECT next_workday(CURRENT_DATE + INTERVAL '3 days');
--   SELECT next_workday(now());
--   Both should return a date (with Sundays skipped).
