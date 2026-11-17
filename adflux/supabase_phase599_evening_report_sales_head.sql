-- Phase 599 — Sales head gets his team's "evening reports not shared" alert (2026-11-17)
-- Owner: "make sure evening report of sales head should be there".
-- Supersedes the evening_report_remind body in supabase_phase371_evening_report_reminder.sql
-- (live body copied byte-for-byte, ONE addition: the sales-head loop in the 'owner' stage).
--   * 'rep' stage   (19:30 IST): unchanged — every rep incl. the sales head gets his own nudge.
--   * 'owner' stage (20:00 IST): admin push unchanged; NEW — each active sales head
--     (team_role sales_manager, not admin/co_owner) gets a push listing HIS reps
--     (users.manager_id = him) who have not shared. Opens /manager (My Team).
-- Revert: re-run supabase_phase371_evening_report_reminder.sql.

CREATE OR REPLACE FUNCTION public.evening_report_remind(p_stage text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  r record; v_n integer := 0; v_list text; v_cnt integer; v_admin record; v_mgr record;
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
      -- Phase 599: each sales head gets his own team's list.
      FOR v_mgr IN SELECT id FROM users WHERE is_active AND team_role = 'sales_manager'
                     AND COALESCE(role, '') NOT IN ('admin', 'co_owner') LOOP
        SELECT count(*), string_agg(split_part(e.name, ' ', 1), ', ' ORDER BY e.name)
          INTO v_cnt, v_list
          FROM public._evening_unshared_users(v_today) e
          JOIN users u ON u.id = e.user_id
         WHERE u.manager_id = v_mgr.id;
        IF v_cnt > 0 AND NOT EXISTS (SELECT 1 FROM push_log WHERE user_id = v_mgr.id AND tag = 'evening-report-team-' || v_today) THEN
          PERFORM public.enqueue_push(v_mgr.id, v_cnt || ' of your team have not shared the evening report', left(v_list, 180), '/manager',
                                      'evening-report-team-' || v_today);
          v_n := v_n + 1;
        END IF;
      END LOOP;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'evening_report_remind failed: %', SQLERRM;
  END;
  RETURN v_n;
END; $function$;

-- cron-only, same as phase371 (no client may trigger team pushes)
REVOKE ALL ON FUNCTION public.evening_report_remind(text) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY:
-- SELECT pg_get_functiondef('public.evening_report_remind'::regproc) LIKE '%evening-report-team-%' AS sales_head_alert,
--        pg_get_functiondef('public.evening_report_remind'::regproc) LIKE '%evening-report-owner-%' AS admin_alert_kept;  -- both true
