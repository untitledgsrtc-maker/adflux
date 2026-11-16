-- =====================================================================
-- Phase 575 — Evening coach, step 2: office Work staff (17 Nov 2026)
-- =====================================================================
-- Extends Phase 574 (sales + telecallers, unchanged) to roles staff, hr,
-- accounts, office_admin. Up to 3 named actions for the next working day:
--   work_overdue   own open task part past its due date (not postponed)
--   work_due_soon  own open task part due on the next working day
--   work_stuck     own part "in process" for 3+ days (not overdue yet)
--   report_share   evening report shared on fewer days than worked (last week)
-- Done-check next night: part finished (or postponed) that day; report shared.
-- Team Evening shows office staff with their on-time % this month
-- (work_ontime_stats, the staff pay rule) instead of the sales day score.
-- ADDITIVE: the sales/TC branch of coach_build_actions is byte-identical to 574.
-- Rollback: re-run supabase_phase574_coach_sales_tc.sql (restores sales-only).
-- =====================================================================

ALTER TABLE public.coach_actions ADD COLUMN IF NOT EXISTS part_id uuid;
ALTER TABLE public.coach_actions DROP CONSTRAINT IF EXISTS coach_actions_kind_check;
ALTER TABLE public.coach_actions ADD CONSTRAINT coach_actions_kind_check CHECK (kind IN (
  'quote_chase','new_lead','meeting_no_quote','overdue_callback','start_time',
  'work_overdue','work_due_soon','work_stuck','report_share'));

CREATE OR REPLACE FUNCTION public.coach_build_actions(p_user uuid, p_for_date date)
  RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_role  text;
  v_n     integer;
  v_avg   numeric;
  v_cnt   integer;
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  -- one build at a time per rep (card opened twice / card + 18:45 cron) -> no duplicate actions
  PERFORM pg_advisory_xact_lock(hashtext('coach:' || p_user::text));
  SELECT role INTO v_role FROM public.users WHERE id = p_user AND is_active;
  IF v_role IS NULL THEN RETURN 0; END IF;

  -- Phase 575: office Work staff (staff / hr / accounts / office_admin)
  IF v_role IN ('staff','hr','accounts','office_admin') THEN
    DELETE FROM public.coach_actions WHERE user_id = p_user AND for_date = p_for_date AND checked_at IS NULL;
    WITH
    pt AS (
      SELECT p.id AS part_id, p.status, p.due_date, p.due_time, p.started_at,
             COALESCE(NULLIF(trim(p.label), ''), t.title) AS title, pr.name AS client
        FROM public.work_task_parts p
        JOIN public.work_tasks t ON t.id = p.task_id
        LEFT JOIN public.work_projects pr ON pr.id = t.project_id
       WHERE p.assignee_id = p_user AND p.status IN ('assigned','in_process')
         AND (p.postponed_until IS NULL OR p.postponed_until <= p_for_date)),
    wo AS (
      SELECT 'work_overdue'::text AS kind, part_id,
             jsonb_build_object('title', title, 'client', client, 'due', due_date) AS detail,
             100 - 30 * (row_number() OVER (ORDER BY due_date, due_time NULLS LAST) - 1) AS prio
        FROM pt WHERE due_date < v_today ORDER BY due_date, due_time NULLS LAST LIMIT 3),
    wd AS (
      SELECT 'work_due_soon'::text, part_id,
             jsonb_build_object('title', title, 'client', client, 'due', due_date, 'due_time', to_char(due_time, 'HH24:MI')),
             90 - 30 * (row_number() OVER (ORDER BY due_time NULLS LAST) - 1)
        FROM pt WHERE due_date = p_for_date ORDER BY due_time NULLS LAST LIMIT 3),
    wk AS (
      SELECT 'work_stuck'::text, part_id,
             jsonb_build_object('title', title, 'client', client, 'days', v_today - (started_at AT TIME ZONE 'Asia/Kolkata')::date),
             80 - 30 * (row_number() OVER (ORDER BY started_at) - 1)
        FROM pt WHERE status = 'in_process' AND started_at < now() - interval '3 days' AND due_date >= v_today
       ORDER BY started_at LIMIT 2),
    rs AS (
      SELECT 'report_share'::text, NULL::uuid, jsonb_build_object('shared', x.shared, 'worked', x.worked), 70
        FROM (SELECT count(*) AS worked, count(*) FILTER (WHERE sh) AS shared
                FROM (SELECT dd.d,
                             (EXISTS (SELECT 1 FROM public.work_report_shares r WHERE r.user_id = p_user AND r.work_date = dd.d)
                           OR EXISTS (SELECT 1 FROM public.work_sessions s WHERE s.user_id = p_user AND s.work_date = dd.d
                                         AND s.evening_summary_sent_at IS NOT NULL)) AS sh
                        FROM (SELECT DISTINCT (e.started_at AT TIME ZONE 'Asia/Kolkata')::date AS d
                                FROM public.work_time_entries e
                               WHERE e.user_id = p_user AND e.status = 'approved'
                                 AND e.started_at >= now() - interval '8 days') dd
                       WHERE dd.d < v_today AND extract(dow FROM dd.d) <> 0) y) x
       WHERE x.worked >= 3 AND x.shared < x.worked),
    allw AS (SELECT * FROM wo UNION ALL SELECT * FROM wd UNION ALL SELECT * FROM wk UNION ALL SELECT * FROM rs),
    dedup AS (SELECT DISTINCT ON (COALESCE(part_id::text, kind)) * FROM allw ORDER BY COALESCE(part_id::text, kind), prio DESC),
    pick AS (SELECT *, row_number() OVER (ORDER BY prio DESC) AS rk FROM dedup ORDER BY prio DESC LIMIT 3)
    INSERT INTO public.coach_actions (user_id, for_date, rank, kind, part_id, detail)
    SELECT p_user, p_for_date, rk, kind, part_id, detail FROM pick
    WHERE NOT EXISTS (SELECT 1 FROM public.coach_actions c
                       WHERE c.user_id = p_user AND c.for_date = p_for_date AND c.checked_at IS NOT NULL);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
  END IF;

  IF v_role NOT IN ('sales','telecaller') THEN RETURN 0; END IF;

  -- average check-in hour over the last 5 working days with a check-in
  SELECT avg(EXTRACT(EPOCH FROM ((check_in_at AT TIME ZONE 'Asia/Kolkata')::time)) / 3600), count(*)
    INTO v_avg, v_cnt
    FROM (SELECT check_in_at FROM public.work_sessions
           WHERE user_id = p_user AND check_in_at IS NOT NULL AND work_date < p_for_date
           ORDER BY work_date DESC LIMIT 5) s;

  -- rebuild only actions not yet checked
  DELETE FROM public.coach_actions WHERE user_id = p_user AND for_date = p_for_date AND checked_at IS NULL;

  WITH
  qc AS (
    SELECT 'quote_chase'::text kind, q.lead_id, q.id quote_id, NULL::uuid follow_up_id,
           jsonb_build_object('who', COALESCE(NULLIF(q.client_company,''), q.client_name, q.quote_number),
                              'name', q.client_name, 'phone', q.client_phone,
                              'amount', q.total_amount, 'quote_number', q.quote_number,
                              'days', (now()::date - COALESCE(t.last_touch, q.created_at)::date)) detail,
           100 - 30 * (row_number() OVER (ORDER BY q.total_amount DESC NULLS LAST) - 1) prio
      FROM public.quotes q
      LEFT JOIN public.leads l ON l.id = q.lead_id
      LEFT JOIN LATERAL (SELECT max(a.created_at) last_touch FROM public.lead_activities a
                          WHERE a.lead_id = q.lead_id AND a.created_by = p_user) t ON true
     WHERE q.created_by = p_user
       AND q.status IN ('sent','negotiating')
       AND q.created_at >= now() - interval '90 days'
       AND q.created_at <  now() - interval '2 days'
       AND COALESCE(l.stage, '') NOT IN ('Won','Lost')
       AND COALESCE(t.last_touch, q.created_at) < now() - interval '5 days'
     ORDER BY q.total_amount DESC NULLS LAST LIMIT 3),
  nl AS (
    SELECT 'new_lead'::text, l.id, NULL::uuid, NULL::uuid,
           jsonb_build_object('who', COALESCE(NULLIF(l.company,''), l.name), 'name', l.name, 'phone', l.phone,
                              'source', l.source, 'created', (l.created_at AT TIME ZONE 'Asia/Kolkata')::date),
           90 - 30 * (row_number() OVER (ORDER BY l.created_at) - 1)
      FROM public.leads l
     WHERE (l.assigned_to = p_user OR l.telecaller_id = p_user)
       AND l.stage = 'New'
       AND l.created_at >= now() - interval '3 days'
       AND NOT COALESCE(l.do_not_call, false)
       AND NOT EXISTS (SELECT 1 FROM public.lead_activities a WHERE a.lead_id = l.id)
     ORDER BY l.created_at LIMIT 3),
  mq AS (
    SELECT 'meeting_no_quote'::text, m.lead_id, NULL::uuid, NULL::uuid,
           jsonb_build_object('who', COALESCE(NULLIF(l.company,''), l.name), 'name', l.name, 'phone', l.phone, 'met', m.met),
           85 - 30 * (row_number() OVER (ORDER BY m.met) - 1)
      FROM (SELECT a.lead_id, min((a.created_at AT TIME ZONE 'Asia/Kolkata')::date) met, min(a.created_at) met_at
              FROM public.lead_activities a
             WHERE a.created_by = p_user AND v_role = 'sales'
               AND a.activity_type IN ('meeting','site_visit') AND a.lead_id IS NOT NULL
               AND a.created_at >= now() - interval '7 days'
               AND COALESCE(a.notes,'') NOT LIKE 'Meeting scheduled%'
               AND COALESCE(a.notes,'') NOT LIKE 'I''m here · auto-check-in%'
             GROUP BY a.lead_id) m
      JOIN public.leads l ON l.id = m.lead_id
     WHERE l.stage IN ('New','Working')
       AND NOT EXISTS (SELECT 1 FROM public.quotes q WHERE q.lead_id = m.lead_id AND q.created_at >= m.met_at)
     ORDER BY m.met LIMIT 3),
  cb AS (
    SELECT 'overdue_callback'::text, f.lead_id, NULL::uuid, f.id,
           jsonb_build_object('who', COALESCE(NULLIF(l.company,''), l.name), 'name', l.name, 'phone', l.phone, 'due', f.follow_up_date),
           80 - 30 * (row_number() OVER (ORDER BY f.follow_up_date, f.follow_up_time NULLS LAST) - 1)
      FROM public.follow_ups f
      JOIN public.leads l ON l.id = f.lead_id
     WHERE f.assigned_to = p_user AND f.is_done = false
       AND f.follow_up_date < (now() AT TIME ZONE 'Asia/Kolkata')::date
       AND l.stage <> 'Lost'
       AND (l.stage <> 'Nurture' OR f.cadence_type = 'nurture')
     ORDER BY f.follow_up_date, f.follow_up_time NULLS LAST LIMIT 3),
  st AS (
    SELECT 'start_time'::text, NULL::uuid, NULL::uuid, NULL::uuid,
           jsonb_build_object('avg_hour', round(v_avg, 2)), 75
     WHERE v_cnt >= 3 AND v_avg > 9.75),
  allc AS (
    SELECT * FROM qc UNION ALL SELECT * FROM nl UNION ALL SELECT * FROM mq
    UNION ALL SELECT * FROM cb UNION ALL SELECT * FROM st),
  dedup AS (  -- one action per lead (highest priority wins); start_time has no lead
    SELECT DISTINCT ON (COALESCE(lead_id::text, kind)) * FROM allc
     ORDER BY COALESCE(lead_id::text, kind), prio DESC),
  pick AS (
    SELECT *, row_number() OVER (ORDER BY prio DESC) rk FROM dedup ORDER BY prio DESC LIMIT 3)
  INSERT INTO public.coach_actions (user_id, for_date, rank, kind, lead_id, quote_id, follow_up_id, detail)
  SELECT p_user, p_for_date, rk, kind, lead_id, quote_id, follow_up_id, detail FROM pick
  WHERE NOT EXISTS (SELECT 1 FROM public.coach_actions c   -- keep already-checked rows
                     WHERE c.user_id = p_user AND c.for_date = p_for_date AND c.checked_at IS NOT NULL);

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.coach_build_actions(uuid, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.coach_build_all()
  RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_d date := public.coach_next_workday((now() AT TIME ZONE 'Asia/Kolkata')::date);
        u record; v_n integer := 0;
BEGIN
  FOR u IN SELECT id FROM public.users WHERE is_active
             AND role IN ('sales','telecaller','staff','hr','accounts','office_admin') LOOP
    BEGIN
      v_n := v_n + public.coach_build_actions(u.id, v_d);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'coach_build_all % failed: %', u.id, SQLERRM;
    END;
  END LOOP;
  RETURN v_n;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.coach_build_all() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.coach_check_done(p_date date)
  RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_from timestamptz := (p_date::timestamp AT TIME ZONE 'Asia/Kolkata');
        v_to   timestamptz := ((p_date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata');
        v_n integer;
BEGIN
  UPDATE public.coach_actions c SET checked_at = now(), done = CASE
    WHEN c.kind = 'quote_chase' THEN
         EXISTS (SELECT 1 FROM public.lead_activities a WHERE a.lead_id = c.lead_id AND a.created_by = c.user_id
                   AND a.created_at >= v_from AND a.created_at < v_to)
      OR EXISTS (SELECT 1 FROM public.call_logs cl WHERE cl.lead_id = c.lead_id AND cl.user_id = c.user_id
                   AND COALESCE(cl.call_at, cl.created_at) >= v_from AND COALESCE(cl.call_at, cl.created_at) < v_to
                   AND cl.duration_seconds >= 10)
      OR EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = c.quote_id AND q.status NOT IN ('sent','negotiating'))
    WHEN c.kind = 'new_lead' THEN
         EXISTS (SELECT 1 FROM public.lead_activities a WHERE a.lead_id = c.lead_id AND a.created_at < v_to)
      OR EXISTS (SELECT 1 FROM public.call_logs cl WHERE cl.lead_id = c.lead_id AND COALESCE(cl.call_at, cl.created_at) < v_to)
    WHEN c.kind = 'meeting_no_quote' THEN
         EXISTS (SELECT 1 FROM public.quotes q WHERE q.lead_id = c.lead_id AND q.created_at >= c.created_at - interval '1 day' AND q.created_at < v_to)
      OR EXISTS (SELECT 1 FROM public.leads l WHERE l.id = c.lead_id AND l.stage IN ('Lost','Nurture','Won'))
    WHEN c.kind = 'overdue_callback' THEN
         EXISTS (SELECT 1 FROM public.follow_ups f WHERE f.id = c.follow_up_id AND f.is_done
                   AND COALESCE(f.done_note,'') !~* '(auto-closed|auto-skipped|retro-closed|heal|closed: auto)')
      OR EXISTS (SELECT 1 FROM public.lead_activities a WHERE a.lead_id = c.lead_id AND a.created_by = c.user_id
                   AND a.created_at >= v_from AND a.created_at < v_to)
    WHEN c.kind = 'start_time' THEN
         EXISTS (SELECT 1 FROM public.work_sessions w WHERE w.user_id = c.user_id AND w.work_date = p_date
                   AND (w.check_in_at AT TIME ZONE 'Asia/Kolkata')::time <= time '09:30')
    WHEN c.kind IN ('work_overdue','work_due_soon','work_stuck') THEN
         EXISTS (SELECT 1 FROM public.work_task_parts p WHERE p.id = c.part_id
                   AND ((p.status = 'finished' AND p.finished_at < v_to)
                     OR (p.postponed_at >= v_from AND p.postponed_at < v_to)))
    WHEN c.kind = 'report_share' THEN
         EXISTS (SELECT 1 FROM public.work_report_shares r WHERE r.user_id = c.user_id AND r.work_date = p_date)
      OR EXISTS (SELECT 1 FROM public.work_sessions s WHERE s.user_id = c.user_id AND s.work_date = p_date
                   AND s.evening_summary_sent_at IS NOT NULL)
    ELSE false END
  WHERE c.for_date = p_date AND c.checked_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.coach_check_done(date) FROM PUBLIC, anon, authenticated;

-- team view: admin = sales/TC + office staff; sales manager = his assigned reps only
CREATE OR REPLACE FUNCTION public.coach_team_view(p_date date)
  RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_admin boolean := COALESCE(public.get_my_role() = 'admin', false);
        v_mgr   boolean := COALESCE(public.is_sales_manager(), false);
        v_next  date := public.coach_next_workday(p_date);
        v_month date := date_trunc('month', p_date)::date;
BEGIN
  IF auth.uid() IS NULL OR NOT (v_admin OR v_mgr) THEN
    RAISE EXCEPTION 'admin or sales manager only' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(r ORDER BY r.done_rate_14d NULLS FIRST, r.name)
      FROM (
        SELECT u.id, u.name, u.role,
               CASE WHEN u.role IN ('sales','telecaller') THEN 'day' ELSE 'ontime' END AS score_kind,
               CASE WHEN u.role IN ('sales','telecaller') THEN
                      (SELECT round(dp.score_pct) FROM public.daily_performance dp WHERE dp.user_id = u.id AND dp.work_date = p_date)
                    ELSE
                      (SELECT round(100.0 * s.on_time / NULLIF(s.counted, 0)) FROM public.work_ontime_stats(u.id, v_month) s)
               END AS score_today,
               (SELECT count(*) FILTER (WHERE c.done) FROM public.coach_actions c WHERE c.user_id = u.id AND c.for_date = p_date) AS done_today,
               (SELECT count(*) FROM public.coach_actions c WHERE c.user_id = u.id AND c.for_date = p_date) AS actions_today,
               (SELECT round(100.0 * count(*) FILTER (WHERE c.done) / NULLIF(count(*) FILTER (WHERE c.checked_at IS NOT NULL), 0))
                  FROM public.coach_actions c WHERE c.user_id = u.id AND c.for_date > p_date - 14 AND c.for_date <= p_date) AS done_rate_14d,
               (SELECT jsonb_agg(jsonb_build_object('kind', c.kind, 'detail', c.detail, 'lead_id', c.lead_id, 'quote_id', c.quote_id, 'part_id', c.part_id) ORDER BY c.rank)
                  FROM public.coach_actions c WHERE c.user_id = u.id AND c.for_date = v_next) AS next_actions
          FROM public.users u
         WHERE u.is_active
           AND ((v_admin AND u.role IN ('sales','telecaller','staff','hr','accounts','office_admin'))
             OR (NOT v_admin AND u.role IN ('sales','telecaller') AND u.manager_id = auth.uid()))
      ) r), '[]'::jsonb);
END $fn$;
REVOKE EXECUTE ON FUNCTION public.coach_team_view(date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.coach_team_view(date) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY: constraint has the 4 work kinds; build covers office roles; functions still closed.
SELECT
  (SELECT pg_get_constraintdef(oid) LIKE '%report_share%' FROM pg_constraint WHERE conname = 'coach_actions_kind_check') AS kinds_ok,
  (SELECT prosrc LIKE '%office_admin%' FROM pg_proc WHERE proname = 'coach_build_all') AS build_all_office,
  has_function_privilege('authenticated', 'public.coach_build_actions(uuid,date)', 'execute') AS build_actions_auth;
