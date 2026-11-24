-- supabase_phase691_office_start_reminder_tips.sql (25-11-2026)
-- Owner 25-11-2026:
--  1. Office time 10:00 + 15 min grace: work_office_score punctuality = first live clock-in by 10:15
--     (re-runs the canonical db/functions/work_office_score.sql body below).
--  2. 09:40 IST reminder (Mon-Sat, not holidays) to office people (staff / hr / accounts / office_admin)
--     who have not started a timer today and are not on approved full-day leave.
--  3. AI tips (coach_tip_facts): office people get the new work score facts instead of the old
--     on-time %, so the tip matches the score on the screen.
-- Idempotent. UNDO reminder: SELECT cron.unschedule('work-office-start'); DROP FUNCTION public.work_office_start_reminder();

-- 1. punctuality cutoff 10:15 (guarded patch of the live function)
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef('public.work_office_score(uuid,date,date)'::regprocedure) INTO v_def;
  IF position('''10:15:00''' IN v_def) > 0 OR position('''10:15''' IN v_def) > 0 THEN RETURN; END IF;
  IF position('''09:45:00''::time' IN v_def) = 0 AND position('''09:45''' IN v_def) = 0 THEN
    RAISE EXCEPTION 'work_office_score: 09:45 cutoff not found - not patched';
  END IF;
  v_def := replace(replace(v_def, '''09:45:00''::time', '''10:15:00''::time'), 'TIME ''09:45''', 'TIME ''10:15''');
  EXECUTE v_def;
END $$;

-- 2. 09:40 start reminder
CREATE OR REPLACE FUNCTION public.work_office_start_reminder()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_n int := 0; v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date; r record;
BEGIN
  IF public.is_off_day(v_today) THEN RETURN 0; END IF;
  FOR r IN
    SELECT u.id FROM public.users u
     WHERE u.is_active AND u.role IN ('staff', 'hr', 'accounts', 'office_admin')
       AND NOT EXISTS (SELECT 1 FROM public.leaves l WHERE l.user_id = u.id AND l.leave_date = v_today
                         AND l.status = 'approved' AND NOT COALESCE(l.is_half_day, false))
       AND NOT EXISTS (SELECT 1 FROM public.work_time_entries e WHERE e.user_id = u.id AND e.source = 'timer'
                         AND (e.started_at AT TIME ZONE 'Asia/Kolkata')::date = v_today)
  LOOP
    PERFORM public.work_push(r.id, 'Office starts at 10:00',
      'Start your first task timer by 10:15. It counts for your work score.', '/my-work',
      'work-start-' || to_char(v_today, 'YYYYMMDD'));
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $function$;

REVOKE ALL ON FUNCTION public.work_office_start_reminder() FROM PUBLIC, anon, authenticated;

DO $$ BEGIN PERFORM cron.unschedule('work-office-start'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
-- 04:10 UTC = 09:40 IST
SELECT cron.schedule('work-office-start', '10 4 * * 1-6', $$ SELECT public.work_office_start_reminder(); $$);

-- 3. AI tip facts for the office team = the new work score (guarded patch of the live function)
DO $$
DECLARE v_def text; v_old text; v_new text;
BEGIN
  SELECT pg_get_functiondef('public.coach_tip_facts(uuid)'::regprocedure) INTO v_def;
  IF position('work_score_month' IN v_def) > 0 THEN RETURN; END IF;
  v_old := $o$      'ontime_pct_month',     (SELECT round(100.0 * s.on_time / NULLIF(s.counted, 0)) FROM public.work_ontime_stats(p_user, date_trunc('month', v_today)::date) s),$o$;
  v_new := $n$      'work_score_month',     (SELECT jsonb_build_object(
                                   'score_out_of_100', s.score,
                                   'tasks_given_on_time_points_out_of_40', s.task_pts,
                                   'hours_points_out_of_35', s.hours_pts,
                                   'in_by_10_15_points_out_of_25', s.punct_pts,
                                   'tasks_given_by_others', s.given,
                                   'tasks_given_done_on_time', s.given_on_time,
                                   'hours_on_tasks', s.hours,
                                   'target_hours', s.work_days * 8,
                                   'days_in_by_10_15', s.on_time_days,
                                   'working_days', s.full_days)
                                 FROM public.work_office_score(p_user, date_trunc('month', v_today)::date, v_today - 1) s
                                WHERE v_today - 1 >= date_trunc('month', v_today)::date),$n$;
  IF position(v_old IN v_def) = 0 THEN RAISE EXCEPTION 'coach_tip_facts: ontime_pct_month line not found - not patched'; END IF;
  EXECUTE replace(v_def, v_old, v_new);
END $$;

NOTIFY pgrst, 'reload schema';

-- VERIFY: expect cutoff_1015 = true, reminder_job = 1, tips_new = true, tips_old_gone = true
SELECT position('10:15' IN pg_get_functiondef('public.work_office_score(uuid,date,date)'::regprocedure)) > 0 AS cutoff_1015,
       (SELECT count(*) FROM cron.job WHERE jobname = 'work-office-start')                                    AS reminder_job,
       position('work_score_month' IN pg_get_functiondef('public.coach_tip_facts(uuid)'::regprocedure)) > 0 AS tips_new,
       position('ontime_pct_month' IN pg_get_functiondef('public.coach_tip_facts(uuid)'::regprocedure)) = 0 AS tips_old_gone;
