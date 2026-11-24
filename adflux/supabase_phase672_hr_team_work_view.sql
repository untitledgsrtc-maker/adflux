-- supabase_phase672_hr_team_work_view.sql (24-11-2026)
-- Owner approved 24-11-2026 ("hr attendance show all staff in team work", chose VIEW-ONLY).
-- HR can SEE Team Work for everyone: people, who is on the clock, hours, tasks, templates,
-- evening-report shares, nudges, and the hours report. Read-only:
--   * only new SELECT policies (additive; existing rules untouched),
--   * work_hours_report also answers role 'hr',
--   * every change function (move / assign / approve time / due dates / stop timer / members /
--     projects) still checks work_is_head(), so HR's changes are refused by the database.
-- NOT included on purpose: screenshots, app-activity, idle events, tracking settings (staff
-- monitoring stays with Team Work heads / admin).

DROP POLICY IF EXISTS work_members_hr_read ON public.work_members;
CREATE POLICY work_members_hr_read ON public.work_members FOR SELECT USING ((SELECT public.get_my_role()) = 'hr');

DROP POLICY IF EXISTS work_templates_hr_read ON public.work_templates;
CREATE POLICY work_templates_hr_read ON public.work_templates FOR SELECT USING ((SELECT public.get_my_role()) = 'hr');

DROP POLICY IF EXISTS work_entries_hr_read ON public.work_time_entries;
CREATE POLICY work_entries_hr_read ON public.work_time_entries FOR SELECT USING ((SELECT public.get_my_role()) = 'hr');

DROP POLICY IF EXISTS work_shares_hr_read ON public.work_report_shares;
CREATE POLICY work_shares_hr_read ON public.work_report_shares FOR SELECT USING ((SELECT public.get_my_role()) = 'hr');

DROP POLICY IF EXISTS work_task_nudges_hr_read ON public.work_task_nudges;
CREATE POLICY work_task_nudges_hr_read ON public.work_task_nudges FOR SELECT USING ((SELECT public.get_my_role()) = 'hr');

DROP POLICY IF EXISTS work_tasks_hr_read ON public.work_tasks;
CREATE POLICY work_tasks_hr_read ON public.work_tasks FOR SELECT USING ((SELECT public.get_my_role()) = 'hr');

DROP POLICY IF EXISTS work_parts_hr_read ON public.work_task_parts;
CREATE POLICY work_parts_hr_read ON public.work_task_parts FOR SELECT USING ((SELECT public.get_my_role()) = 'hr');

CREATE OR REPLACE FUNCTION public.work_hours_report(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_from timestamptz; v_to timestamptz; v_out jsonb;
BEGIN
  -- Phase 672: HR may VIEW the hours report too (read-only; every change function stays head-only).
  IF auth.uid() IS NULL OR NOT (public.work_is_head() OR public.get_my_role() = 'hr') THEN RETURN '{}'::jsonb; END IF;
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
$function$;

NOTIFY pgrst, 'reload schema';

-- VERIFY: expect hr_read_policies=7, report_allows_hr=true, head_check_kept=true
SELECT
  (SELECT count(*) FROM pg_policy WHERE polname LIKE 'work_%hr_read') AS hr_read_policies,
  (SELECT pg_get_functiondef(oid) LIKE '%get_my_role() = ''hr''%' FROM pg_proc WHERE proname = 'work_hours_report') AS report_allows_hr,
  (SELECT pg_get_functiondef(oid) LIKE '%work_is_head()%' FROM pg_proc WHERE proname = 'work_move_part') AS head_check_kept;

-- 672b (owner 24-11-2026, "make her view-only"): HR was ALSO a Team Work head (full change
-- powers). Remove the head flag for HR users so the view-only rule above is the only access.
UPDATE public.work_members m SET is_head = false
  FROM public.users u
 WHERE u.id = m.user_id AND u.role = 'hr' AND m.is_head;
-- VERIFY: expect hr_heads = 0
SELECT count(*) AS hr_heads FROM public.work_members m JOIN public.users u ON u.id = m.user_id WHERE u.role = 'hr' AND m.is_head;
