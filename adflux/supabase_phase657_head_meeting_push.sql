-- =============================================================================
-- Phase 657 · 9:45 AM push to the sales head: morning team meeting at 9:50
-- (2026-11-23, owner-approved)
--
-- Mon-Sat, skips active holidays (same rule as push_morning_checkin) and a head
-- on full-day approved leave. One push per head per day (tag carries the date).
-- Cron 'head-meeting-reminder' at 04:15 UTC = 9:45 IST. Safe to re-run.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.push_head_meeting_reminder()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_count int := 0;
  v_head  record;
BEGIN
  IF EXTRACT(DOW FROM v_today) = 0 THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM public.holidays WHERE holiday_date = v_today AND COALESCE(is_active, true)) THEN
    RETURN 0;
  END IF;
  FOR v_head IN
    SELECT u.id, u.name FROM public.users u
     WHERE u.team_role = 'sales_manager' AND u.is_active
       AND NOT EXISTS (SELECT 1 FROM public.leaves l
                        WHERE l.user_id = u.id AND l.leave_date = v_today
                          AND l.status = 'approved' AND NOT COALESCE(l.is_half_day, false))
  LOOP
    PERFORM public.enqueue_push(
      v_head.id,
      'Morning team meeting at 9:50',
      'Gather your team in 5 minutes. Tick it on your Today page after.',
      '/work',
      'head-meeting-' || to_char(v_today, 'YYYY-MM-DD'));
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.push_head_meeting_reminder() FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule('head-meeting-reminder') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'head-meeting-reminder');
SELECT cron.schedule('head-meeting-reminder', '15 4 * * 1-6', $c$ SELECT public.push_head_meeting_reminder(); $c$);

-- VERIFY:
-- SELECT jobname, schedule FROM cron.job WHERE jobname = 'head-meeting-reminder';   -- 15 4 * * 1-6
