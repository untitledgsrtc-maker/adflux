-- supabase_phase692_office_score_weights.sql (25-11-2026)
-- Owner 25-11-2026: no team head yet, so few tasks are given -> weights tasks 20, hours 50, in by 10:15 30
-- (was 40 / 35 / 25). Re-creates work_office_score from db/functions/work_office_score.sql and renames the
-- AI-tip fact labels. Pays from 1 Dec 2026 (monthly_score unchanged). Idempotent.

CREATE OR REPLACE FUNCTION public.work_office_score(p_user_id uuid, p_from date, p_to date)
 RETURNS TABLE(score numeric, task_pts numeric, hours_pts numeric, punct_pts numeric,
               work_days numeric, given integer, given_on_time integer, hours numeric, on_time_days integer, full_days integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH d AS (
    SELECT g::date AS day,
           CASE WHEN EXISTS (SELECT 1 FROM public.leaves l
                              WHERE l.user_id = p_user_id AND l.leave_date = g::date
                                AND l.status = 'approved' AND COALESCE(l.is_half_day, false))
                THEN 0.5 ELSE 1 END AS w
      FROM generate_series(p_from, p_to, interval '1 day') g
     WHERE NOT public.is_off_day(g::date)
       AND NOT EXISTS (SELECT 1 FROM public.leaves l
                        WHERE l.user_id = p_user_id AND l.leave_date = g::date
                          AND l.status = 'approved' AND NOT COALESCE(l.is_half_day, false))
       AND g::date >= COALESCE((SELECT s.join_date FROM public.staff_incentive_profiles s
                                 WHERE s.user_id = p_user_id), p_from)
  ),
  wd AS (SELECT COALESCE(SUM(w), 0)::numeric AS wd, COUNT(*) FILTER (WHERE w = 1)::int AS full_days FROM d),
  tk AS (
    SELECT COUNT(*)::int AS n,
           COUNT(*) FILTER (
             WHERE x.status = 'finished' AND COALESCE(x.reject_kind, '') <> 'sent_back'
               AND ((x.finished_at AT TIME ZONE 'Asia/Kolkata')::date < x.due_date
                    OR ((x.finished_at AT TIME ZONE 'Asia/Kolkata')::date = x.due_date
                        AND (x.due_time IS NULL OR (x.finished_at AT TIME ZONE 'Asia/Kolkata')::time <= x.due_time))))::int AS ok
      FROM public.work_task_parts x
      JOIN public.work_tasks t ON t.id = x.task_id
     WHERE x.assignee_id = p_user_id
       AND t.created_by IS DISTINCT FROM p_user_id
       AND x.due_date IN (SELECT day FROM d)
       AND x.status <> 'postponed'
       AND COALESCE(x.reject_kind, '') <> 'declined'
  ),
  hr AS (
    SELECT COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(e.ended_at, now()) - e.started_at))
                                    - COALESCE(e.break_seconds, 0))), 0) / 3600.0 AS h
      FROM public.work_time_entries e
     WHERE e.user_id = p_user_id AND e.status = 'approved'
       AND (e.started_at AT TIME ZONE 'Asia/Kolkata')::date IN (SELECT day FROM d)
  ),
  pu AS (
    SELECT COUNT(*)::int AS n
      FROM d
     WHERE d.w = 1
       AND (SELECT MIN((e.started_at AT TIME ZONE 'Asia/Kolkata')::time)
              FROM public.work_time_entries e
             WHERE e.user_id = p_user_id AND e.source = 'timer' AND e.status <> 'declined'
               AND (e.started_at AT TIME ZONE 'Asia/Kolkata')::date = d.day) <= TIME '10:15'
  ),
  pts AS (
    SELECT wd.wd, wd.full_days, tk.n, tk.ok, hr.h, pu.n AS pn,
           CASE WHEN wd.wd = 0 OR tk.n = 0 THEN 0
                ELSE 20 * (tk.ok::numeric / tk.n) * LEAST(1, tk.n / wd.wd) END AS t_pts,
           CASE WHEN wd.wd = 0 THEN 0 ELSE 50 * LEAST(1, hr.h / (8 * wd.wd)) END AS h_pts,
           CASE WHEN wd.full_days = 0 THEN 30 ELSE 30 * pu.n::numeric / wd.full_days END AS p_pts
      FROM wd, tk, hr, pu
  )
  SELECT CASE WHEN wd = 0 THEN NULL ELSE ROUND(t_pts + h_pts + p_pts, 1) END,
         ROUND(t_pts, 1), ROUND(h_pts, 1), ROUND(p_pts, 1),
         wd, n, ok, ROUND(h, 1), pn, full_days
    FROM pts;
$function$;

REVOKE ALL ON FUNCTION public.work_office_score(uuid, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.work_office_score(uuid, date, date) TO service_role;

DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef('public.coach_tip_facts(uuid)'::regprocedure) INTO v_def;
  v_def := replace(replace(replace(v_def,
             'tasks_given_on_time_points_out_of_40', 'tasks_given_on_time_points_out_of_20'),
             'hours_points_out_of_35', 'hours_points_out_of_50'),
             'in_by_10_15_points_out_of_25', 'in_by_10_15_points_out_of_30');
  EXECUTE v_def;
END $$;

NOTIFY pgrst, 'reload schema';

-- VERIFY: expect weights_new = true, tips_labels_new = true
SELECT position('50 * LEAST(1, hr.h' IN pg_get_functiondef('public.work_office_score(uuid,date,date)'::regprocedure)) > 0 AS weights_new,
       position('hours_points_out_of_50' IN pg_get_functiondef('public.coach_tip_facts(uuid)'::regprocedure)) > 0 AS tips_labels_new;
