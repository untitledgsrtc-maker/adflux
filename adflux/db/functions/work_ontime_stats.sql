-- ============================================================================
-- db/functions/work_ontime_stats.sql - CANONICAL HOME (Phase 414, 2026-10-19)
-- ============================================================================
-- The work team's variable pay = tasks finished ON TIME (owner decision 2026-10-19).
-- ONE definition (section 71). monthly_score() calls it for role 'staff'.
--
-- COUNTED task (work_task_parts of the person, due_date in the month):
--   * due date has PASSED (due_date < IST today; for a past month all of them), OR it was sent back and is not redone
--   * NOT postponed right now, NOT declined (reject_kind='declined'), NOT on an approved full-day leave day
--   * tasks with no due date are not counted at all
-- ON TIME = finished by the end of the due day; if the task has a due time and was finished on the due day,
--   finished at or before that time.
-- Fewer than 3 counted tasks -> not enough to judge (caller pays the full variable).
-- PAY CURVE lives in monthly_score(): >=85% full, <60% zero, linear in between.
-- Internal helper: REVOKEd from client roles (monthly_score is SECURITY DEFINER).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.work_ontime_stats(p_user_id uuid, p_month_start date)
 RETURNS TABLE(counted integer, on_time integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH t AS (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS today),
  p AS (
    SELECT x.*,
           (x.finished_at AT TIME ZONE 'Asia/Kolkata')::date AS fin_day,
           (x.finished_at AT TIME ZONE 'Asia/Kolkata')::time AS fin_time
      FROM public.work_task_parts x, t
     WHERE x.assignee_id = p_user_id
       AND x.due_date >= p_month_start
       AND x.due_date <  (p_month_start + INTERVAL '1 month')
       AND x.status <> 'postponed'
       AND COALESCE(x.reject_kind, '') <> 'declined'
       AND (x.due_date < t.today OR (x.reject_kind = 'sent_back' AND x.status <> 'finished'))
       AND NOT EXISTS (SELECT 1 FROM public.leaves l
                        WHERE l.user_id = p_user_id AND l.leave_date = x.due_date
                          AND l.status = 'approved' AND COALESCE(l.is_half_day, false) = false)
  )
  SELECT COUNT(*)::int,
         COUNT(*) FILTER (WHERE status = 'finished' AND COALESCE(reject_kind,'') <> 'sent_back'
                           AND (fin_day < due_date
                                OR (fin_day = due_date AND (due_time IS NULL OR fin_time <= due_time))))::int
    FROM p;
$function$;

REVOKE ALL ON FUNCTION public.work_ontime_stats(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.work_ontime_stats(uuid, date) TO service_role;
NOTIFY pgrst, 'reload schema';

-- VERIFY (read-only): not callable by a client role, SECURITY DEFINER.
-- SELECT p.prosecdef AS definer,
--        has_function_privilege('authenticated','public.work_ontime_stats(uuid,date)','execute') AS auth_exec,
--        has_function_privilege('anon','public.work_ontime_stats(uuid,date)','execute') AS anon_exec
--   FROM pg_proc p WHERE p.proname='work_ontime_stats';
