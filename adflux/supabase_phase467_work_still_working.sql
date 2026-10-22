-- Phase 467: "Still working?" for timers with no PC activity (browser / phone).
-- The person confirms from My Work; with no confirmation for 3 hours the server stops the timer at that point.
ALTER TABLE public.work_time_entries ADD COLUMN IF NOT EXISTS last_confirmed_at timestamptz;

CREATE OR REPLACE FUNCTION public.work_confirm_working() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.work_is_active_user() THEN RAISE EXCEPTION 'login required' USING ERRCODE='42501'; END IF;
  UPDATE public.work_time_entries SET last_confirmed_at = now() WHERE user_id = auth.uid() AND ended_at IS NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.work_confirm_working() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.work_confirm_working() TO authenticated;

CREATE OR REPLACE FUNCTION public.work_stop_unconfirmed_timers() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n int;
BEGIN
  WITH t AS (
    SELECT e.id, GREATEST(e.started_at, COALESCE(e.last_confirmed_at, e.started_at)) + interval '3 hours' AS stop_at
      FROM public.work_time_entries e
     WHERE e.ended_at IS NULL
       AND GREATEST(e.started_at, COALESCE(e.last_confirmed_at, e.started_at)) < now() - interval '3 hours'
       AND NOT EXISTS (SELECT 1 FROM public.work_activity_slices s WHERE s.entry_id = e.id)
  )
  UPDATE public.work_time_entries e
     SET ended_at = t.stop_at, auto_stopped = true,
         note = left(coalesce(e.note || ' | ', '') || 'Stopped: no answer to still working', 500)
    FROM t WHERE e.id = t.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
EXCEPTION WHEN OTHERS THEN RETURN 0;
END;
$$;
REVOKE ALL ON FUNCTION public.work_stop_unconfirmed_timers() FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule('work-stop-unconfirmed') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='work-stop-unconfirmed');
SELECT cron.schedule('work-stop-unconfirmed', '*/10 * * * *', $$SELECT public.work_stop_unconfirmed_timers()$$);
NOTIFY pgrst, 'reload schema';
