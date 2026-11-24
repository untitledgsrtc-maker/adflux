-- supabase_phase688_coach_history.sql (24-11-2026)
-- Owner 24-11-2026: Team Evening (/coach) gets a date filter, a person filter and a chart of
-- each person's movement: day score % and actions-done % per day.
--
-- coach_history(p_from, p_to): read-only, one row per person per day.
--   score   - sales / telecaller / ops: daily_performance.score_pct for that day (same number the
--             cards show). Office team: on-time % of the tasks DUE that day, same rules as
--             work_ontime_stats (finished before the due day, or on the due day by the due time;
--             postponed / declined left out; approved full-day leave left out). Today not counted.
--   done / checked - coach next-day actions for that day: done and checked counts.
-- Who sees whom: exactly like coach_team_view (admin + HR: everyone on Team Evening; a sales
-- head: his own sales / telecaller reps). Range capped at 62 days. Function only, no table change.

CREATE OR REPLACE FUNCTION public.coach_history(p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin boolean := COALESCE(public.get_my_role() IN ('admin', 'hr'), false);
  v_mgr   boolean := COALESCE(public.is_sales_manager(), false);
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  IF auth.uid() IS NULL OR NOT (v_admin OR v_mgr) THEN
    RAISE EXCEPTION 'admin, HR or sales head only' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 62 THEN
    RAISE EXCEPTION 'pick a range of up to 62 days';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('user_id', u.id, 'day', d.day, 'score', s.score, 'done', a.done, 'checked', a.checked)
                     ORDER BY u.id, d.day)
      FROM public.users u
      CROSS JOIN LATERAL (SELECT g::date AS day FROM generate_series(p_from, p_to, interval '1 day') g) d
      CROSS JOIN LATERAL (
        SELECT CASE
          WHEN u.role IN ('sales', 'telecaller', 'operation_executive', 'operation_head') THEN
            (SELECT round(dp.score_pct) FROM public.daily_performance dp WHERE dp.user_id = u.id AND dp.work_date = d.day)
          WHEN d.day >= v_today THEN NULL
          ELSE (
            SELECT round(100.0 * COUNT(*) FILTER (
                     WHERE x.status = 'finished' AND COALESCE(x.reject_kind, '') <> 'sent_back'
                       AND ((x.finished_at AT TIME ZONE 'Asia/Kolkata')::date < x.due_date
                            OR ((x.finished_at AT TIME ZONE 'Asia/Kolkata')::date = x.due_date
                                AND (x.due_time IS NULL OR (x.finished_at AT TIME ZONE 'Asia/Kolkata')::time <= x.due_time))))
                   / NULLIF(COUNT(*), 0))
              FROM public.work_task_parts x
             WHERE x.assignee_id = u.id AND x.due_date = d.day
               AND x.status <> 'postponed' AND COALESCE(x.reject_kind, '') <> 'declined'
               AND NOT EXISTS (SELECT 1 FROM public.leaves l
                                WHERE l.user_id = u.id AND l.leave_date = d.day
                                  AND l.status = 'approved' AND COALESCE(l.is_half_day, false) = false))
        END AS score
      ) s
      CROSS JOIN LATERAL (
        SELECT COUNT(*) FILTER (WHERE c.done)::int AS done,
               COUNT(*) FILTER (WHERE c.checked_at IS NOT NULL)::int AS checked
          FROM public.coach_actions c WHERE c.user_id = u.id AND c.for_date = d.day
      ) a
     WHERE u.is_active
       AND ((v_admin AND u.role IN ('sales','telecaller','staff','hr','accounts','office_admin','operation_executive','operation_head'))
            OR (NOT v_admin AND u.role IN ('sales','telecaller') AND u.manager_id = auth.uid()))
  ), '[]'::jsonb);
END $$;

REVOKE EXECUTE ON FUNCTION public.coach_history(date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.coach_history(date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY: expect fn = 1, anon_can_run = false
SELECT (SELECT count(*) FROM pg_proc WHERE proname = 'coach_history') AS fn,
       has_function_privilege('anon', 'public.coach_history(date, date)', 'EXECUTE') AS anon_can_run;
