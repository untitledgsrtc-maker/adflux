-- Phase 446: the running-timer display must not depend on the PC's own clock (an office PC a few minutes behind shows 00:00:00 until it "catches up").
-- The page asks the server for its time once per load and shows elapsed time against that. Idempotent. UNDO: DROP FUNCTION public.work_server_time();
CREATE OR REPLACE FUNCTION public.work_server_time() RETURNS timestamptz
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$ SELECT now() $$;
REVOKE EXECUTE ON FUNCTION public.work_server_time() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.work_server_time() TO authenticated;
NOTIFY pgrst, 'reload schema';
