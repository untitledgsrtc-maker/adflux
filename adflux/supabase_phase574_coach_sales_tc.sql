-- =====================================================================
-- Phase 574 — Evening coach, step 1: sales + telecallers (17 Nov 2026)
-- =====================================================================
-- Owner: an agent in the evening that tells each person how to be more
-- productive, with their score. Step 1 = sales + telecaller reps.
--
-- Each evening every rep gets up to 3 actions for the NEXT working day,
-- always naming a real lead / quote (fixed rules on the app's own data, no AI,
-- so names and amounts are always true). The text (English + Gujarati) is
-- written by the app from kind + detail (src/utils/coachText.js).
--
-- Rules (priority order, one lead used once):
--   quote_chase      own open quote (sent/negotiating, 2-90 days old) with no
--                    activity by the rep on its lead for 5+ days; biggest first
--   new_lead         own lead in stage New, created in the last 3 days, never
--                    touched by anyone, not Do-Not-Call; oldest first
--   meeting_no_quote (sales only) done meeting in the last 7 days (section 33
--                    rule: no scheduled / auto check-in rows) on a New/Working
--                    lead that has no quote since; oldest first
--   overdue_callback own overdue open follow-up, lead not Lost, a Nurture lead
--                    only for its nurture check-in; oldest first
--   start_time       average check-in of the last 5 working days after 09:45
-- Next day at 23:45 IST each action is checked and marked done / not done.
-- That done-rate is the real productivity number (team page).
-- ADDITIVE: new table + functions + 2 cron jobs. Reads only existing tables;
-- nothing is added to any save path. Advice only, no pay effect.
-- Rollback: SELECT cron.unschedule('coach-build'); SELECT cron.unschedule('coach-check');
--           DROP FUNCTION coach_build_actions(uuid,date), coach_build_mine(),
--           coach_build_all(), coach_check_done(date), coach_team_view(date),
--           coach_next_workday(date); DROP TABLE coach_actions;
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.coach_actions (
  id           bigserial PRIMARY KEY,
  user_id      uuid NOT NULL,
  for_date     date NOT NULL,
  rank         smallint NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('quote_chase','new_lead','meeting_no_quote','overdue_callback','start_time')),
  lead_id      uuid,
  quote_id     uuid,
  follow_up_id uuid,
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  done         boolean,
  checked_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_coach_actions_user_date ON public.coach_actions (user_id, for_date);
CREATE INDEX IF NOT EXISTS idx_coach_actions_date ON public.coach_actions (for_date);

ALTER TABLE public.coach_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS coach_actions_read ON public.coach_actions;
CREATE POLICY coach_actions_read ON public.coach_actions FOR SELECT USING (
  user_id = (SELECT auth.uid())
  OR COALESCE((SELECT get_my_role()) = 'admin', false)
  OR ((SELECT public.is_sales_manager())
      AND user_id IN (SELECT u.id FROM public.users u WHERE u.manager_id = (SELECT auth.uid())))
);
REVOKE ALL ON public.coach_actions FROM anon, authenticated;
GRANT SELECT ON public.coach_actions TO authenticated;

-- next date after p_date that is not a Sunday / holiday (is_off_day)
CREATE OR REPLACE FUNCTION public.coach_next_workday(p_date date)
  RETURNS date LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE d date := p_date + 1;
BEGIN
  FOR i IN 1..10 LOOP
    IF NOT COALESCE(public.is_off_day(d), false) THEN RETURN d; END IF;
    d := d + 1;
  END LOOP;
  RETURN p_date + 1;
END $fn$;

CREATE OR REPLACE FUNCTION public.coach_build_actions(p_user uuid, p_for_date date)
  RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_role  text;
  v_n     integer;
  v_avg   numeric;
  v_cnt   integer;
BEGIN
  -- one build at a time per rep (card opened twice / card + 18:45 cron) -> no duplicate actions
  PERFORM pg_advisory_xact_lock(hashtext('coach:' || p_user::text));
  SELECT role INTO v_role FROM public.users WHERE id = p_user AND is_active;
  IF v_role IS NULL OR v_role NOT IN ('sales','telecaller') THEN RETURN 0; END IF;

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
REVOKE EXECUTE ON FUNCTION public.coach_next_workday(date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.coach_next_workday(date) TO authenticated;

-- the rep's evening card calls this: rebuild my own actions, return the date
CREATE OR REPLACE FUNCTION public.coach_build_mine()
  RETURNS date
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_d date := public.coach_next_workday((now() AT TIME ZONE 'Asia/Kolkata')::date);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'login required' USING ERRCODE = '42501'; END IF;
  PERFORM public.coach_build_actions(auth.uid(), v_d);
  RETURN v_d;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.coach_build_mine() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.coach_build_mine() TO authenticated;

CREATE OR REPLACE FUNCTION public.coach_build_all()
  RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_d date := public.coach_next_workday((now() AT TIME ZONE 'Asia/Kolkata')::date);
        u record; v_n integer := 0;
BEGIN
  FOR u IN SELECT id FROM public.users WHERE is_active AND role IN ('sales','telecaller') LOOP
    BEGIN
      v_n := v_n + public.coach_build_actions(u.id, v_d);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'coach_build_all % failed: %', u.id, SQLERRM;
    END;
  END LOOP;
  RETURN v_n;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.coach_build_all() FROM PUBLIC, anon, authenticated;

-- mark each action of p_date done / not done
CREATE OR REPLACE FUNCTION public.coach_check_done(p_date date)
  RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_from timestamptz := (p_date::timestamp AT TIME ZONE 'Asia/Kolkata');
        v_to   timestamptz := ((p_date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata');
        v_n integer;
BEGIN
  UPDATE public.coach_actions c SET checked_at = now(), done = CASE c.kind
    WHEN 'quote_chase' THEN
         EXISTS (SELECT 1 FROM public.lead_activities a WHERE a.lead_id = c.lead_id AND a.created_by = c.user_id
                   AND a.created_at >= v_from AND a.created_at < v_to)
      OR EXISTS (SELECT 1 FROM public.call_logs cl WHERE cl.lead_id = c.lead_id AND cl.user_id = c.user_id
                   AND COALESCE(cl.call_at, cl.created_at) >= v_from AND COALESCE(cl.call_at, cl.created_at) < v_to
                   AND cl.duration_seconds >= 10)
      OR EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = c.quote_id AND q.status NOT IN ('sent','negotiating'))
    WHEN 'new_lead' THEN
         EXISTS (SELECT 1 FROM public.lead_activities a WHERE a.lead_id = c.lead_id AND a.created_at < v_to)
      OR EXISTS (SELECT 1 FROM public.call_logs cl WHERE cl.lead_id = c.lead_id AND COALESCE(cl.call_at, cl.created_at) < v_to)
    WHEN 'meeting_no_quote' THEN
         EXISTS (SELECT 1 FROM public.quotes q WHERE q.lead_id = c.lead_id AND q.created_at >= c.created_at - interval '1 day' AND q.created_at < v_to)
      OR EXISTS (SELECT 1 FROM public.leads l WHERE l.id = c.lead_id AND l.stage IN ('Lost','Nurture','Won'))
    WHEN 'overdue_callback' THEN
         EXISTS (SELECT 1 FROM public.follow_ups f WHERE f.id = c.follow_up_id AND f.is_done
                   AND COALESCE(f.done_note,'') !~* '(auto-closed|auto-skipped|retro-closed|heal|closed: auto)')
      OR EXISTS (SELECT 1 FROM public.lead_activities a WHERE a.lead_id = c.lead_id AND a.created_by = c.user_id
                   AND a.created_at >= v_from AND a.created_at < v_to)
    WHEN 'start_time' THEN
         EXISTS (SELECT 1 FROM public.work_sessions w WHERE w.user_id = c.user_id AND w.work_date = p_date
                   AND (w.check_in_at AT TIME ZONE 'Asia/Kolkata')::time <= time '09:30')
    ELSE false END
  WHERE c.for_date = p_date AND c.checked_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.coach_check_done(date) FROM PUBLIC, anon, authenticated;

-- team view: admin = all sales/TC reps; sales manager = his assigned reps
CREATE OR REPLACE FUNCTION public.coach_team_view(p_date date)
  RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_admin boolean := COALESCE(public.get_my_role() = 'admin', false);
        v_mgr   boolean := COALESCE(public.is_sales_manager(), false);
        v_next  date := public.coach_next_workday(p_date);
BEGIN
  IF auth.uid() IS NULL OR NOT (v_admin OR v_mgr) THEN
    RAISE EXCEPTION 'admin or sales manager only' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(r ORDER BY r.done_rate_14d NULLS FIRST, r.name)
      FROM (
        SELECT u.id, u.name, u.role,
               (SELECT round(dp.score_pct) FROM public.daily_performance dp WHERE dp.user_id = u.id AND dp.work_date = p_date) AS score_today,
               (SELECT count(*) FILTER (WHERE c.done) FROM public.coach_actions c WHERE c.user_id = u.id AND c.for_date = p_date) AS done_today,
               (SELECT count(*) FROM public.coach_actions c WHERE c.user_id = u.id AND c.for_date = p_date) AS actions_today,
               (SELECT round(100.0 * count(*) FILTER (WHERE c.done) / NULLIF(count(*) FILTER (WHERE c.checked_at IS NOT NULL), 0))
                  FROM public.coach_actions c WHERE c.user_id = u.id AND c.for_date > p_date - 14 AND c.for_date <= p_date) AS done_rate_14d,
               (SELECT jsonb_agg(jsonb_build_object('kind', c.kind, 'detail', c.detail, 'lead_id', c.lead_id, 'quote_id', c.quote_id) ORDER BY c.rank)
                  FROM public.coach_actions c WHERE c.user_id = u.id AND c.for_date = v_next) AS next_actions
          FROM public.users u
         WHERE u.is_active AND u.role IN ('sales','telecaller')
           AND (v_admin OR u.manager_id = auth.uid())
      ) r), '[]'::jsonb);
END $fn$;
REVOKE EXECUTE ON FUNCTION public.coach_team_view(date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.coach_team_view(date) TO authenticated;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'coach-build') THEN PERFORM cron.unschedule('coach-build'); END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'coach-check') THEN PERFORM cron.unschedule('coach-check'); END IF;
  PERFORM cron.schedule('coach-build', '15 13 * * *', 'SELECT public.coach_build_all();');   -- 18:45 IST
  PERFORM cron.schedule('coach-check', '15 18 * * *',                                       -- 23:45 IST
    $c$SELECT public.coach_check_done((now() AT TIME ZONE 'Asia/Kolkata')::date);$c$);
END $$;

NOTIFY pgrst, 'reload schema';

-- VERIFY: 2 cron jobs; internal functions closed; app functions open to logged-in users only.
SELECT
  (SELECT count(*) FROM cron.job WHERE jobname IN ('coach-build','coach-check')) AS cron_jobs,
  has_function_privilege('authenticated', 'public.coach_build_actions(uuid,date)', 'execute') AS build_actions_auth,
  has_function_privilege('anon', 'public.coach_build_mine()', 'execute') AS build_mine_anon,
  has_function_privilege('authenticated', 'public.coach_team_view(date)', 'execute') AS team_view_auth;
