-- supabase_phase483_work_report_stats.sql
-- Phase 483 (owner 23 Oct 2026): show "evening reports shared N of M days" next to the on-time score. DISPLAY ONLY - no pay effect.
-- Day counted = an IST date this month with an approved work time entry, not a Sunday / holiday / approved-leave day.
-- Today counts only once shared or after 19:00 IST. Shared = work_sessions.evening_summary_sent_at OR a work_report_shares row.
CREATE OR REPLACE FUNCTION public.work_report_stats(p_user_id uuid, p_month_start date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_hour  int  := extract(hour FROM now() AT TIME ZONE 'Asia/Kolkata');
  v_days int; v_shared int;
BEGIN
  IF auth.uid() IS NULL OR NOT (p_user_id = auth.uid() OR public.work_is_head()
       OR COALESCE(public.get_my_role() IN ('admin','co_owner','hr'), false)) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  WITH dd AS (
    SELECT DISTINCT (e.started_at AT TIME ZONE 'Asia/Kolkata')::date AS d
      FROM public.work_time_entries e
     WHERE e.user_id = p_user_id AND e.status = 'approved'
       AND (e.started_at AT TIME ZONE 'Asia/Kolkata')::date >= date_trunc('month', p_month_start)::date
       AND (e.started_at AT TIME ZONE 'Asia/Kolkata')::date <  (date_trunc('month', p_month_start) + interval '1 month')::date
  ), ok AS (
    SELECT d, (EXISTS (SELECT 1 FROM public.work_sessions s WHERE s.user_id = p_user_id AND s.work_date = d AND s.evening_summary_sent_at IS NOT NULL)
            OR EXISTS (SELECT 1 FROM public.work_report_shares r WHERE r.user_id = p_user_id AND r.work_date = d)) AS shared
      FROM dd
     WHERE extract(dow FROM d) <> 0
       AND NOT EXISTS (SELECT 1 FROM public.holidays h WHERE h.holiday_date = d)
       AND NOT EXISTS (SELECT 1 FROM public.leaves l WHERE l.user_id = p_user_id AND l.leave_date = d AND l.status = 'approved' AND COALESCE(l.is_half_day, false) = false)
  )
  SELECT count(*) FILTER (WHERE d < v_today OR shared OR v_hour >= 19), count(*) FILTER (WHERE shared)
    INTO v_days, v_shared FROM ok;
  RETURN jsonb_build_object('days', COALESCE(v_days,0), 'shared', COALESCE(v_shared,0));
END $$;
REVOKE ALL ON FUNCTION public.work_report_stats(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.work_report_stats(uuid, date) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
-- VERIFY: RANA DIKSHITA 2026-10-01 -> {"days":4,"shared":2}
