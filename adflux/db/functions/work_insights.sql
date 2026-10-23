-- ============================================================================
-- db/functions/work_insights.sql - CANONICAL HOME (Phase 469, 2026-10-23)
-- Admin-only "Insights" numbers for Team Work (one round trip, section 66 server-side).
--  * kpis: tasks finished, hours tracked, avg days to finish (range vs the equal range before)
--  * ontime: this month vs last month through work_ontime_stats (the SAME definition as the staff pay rule, section 71)
--  * series: tasks finished per IST day, this range and the range before
--  * by_client: approved hours per client in the range
--  * workload: per person - open tasks (not postponed) due this week or earlier x that person's average hours per
--    finished task (last 60 days, team average / 1h fallback) against 8 h per remaining working day this week
-- Gate: ACTIVE users.role = 'admin' only (fail-closed on no login / NULL role) -> '{}' otherwise. Range clamped to 92 days.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.work_insights(p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_role text; v_act boolean;
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_len int; v_pfrom date; v_pto date;
  v_f timestamptz; v_t timestamptz; v_pf timestamptz; v_pt timestamptz;
  v_m0 date := date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))::date;
  v_m1 date := (date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata')) - interval '1 month')::date;
  v_wk_end date; v_days int; v_team_avg numeric;
  v_out jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN '{}'::jsonb; END IF;
  SELECT role, COALESCE(is_active, false) INTO v_role, v_act FROM public.users WHERE id = auth.uid();
  IF v_role IS NULL OR v_role <> 'admin' OR NOT v_act THEN RETURN '{}'::jsonb; END IF;
  IF p_to - p_from > 91 THEN p_from := p_to - 91; END IF;
  v_len := (p_to - p_from) + 1; v_pto := p_from - 1; v_pfrom := v_pto - (v_len - 1);
  v_f  := (p_from::timestamp AT TIME ZONE 'Asia/Kolkata'); v_t  := ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Kolkata');
  v_pf := (v_pfrom::timestamp AT TIME ZONE 'Asia/Kolkata'); v_pt := ((v_pto + 1)::timestamp AT TIME ZONE 'Asia/Kolkata');
  v_wk_end := v_today + (7 - extract(isodow FROM v_today)::int);
  SELECT GREATEST(1, count(*)) INTO v_days FROM generate_series(v_today, v_wk_end, interval '1 day') g WHERE extract(isodow FROM g) <> 7;
  SELECT COALESCE(avg(seconds) / 3600.0, 1) INTO v_team_avg FROM public.work_task_parts
   WHERE status = 'finished' AND seconds >= 60 AND finished_at >= now() - interval '60 days';   -- Phase 488: ignore finished-without-timer (0 s) tasks
  v_team_avg := GREATEST(0.25, v_team_avg);

  WITH mem AS (
    SELECT m.user_id FROM public.work_members m JOIN public.users u ON u.id = m.user_id
     WHERE u.is_active AND u.role NOT IN ('admin', 'co_owner', 'agency')
  ),
  fin AS (
    SELECT p.assignee_id, p.created_at, p.finished_at, (p.finished_at AT TIME ZONE 'Asia/Kolkata')::date AS d, COALESCE(t.is_auto, false) AS auto
      FROM public.work_task_parts p JOIN public.work_tasks t ON t.id = p.task_id
     WHERE p.status = 'finished' AND p.finished_at >= v_pf AND p.finished_at < v_t
  ),
  te AS (
    SELECT e.project_id, e.started_at,
           GREATEST(0, extract(epoch FROM (COALESCE(e.ended_at, now()) - e.started_at)) - e.break_seconds) AS secs
      FROM public.work_time_entries e WHERE e.status = 'approved' AND e.started_at >= v_pf AND e.started_at < v_t
  ),
  ot AS (
    SELECT sum(c.counted) cc0, sum(c.on_time) co0, sum(d.counted) pc0, sum(d.on_time) po0
      FROM mem m
      CROSS JOIN LATERAL public.work_ontime_stats(m.user_id, v_m0) c
      CROSS JOIN LATERAL public.work_ontime_stats(m.user_id, v_m1) d
  ),
  avgh AS (
    SELECT p.assignee_id, avg(p.seconds) / 3600.0 AS h FROM public.work_task_parts p
     WHERE p.status = 'finished' AND p.seconds >= 60 AND p.finished_at >= now() - interval '60 days' GROUP BY p.assignee_id
  ),
  op AS (
    SELECT p.assignee_id, count(*) n FROM public.work_task_parts p
     WHERE p.status IN ('assigned', 'in_process') AND (p.due_date IS NULL OR p.due_date <= v_wk_end) GROUP BY p.assignee_id
  )
  SELECT jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to, 'days', v_len),
    'kpis', jsonb_build_object(
      'finished', (SELECT count(*) FROM fin WHERE finished_at >= v_f),
      'finished_prev', (SELECT count(*) FROM fin WHERE finished_at < v_f),
      -- Phase 488: the headline counts tasks made BY HAND; system-made (repeating / HR / finance / quote) are shown separately
      'finished_hand', (SELECT count(*) FROM fin WHERE finished_at >= v_f AND NOT auto),
      'finished_hand_prev', (SELECT count(*) FROM fin WHERE finished_at < v_f AND NOT auto),
      'finished_auto', (SELECT count(*) FROM fin WHERE finished_at >= v_f AND auto),
      'seconds', (SELECT COALESCE(sum(secs), 0)::bigint FROM te WHERE started_at >= v_f),
      'seconds_prev', (SELECT COALESCE(sum(secs), 0)::bigint FROM te WHERE started_at < v_f),
      'avg_days', (SELECT round(avg(extract(epoch FROM (finished_at - created_at)) / 86400.0)::numeric, 1) FROM fin WHERE finished_at >= v_f AND NOT auto),
      'avg_days_prev', (SELECT round(avg(extract(epoch FROM (finished_at - created_at)) / 86400.0)::numeric, 1) FROM fin WHERE finished_at < v_f AND NOT auto)),
    'ontime', (SELECT jsonb_build_object('counted', COALESCE(cc0, 0), 'on_time', COALESCE(co0, 0), 'counted_prev', COALESCE(pc0, 0), 'on_time_prev', COALESCE(po0, 0)) FROM ot),
    'series', jsonb_build_object(
      'this', COALESCE((SELECT jsonb_agg(jsonb_build_object('d', g::date, 'n', (SELECT count(*) FROM fin f WHERE f.d = g::date AND NOT f.auto), 'n_all', (SELECT count(*) FROM fin f WHERE f.d = g::date)) ORDER BY g)
                          FROM generate_series(p_from, p_to, interval '1 day') g), '[]'::jsonb),
      'prev', COALESCE((SELECT jsonb_agg(jsonb_build_object('d', g::date, 'n', (SELECT count(*) FROM fin f WHERE f.d = g::date AND NOT f.auto), 'n_all', (SELECT count(*) FROM fin f WHERE f.d = g::date)) ORDER BY g)
                          FROM generate_series(v_pfrom, v_pto, interval '1 day') g), '[]'::jsonb)),
    'by_client', COALESCE((SELECT jsonb_agg(jsonb_build_object('project_id', x.project_id, 'seconds', x.s) ORDER BY x.s DESC)
                             FROM (SELECT project_id, sum(secs)::bigint s FROM te WHERE started_at >= v_f GROUP BY project_id) x), '[]'::jsonb),
    'workload', COALESCE((SELECT jsonb_agg(jsonb_build_object('user_id', m.user_id, 'open', COALESCE(op.n, 0),
                  'avg_hours', round(COALESCE(avgh.h, v_team_avg)::numeric, 2),
                  'est_hours', round((COALESCE(op.n, 0) * GREATEST(0.25, COALESCE(avgh.h, v_team_avg)))::numeric, 1),
                  'capacity_hours', v_days * 8) ORDER BY COALESCE(op.n, 0) * COALESCE(avgh.h, v_team_avg) DESC)
                  FROM mem m LEFT JOIN op ON op.assignee_id = m.user_id LEFT JOIN avgh ON avgh.assignee_id = m.user_id), '[]'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.work_insights(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.work_insights(date, date) TO authenticated;
NOTIFY pgrst, 'reload schema';
-- VERIFY: SELECT has_function_privilege('anon','public.work_insights(date,date)','execute') anon_exec, has_function_privilege('authenticated','public.work_insights(date,date)','execute') auth_exec;
