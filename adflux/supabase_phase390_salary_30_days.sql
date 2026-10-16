-- supabase_phase390_salary_30_days.sql
-- Phase 390 (owner 16 Oct 2026): "salary will be calculated based on 30 days, not 26; leave will be same;
-- this month and now onwards". Leave rules are untouched.
--  1. salary_policy gets unpaid_divisor_new / unpaid_divisor_from; FY 2026-27 -> 30 from month '2026-10'.
--     April-September 2026 keep 26 (already paid months must not move).
--  2. _compute_monthly_salary_base picks the divisor by month (the ONLY change in that function).
--  3. Work hourly cost rate = monthly salary / 30 / 8 (was / 26 / 8): work_user_rate + work_cost_report.
-- Idempotent.
ALTER TABLE public.salary_policy ADD COLUMN IF NOT EXISTS unpaid_divisor_new  int;
ALTER TABLE public.salary_policy ADD COLUMN IF NOT EXISTS unpaid_divisor_from text;
UPDATE public.salary_policy SET unpaid_divisor_new = 30, unpaid_divisor_from = '2026-10' WHERE fy = '2026-27';

-- 2. _compute_monthly_salary_base: the divisor-by-month change lives ONLY in the canonical file
--    db/functions/_compute_monthly_salary_base.sql (section 71/72: one definition). Run that file after this one.
--    Its VERIFY block has a tripwire (%unpaid_divisor_from%).

CREATE OR REPLACE FUNCTION public.work_user_rate(p_user uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE((SELECT round(s.monthly_salary / 30.0 / 8.0, 2)
                     FROM public.staff_incentive_profiles s
                    WHERE s.user_id = p_user
                    ORDER BY s.is_active DESC NULLS LAST LIMIT 1), 0);
$function$;

CREATE OR REPLACE FUNCTION public.work_cost_report(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_from timestamptz; v_to timestamptz; v_out jsonb; v_role text := public.get_my_role();
BEGIN
  IF auth.uid() IS NULL OR v_role IS NULL OR v_role NOT IN ('admin','accounts') OR NOT public.work_is_active_user() THEN
    RETURN '{}'::jsonb;
  END IF;
  IF p_to - p_from > 92 THEN p_to := p_from + 92; END IF;
  v_from := (p_from::timestamp AT TIME ZONE 'Asia/Kolkata');
  v_to   := ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Kolkata');
  WITH rate AS (
    SELECT s.user_id, round(s.monthly_salary / 30.0 / 8.0, 2) AS r FROM public.staff_incentive_profiles s
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
$function$;

NOTIFY pgrst, 'reload schema';
-- VERIFY: SELECT unpaid_divisor, unpaid_divisor_new, unpaid_divisor_from FROM salary_policy WHERE fy='2026-27';  -> 26 / 30 / 2026-10
--         SELECT pg_get_functiondef('public._compute_monthly_salary_base(uuid,integer,integer)'::regprocedure) LIKE '%unpaid_divisor_from%';  -> t
