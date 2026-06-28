-- supabase_phase183_latest_ping_rpc.sql
-- Phase 183 — latest GPS ping per user within a time window, computed
-- server-side via DISTINCT ON. The admin live-map previously pulled EVERY
-- rep's pings for the day and picked latest-per-user client-side — capped at
-- the PostgREST 1000-row limit, so on busy days some reps' last-seen pin was
-- silently dropped. This returns ONE row per user (the latest), uncapped and
-- faster (~N rep rows instead of thousands).
--
-- SECURITY INVOKER → the caller's RLS applies (admin sees all, rep sees own) —
-- NO privilege bypass, identical visibility to the old direct query.
-- RETURNS SETOF gps_pings so the client reads user_id/lat/lng/captured_at/
-- accuracy_m exactly as before. Idempotent (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION public.latest_ping_per_user(
  p_since timestamptz,
  p_until timestamptz
)
RETURNS SETOF public.gps_pings
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT DISTINCT ON (gp.user_id) gp.*
  FROM public.gps_pings gp
  WHERE gp.captured_at >= p_since
    AND gp.captured_at <  p_until
  ORDER BY gp.user_id, gp.captured_at DESC
$$;

GRANT EXECUTE ON FUNCTION public.latest_ping_per_user(timestamptz, timestamptz) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY: returns one row per user who pinged in the window. Expect a small
-- count (number of reps live today), NOT thousands.
-- SELECT count(*) AS reps_with_ping
--   FROM public.latest_ping_per_user(now() - interval '24 hours', now());
