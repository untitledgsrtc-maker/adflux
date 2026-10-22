-- Phase 450 (owner 2026-10-22): lunch is 1 PM. At 12:55 IST (not Sunday / holiday) everyone whose Work timer is running gets a push:
-- "Lunch at 1 PM - pause your timer before you go". Idempotent. UNDO: SELECT cron.unschedule('work-lunch-reminder'); DROP FUNCTION public.work_lunch_reminder();
CREATE OR REPLACE FUNCTION public.work_lunch_reminder() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_n int := 0; r record;
BEGIN
  IF public.is_off_day((now() AT TIME ZONE 'Asia/Kolkata')::date) THEN RETURN 0; END IF;
  FOR r IN SELECT DISTINCT user_id FROM public.work_time_entries WHERE ended_at IS NULL LOOP
    PERFORM public.work_push(r.user_id, 'Lunch at 1 PM', 'Going for lunch? Pause your timer before you leave.', '/my-work',
                             'work-lunch-' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYYMMDD'));
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;
REVOKE EXECUTE ON FUNCTION public.work_lunch_reminder() FROM PUBLIC, anon, authenticated;
DO $$ BEGIN PERFORM cron.unschedule('work-lunch-reminder'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
-- 12:55 IST = 07:25 UTC, Monday-Saturday (Saturday is a working day)
SELECT cron.schedule('work-lunch-reminder', '25 7 * * 1-6', $$ SELECT public.work_lunch_reminder(); $$);
