-- Phase 371 - evening report reminder (7:30 PM to people, 8:00 PM list to the owner).
-- "Shared" = work_sessions.evening_summary_sent_at today OR a work_report_shares row today.
-- Who: active users except admin / co_owner / agency, on a workday, not on approved leave, and who worked
-- today (checked in OR started a Work timer). Push only; WhatsApp reminder is sent by api/wa/team-nudge.js.
-- Idempotent. Both functions REVOKEd from client roles. Kill: SELECT cron.unschedule('evening-report-remind'); ('evening-report-owner');

CREATE OR REPLACE FUNCTION public._evening_unshared_users(p_date date)
RETURNS TABLE (user_id uuid, name text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.name, u.role
    FROM users u
   WHERE u.is_active
     AND COALESCE(u.role, '') NOT IN ('admin', 'co_owner', 'agency')
     AND NOT EXISTS (SELECT 1 FROM leaves l WHERE l.user_id = u.id AND l.leave_date = p_date AND l.status = 'approved')
     AND NOT EXISTS (SELECT 1 FROM work_sessions s WHERE s.user_id = u.id AND s.work_date = p_date AND s.evening_summary_sent_at IS NOT NULL)
     AND NOT EXISTS (SELECT 1 FROM work_report_shares r WHERE r.user_id = u.id AND r.work_date = p_date)
     AND (
       EXISTS (SELECT 1 FROM work_sessions s2 WHERE s2.user_id = u.id AND s2.work_date = p_date AND s2.check_in_at IS NOT NULL)
       OR EXISTS (SELECT 1 FROM work_time_entries t WHERE t.user_id = u.id AND (t.started_at AT TIME ZONE 'Asia/Kolkata')::date = p_date)
     );
$$;
REVOKE ALL ON FUNCTION public._evening_unshared_users(date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.evening_report_remind(p_stage text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  r record; v_n integer := 0; v_list text; v_cnt integer; v_admin record;
BEGIN
  BEGIN
    IF NOT public.is_push_allowed_now() THEN RETURN 0; END IF;
    IF public.is_off_day(v_today) THEN RETURN 0; END IF;

    IF p_stage = 'rep' THEN
      FOR r IN SELECT * FROM public._evening_unshared_users(v_today) LOOP
        IF NOT EXISTS (SELECT 1 FROM push_log WHERE user_id = r.user_id AND tag = 'evening-report-' || v_today) THEN
          PERFORM public.enqueue_push(r.user_id, 'Evening report',
            'Your evening report is not shared yet. Tap Share to send it.',
            CASE r.role WHEN 'operation_executive' THEN '/ops-home' WHEN 'operation_head' THEN '/ops-command'
                        WHEN 'telecaller' THEN '/telecaller' WHEN 'staff' THEN '/my-work' ELSE '/work' END,
            'evening-report-' || v_today);
          v_n := v_n + 1;
        END IF;
      END LOOP;
    ELSIF p_stage = 'owner' THEN
      SELECT count(*), string_agg(split_part(name, ' ', 1), ', ' ORDER BY name)
        INTO v_cnt, v_list FROM public._evening_unshared_users(v_today);
      IF v_cnt > 0 THEN
        FOR v_admin IN SELECT id FROM users WHERE is_active AND role = 'admin' LOOP
          IF NOT EXISTS (SELECT 1 FROM push_log WHERE user_id = v_admin.id AND tag = 'evening-report-owner-' || v_today) THEN
            PERFORM public.enqueue_push(v_admin.id, v_cnt || ' evening reports not shared', left(v_list, 180), '/dashboard',
                                        'evening-report-owner-' || v_today);
            v_n := v_n + 1;
          END IF;
        END LOOP;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'evening_report_remind failed: %', SQLERRM;
  END;
  RETURN v_n;
END; $$;
REVOKE ALL ON FUNCTION public.evening_report_remind(text) FROM PUBLIC, anon, authenticated;

-- WhatsApp reminder dispatch (secret pulled from the live team_assistant_nudge_dispatch, none handled here).
DO $do$
DECLARE v_def text; v_secret text;
BEGIN
  v_def := pg_get_functiondef('public.team_assistant_nudge_dispatch'::regproc);
  v_secret := substring(v_def from $re$x-ta-secret'[^']*'([^']+)'$re$);
  IF v_secret IS NULL OR v_secret = '' OR v_secret LIKE '<%' THEN
    RAISE EXCEPTION 'could not read TEAM_ASSISTANT_SECRET from team_assistant_nudge_dispatch';
  END IF;
  EXECUTE format($fn$
    CREATE OR REPLACE FUNCTION public.evening_report_wa_dispatch()
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = public, extensions, pg_temp AS $body$
    BEGIN
      PERFORM net.http_post(
        url     := 'https://app.untitledad.in/api/wa/team-nudge',
        headers := jsonb_build_object('Content-Type','application/json','x-ta-secret', %L),
        body    := '{"mode":"evening"}'::jsonb,
        timeout_milliseconds := 8000);
    EXCEPTION WHEN OTHERS THEN NULL;
    END; $body$;
  $fn$, v_secret);
  EXECUTE 'REVOKE ALL ON FUNCTION public.evening_report_wa_dispatch() FROM PUBLIC, anon, authenticated';
END $do$;

-- crons (UTC): 19:30 IST = 14:00, 20:00 IST = 14:30, Monday-Saturday
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'evening-report-remind') THEN PERFORM cron.unschedule('evening-report-remind'); END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'evening-report-owner')  THEN PERFORM cron.unschedule('evening-report-owner');  END IF;
END $$;
SELECT cron.schedule('evening-report-remind', '0 14 * * 1-6',  $$SELECT public.evening_report_remind('rep'); SELECT public.evening_report_wa_dispatch();$$);
SELECT cron.schedule('evening-report-owner',  '30 14 * * 1-6', $$SELECT public.evening_report_remind('owner');$$);
NOTIFY pgrst, 'reload schema';

-- VERIFY (expect 2 rows; the read below must not error):
-- SELECT jobname, schedule FROM cron.job WHERE jobname LIKE 'evening-report-%';
-- SELECT count(*) FROM public._evening_unshared_users((now() AT TIME ZONE 'Asia/Kolkata')::date);
