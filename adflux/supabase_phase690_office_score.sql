-- supabase_phase690_office_score.sql (25-11-2026)
-- Owner 25-11-2026: office team (staff, hr, accounts, office_admin) score = tasks GIVEN by someone else
-- finished on time (40) + hours tracked vs 8 h a day (35) + first live clock-in by 09:45 (25).
-- Pays from 1 Dec 2026 through monthly_score; November and earlier stay on the old rules.
-- Canonical homes: db/functions/work_office_score.sql + db/functions/monthly_score.sql.
-- coach_history (Phase 688): office day score now uses work_office_score for that one day.
-- Functions only, no table change. Idempotent (CREATE OR REPLACE).

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

CREATE OR REPLACE FUNCTION public.monthly_score(p_user_id uuid, p_month_start date)
 RETURNS TABLE(user_id uuid, month_start date, working_days integer, avg_score_pct numeric, monthly_salary numeric, base_amount numeric, variable_cap numeric, variable_earned numeric, total_payable numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_avg     numeric := 0;
  v_days    int := 0;
  v_salary  numeric := 0;
  v_base    numeric;
  v_var_cap numeric;
  v_var_earned numeric;
  v_role    text;
  v_business numeric := 0;
  v_wc int := 0;          -- Phase 414: work team counted tasks
  v_won int := 0;         -- Phase 414: work team on-time tasks
  v_join   date;          -- Phase 585: joining date (staff_incentive_profiles.join_date)
  v_factor numeric := 1;  -- Phase 585: share of the month after joining
  v_wd     numeric;       -- Phase 690: office working days counted
BEGIN
  PERFORM public._assert_self_or_admin(p_user_id);

  SELECT AVG(score_pct), COUNT(*)
    INTO v_avg, v_days
    FROM daily_performance dp
   WHERE dp.user_id = p_user_id
     AND dp.work_date >= p_month_start
     AND dp.work_date < (p_month_start + INTERVAL '1 month')
     AND dp.is_excluded = false;

  SELECT COALESCE(sip.monthly_salary, 0) INTO v_salary
    FROM staff_incentive_profiles sip
   WHERE sip.user_id = p_user_id;

  -- Phase 184 Rule 1 inputs: role + this month's business (new-client + renewal
  -- revenue). A sales/telecaller whose business >= 3x salary earns the FULL 30%
  -- variable regardless of daily score.
  -- Fail-closed on purpose: if the row is missing, v_role stays NULL and the
  -- `v_role IN (...)` allow-list below evaluates NULL → false, so Rule 1 simply
  -- doesn't fire. Do NOT "fix" this with a NULL branch — that would change behavior.
  SELECT role INTO v_role FROM public.users WHERE id = p_user_id;

  SELECT COALESCE(SUM(COALESCE(new_client_revenue,0) + COALESCE(renewal_revenue,0)), 0)
    INTO v_business
    FROM public.monthly_sales_data
   WHERE staff_id = p_user_id
     AND month_year = to_char(p_month_start, 'YYYY-MM');

  v_avg     := COALESCE(v_avg, 0);
  v_base    := v_salary * 0.70;
  v_var_cap := v_salary * 0.30;

  -- Phase 585 (owner 17 Nov 2026): someone who JOINS during the month is paid from the joining
  -- date, pro-rata by calendar days (joined 16 Nov -> 15 of 30 days -> half of base + variable cap);
  -- a month that ends before the joining date pays 0. From November 2026 only, so months already
  -- paid never move. The 3x-business rule and the leave daily rate keep using the full salary.
  SELECT sip.join_date INTO v_join FROM staff_incentive_profiles sip WHERE sip.user_id = p_user_id;
  IF p_month_start >= DATE '2026-11-01' AND v_join IS NOT NULL AND v_join > p_month_start THEN
    IF v_join >= (p_month_start + INTERVAL '1 month')::date THEN
      v_factor := 0;
    ELSE
      v_factor := ((p_month_start + INTERVAL '1 month')::date - v_join)::numeric
                / ((p_month_start + INTERVAL '1 month')::date - p_month_start)::numeric;
    END IF;
    v_base    := v_base * v_factor;
    v_var_cap := v_var_cap * v_factor;
  END IF;

  -- Phase 690 (owner 2026-11-25): from December 2026 the OFFICE team (staff, hr, accounts, office_admin)
  -- is scored by work_office_score: tasks given 40 + hours 35 + clock-in by 09:45 25. Same pay curve
  -- (>= 85 full, < 60 zero, linear between). Running month = through yesterday. No working day -> full cap.
  -- working_days reports the working days counted. Earlier months keep the rules below (paid months never move).
  IF v_role IN ('staff', 'hr', 'accounts', 'office_admin') AND p_month_start >= DATE '2026-12-01' THEN
    SELECT s.score, s.work_days INTO v_avg, v_wd
      FROM public.work_office_score(p_user_id, p_month_start,
             LEAST((p_month_start + INTERVAL '1 month')::date - 1,
                   (now() AT TIME ZONE 'Asia/Kolkata')::date - 1)) s;
    v_days := CEIL(COALESCE(v_wd, 0))::int;
    IF v_avg IS NULL THEN
      v_avg := 100; v_var_earned := v_var_cap;
    ELSIF v_avg >= 85 THEN v_var_earned := v_var_cap;
    ELSIF v_avg <  60 THEN v_var_earned := 0;
    ELSE  v_var_earned := v_var_cap * (v_avg - 60) / 25;
    END IF;
  ELSIF v_role = 'staff' THEN
    -- Phase 414 (owner 2026-10-19): the WORK TEAM's variable = tasks finished ON TIME (work_ontime_stats).
    -- >= 85% on time -> full cap; < 60% -> 0; in between linear. Fewer than 3 counted tasks -> full cap
    -- (not enough to judge). avg_score_pct / working_days report on-time % / counted tasks.
    SELECT s.counted, s.on_time INTO v_wc, v_won FROM public.work_ontime_stats(p_user_id, p_month_start) s;
    v_days := COALESCE(v_wc, 0);
    IF v_days < 3 THEN
      v_avg := 100; v_var_earned := v_var_cap;
    ELSE
      v_avg := (v_won::numeric / v_days) * 100;
      IF    v_avg >= 85 THEN v_var_earned := v_var_cap;
      ELSIF v_avg <  60 THEN v_var_earned := 0;
      ELSE  v_var_earned := v_var_cap * (v_avg - 60) / 25;
      END IF;
    END IF;
  ELSIF v_role IN ('sales','telecaller') AND v_salary > 0 AND v_business >= v_salary * 3 THEN
    -- Rule 1 (Phase 184): 3x-business override — full variable, score ignored (sales/TC only).
    v_var_earned := v_var_cap;
  ELSIF v_days = 0 THEN
    v_avg := 100;
    v_var_earned := v_var_cap;
  ELSIF v_avg < 50 THEN
    v_var_earned := 0;
  ELSIF v_avg > 75 THEN
    -- Rule 3 (Phase 270): score ABOVE 75% earns the FULL variable cap (owner
    -- 2026-07-28). 50–75% stays proportional (below); < 50% stays 0 (above).
    v_var_earned := v_var_cap;
  ELSE
    v_var_earned := (v_avg / 100.0) * v_var_cap;   -- 50–75% → proportional
  END IF;

  RETURN QUERY
  SELECT p_user_id, p_month_start, v_days,
         ROUND(v_avg, 1), v_salary, ROUND(v_base, 0),
         ROUND(v_var_cap, 0), ROUND(v_var_earned, 0),
         ROUND(v_base + v_var_earned, 0);
END $function$;

GRANT EXECUTE ON FUNCTION public.monthly_score(uuid, date) TO authenticated;

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
          -- Phase 690: office team = the work_office_score day score (tasks given + hours + clock-in by 09:45)
          ELSE (SELECT o.score FROM public.work_office_score(u.id, d.day, d.day) o)
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

-- VERIFY: expect all true
SELECT has_function_privilege('authenticated','public.office_scores(date,date)','execute')                AS wrapper_ok,
       NOT has_function_privilege('authenticated','public.work_office_score(uuid,date,date)','execute')   AS internal_locked,
       (SELECT pg_get_functiondef(p.oid) LIKE '%work_office_score%' FROM pg_proc p WHERE proname='monthly_score')  AS pay_uses_it,
       (SELECT pg_get_functiondef(p.oid) LIKE '%work_office_score%' FROM pg_proc p WHERE proname='coach_history') AS chart_uses_it;
