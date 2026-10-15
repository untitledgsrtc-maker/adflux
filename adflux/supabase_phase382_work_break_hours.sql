-- supabase_phase382_work_break_hours.sql
-- Phase 382 - Windows agent STEP 2a: "It was a break" idle minutes come OFF the hours.
-- work_time_entries.break_seconds (phase 381) is subtracted in: head hours report, cost report, and the
-- seconds / cost frozen on a part when it is finished. Same functions as phase 365, one expression changed each.
-- break_seconds is 0 for every existing row, so today's numbers do not move. Idempotent.

CREATE OR REPLACE FUNCTION public.work_finish_part(p_part uuid, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_part public.work_task_parts%ROWTYPE; v_task public.work_tasks%ROWTYPE;
        v_secs int; v_cost numeric; v_name text; v_done boolean;
BEGIN
  IF v_uid IS NULL OR NOT public.work_is_active_user() THEN RAISE EXCEPTION 'login required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_part FROM public.work_task_parts WHERE id = p_part FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'task not found'; END IF;
  IF v_part.assignee_id <> v_uid AND NOT public.work_is_head() THEN RAISE EXCEPTION 'not your task' USING ERRCODE='42501'; END IF;
  IF v_part.status = 'finished' THEN RETURN; END IF;
  -- stop the assignee's running timer if it is on this part
  IF EXISTS (SELECT 1 FROM public.work_time_entries WHERE user_id = v_part.assignee_id AND ended_at IS NULL AND part_id = p_part) THEN
    PERFORM public.work__stop_running(v_part.assignee_id, false);
  END IF;
  SELECT COALESCE(sum(GREATEST(0, extract(epoch FROM (ended_at - started_at)) - break_seconds)), 0)::int INTO v_secs
    FROM public.work_time_entries WHERE part_id = p_part AND ended_at IS NOT NULL AND status = 'approved';
  v_cost := round(v_secs / 3600.0 * public.work_user_rate(v_part.assignee_id), 2);
  UPDATE public.work_task_parts
     SET status = 'finished', finished_at = now(), finish_note = NULLIF(btrim(p_note), ''),
         seconds = v_secs, cost_amount = v_cost, started_at = COALESCE(started_at, now())
   WHERE id = p_part;
  PERFORM public.work_refresh_task(v_part.task_id);
  SELECT * INTO v_task FROM public.work_tasks WHERE id = v_part.task_id;
  PERFORM public.work_log(v_part.task_id, p_part, 'finished', jsonb_build_object('seconds', v_secs, 'by_head', v_uid <> v_part.assignee_id));
  v_done := (v_task.status = 'finished');
  IF v_task.created_by IS NOT NULL AND v_task.created_by <> v_uid THEN
    SELECT name INTO v_name FROM public.users WHERE id = v_part.assignee_id;
    PERFORM public.work_push(v_task.created_by,
      CASE WHEN v_done THEN 'Task finished' ELSE 'Part finished' END,
      COALESCE(v_name,'Someone') || ' finished: ' || left(v_task.title, 80), '/my-work?tab=asked', 'work-done-' || v_task.id::text);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.work_hours_report(p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_from timestamptz; v_to timestamptz; v_out jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.work_is_head() THEN RETURN '{}'::jsonb; END IF;
  IF p_to - p_from > 92 THEN p_to := p_from + 92; END IF;
  v_from := (p_from::timestamp AT TIME ZONE 'Asia/Kolkata');
  v_to   := ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Kolkata');
  WITH e AS (
    SELECT user_id, project_id, task_id, started_at,
           GREATEST(0, extract(epoch FROM (COALESCE(ended_at, now()) - started_at)) - break_seconds)::bigint AS secs,
           (started_at AT TIME ZONE 'Asia/Kolkata')::date AS d, ended_at
      FROM public.work_time_entries
     WHERE status = 'approved' AND started_at >= v_from AND started_at < v_to
  )
  SELECT jsonb_build_object(
    'by_person', COALESCE((SELECT jsonb_agg(jsonb_build_object('user_id', x.user_id, 'seconds', x.s, 'days', x.dd,
                         'first_in', x.fi, 'last_out', x.lo)) FROM (
        SELECT user_id, sum(secs) s, count(DISTINCT d) dd, min(started_at) fi, max(ended_at) lo FROM e GROUP BY user_id) x), '[]'::jsonb),
    'by_project', COALESCE((SELECT jsonb_agg(jsonb_build_object('project_id', y.project_id, 'seconds', y.s, 'people', y.pp,
                         'last_day', y.ld)) FROM (
        SELECT project_id, sum(secs) s, count(DISTINCT user_id) pp, max(d) ld FROM e GROUP BY project_id) y), '[]'::jsonb),
    'by_day', COALESCE((SELECT jsonb_agg(jsonb_build_object('user_id', z.user_id, 'day', z.d, 'seconds', z.s)) FROM (
        SELECT user_id, d, sum(secs) s FROM e GROUP BY user_id, d) z), '[]'::jsonb),
    'pending', (SELECT count(*) FROM public.work_time_entries WHERE status = 'pending')
  ) INTO v_out;
  RETURN v_out;
END;
$$;

CREATE OR REPLACE FUNCTION public.work_cost_report(p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_from timestamptz; v_to timestamptz; v_out jsonb; v_role text := public.get_my_role();
BEGIN
  IF auth.uid() IS NULL OR v_role IS NULL OR v_role NOT IN ('admin','accounts') OR NOT public.work_is_active_user() THEN
    RETURN '{}'::jsonb;
  END IF;
  IF p_to - p_from > 92 THEN p_to := p_from + 92; END IF;
  v_from := (p_from::timestamp AT TIME ZONE 'Asia/Kolkata');
  v_to   := ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Kolkata');
  WITH rate AS (
    SELECT s.user_id, round(s.monthly_salary / 26.0 / 8.0, 2) AS r FROM public.staff_incentive_profiles s
  ), e AS (
    SELECT e.user_id, e.project_id, e.task_id,
           GREATEST(0, extract(epoch FROM (COALESCE(e.ended_at, now()) - e.started_at)) - e.break_seconds) AS secs,
           COALESCE(rt.r, 0) AS rate
      FROM public.work_time_entries e LEFT JOIN rate rt ON rt.user_id = e.user_id
     WHERE e.status = 'approved' AND e.started_at >= v_from AND e.started_at < v_to
  )
  SELECT jsonb_build_object(
    'total_cost', COALESCE((SELECT round(sum(secs / 3600.0 * rate), 2) FROM e), 0),
    'total_seconds', COALESCE((SELECT sum(secs)::bigint FROM e), 0),
    'unassigned_seconds', COALESCE((SELECT sum(secs)::bigint FROM e WHERE task_id IS NULL), 0),
    'by_task', COALESCE((SELECT jsonb_agg(jsonb_build_object('task_id', t.task_id, 'seconds', t.s, 'cost', t.c, 'people', t.p)) FROM (
        SELECT task_id, sum(secs)::bigint s, round(sum(secs / 3600.0 * rate), 2) c, count(DISTINCT user_id) p
          FROM e WHERE task_id IS NOT NULL GROUP BY task_id) t), '[]'::jsonb),
    'by_project', COALESCE((SELECT jsonb_agg(jsonb_build_object('project_id', t.project_id, 'seconds', t.s, 'cost', t.c)) FROM (
        SELECT project_id, sum(secs)::bigint s, round(sum(secs / 3600.0 * rate), 2) c FROM e GROUP BY project_id) t), '[]'::jsonb),
    'by_person', COALESCE((SELECT jsonb_agg(jsonb_build_object('user_id', t.user_id, 'seconds', t.s, 'cost', t.c)) FROM (
        SELECT user_id, sum(secs)::bigint s, round(sum(secs / 3600.0 * rate), 2) c FROM e GROUP BY user_id) t), '[]'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END;
$$;

NOTIFY pgrst, 'reload schema';

-- VERIFY (expect 3 / true): functions still present with the break subtraction
-- SELECT count(*) FILTER (WHERE pg_get_functiondef(p.oid) LIKE '%break_seconds%') AS with_break,
--        has_function_privilege('authenticated','public.work_hours_report(date,date)','EXECUTE') AS exec_ok
--   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--  WHERE n.nspname='public' AND p.proname IN ('work_finish_part','work_hours_report','work_cost_report');
