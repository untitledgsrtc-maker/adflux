-- ============================================================================
-- db/functions/work_office_score.sql - CANONICAL HOME (Phase 690, 2026-11-25)
-- ============================================================================
-- The OFFICE TEAM's score (owner decision 2026-11-25; pays from 1 Dec 2026 via monthly_score):
-- roles staff / hr / accounts / office_admin. Out of 100:
--   TASKS 40       on-time % of tasks GIVEN by someone else (task creator <> the person; system /
--                  repeating tasks count as given), scaled down when fewer than 1 given task per
--                  working day. Own tasks never count. On time = same rule as work_ontime_stats.
--   HOURS 35       approved timer hours / (8 h x working days), capped at 100%.
--   PUNCTUALITY 25 share of full working days with the first LIVE clock-in at or before 09:45 IST
--                  (hand-added entries do not count as a clock-in).
-- Working day = not Sunday / holiday (is_off_day), not an approved full-day leave, not before the
-- joining date. Half-day leave = half a day for tasks and hours, not judged for punctuality.
-- No working days in the range -> score NULL (caller decides).
-- work_office_score  = internal (REVOKEd), called by monthly_score + coach_history.
-- office_scores      = client wrapper: admin / co_owner / hr / accounts see every office person,
--                      anyone else sees only themselves. Range capped at 62 days.
-- ============================================================================

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
               AND (e.started_at AT TIME ZONE 'Asia/Kolkata')::date = d.day) <= TIME '09:45'
  ),
  pts AS (
    SELECT wd.wd, wd.full_days, tk.n, tk.ok, hr.h, pu.n AS pn,
           CASE WHEN wd.wd = 0 OR tk.n = 0 THEN 0
                ELSE 40 * (tk.ok::numeric / tk.n) * LEAST(1, tk.n / wd.wd) END AS t_pts,
           CASE WHEN wd.wd = 0 THEN 0 ELSE 35 * LEAST(1, hr.h / (8 * wd.wd)) END AS h_pts,
           CASE WHEN wd.full_days = 0 THEN 25 ELSE 25 * pu.n::numeric / wd.full_days END AS p_pts
      FROM wd, tk, hr, pu
  )
  SELECT CASE WHEN wd = 0 THEN NULL ELSE ROUND(t_pts + h_pts + p_pts, 1) END,
         ROUND(t_pts, 1), ROUND(h_pts, 1), ROUND(p_pts, 1),
         wd, n, ok, ROUND(h, 1), pn, full_days
    FROM pts;
$function$;

REVOKE ALL ON FUNCTION public.work_office_score(uuid, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.work_office_score(uuid, date, date) TO service_role;

CREATE OR REPLACE FUNCTION public.office_scores(p_from date, p_to date)
 RETURNS TABLE(user_id uuid, name text, score numeric, task_pts numeric, hours_pts numeric, punct_pts numeric,
               work_days numeric, given integer, given_on_time integer, hours numeric, on_time_days integer, full_days integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role text := public.get_my_role();
  v_all  boolean := COALESCE(v_role IN ('admin', 'co_owner', 'hr', 'accounts'), false);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sign in first' USING ERRCODE = '42501'; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 62 THEN
    RAISE EXCEPTION 'pick a range of up to 62 days';
  END IF;
  RETURN QUERY
  SELECT u.id, u.name, s.score, s.task_pts, s.hours_pts, s.punct_pts, s.work_days,
         s.given, s.given_on_time, s.hours, s.on_time_days, s.full_days
    FROM public.users u
   CROSS JOIN LATERAL public.work_office_score(u.id, p_from, p_to) s
   WHERE u.is_active
     AND u.role IN ('staff', 'hr', 'accounts', 'office_admin')
     AND (v_all OR u.id = auth.uid())
   ORDER BY u.name;
END $function$;

REVOKE ALL ON FUNCTION public.office_scores(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.office_scores(date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY (read-only): expect internal_client_exec = false, wrapper_client_exec = true
-- SELECT has_function_privilege('authenticated','public.work_office_score(uuid,date,date)','execute') AS internal_client_exec,
--        has_function_privilege('authenticated','public.office_scores(date,date)','execute')           AS wrapper_client_exec;
