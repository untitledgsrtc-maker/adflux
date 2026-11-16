-- =====================================================================
-- Phase 577 — Evening coach: one AI tip per person (17 Nov 2026)
-- =====================================================================
-- Owner: "can't we take help from AI for suggestions to improve productivity?"
-- The 3 named actions stay rule-based (574-576). On top, Claude writes ONE short
-- tip per person (English + Gujarati) from that person's own summary numbers.
--   coach_tip_facts(user)  role-based numbers only (no client names / phones)
--   coach_tip_dispatch()   18:50 IST: for each person whose numbers changed and
--                          whose last tip is 2+ days old, POST {user_id} to
--                          /api/coach/tip (Edge). The endpoint reads the facts
--                          itself, asks Claude, and upserts coach_tips.
--   coach_tips             one row per person per day; RLS = same as coach_actions
-- The x-ai-secret is PULLED from the live wa_ai_reply_dispatch at install time
-- (same as supabase_quote_nudge.sql), so no secret is written in this file.
-- ADDITIVE: new table + functions + 1 cron job. Advice only.
-- Rollback: SELECT cron.unschedule('coach-tip'); DROP FUNCTION coach_tip_dispatch(),
--           coach_tip_facts(uuid); DROP TABLE coach_tips;
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.coach_tips (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL,
  tip_date   date NOT NULL,
  en         text NOT NULL,
  gu         text NOT NULL,
  facts      jsonb NOT NULL,
  facts_hash text NOT NULL,
  model      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, tip_date)
);

ALTER TABLE public.coach_tips ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS coach_tips_read ON public.coach_tips;
CREATE POLICY coach_tips_read ON public.coach_tips FOR SELECT USING (
  user_id = (SELECT auth.uid())
  OR COALESCE((SELECT get_my_role()) = 'admin', false)
  OR ((SELECT public.is_sales_manager())
      AND user_id IN (SELECT u.id FROM public.users u WHERE u.manager_id = (SELECT auth.uid())))
);
REVOKE ALL ON public.coach_tips FROM anon, authenticated;
GRANT SELECT ON public.coach_tips TO authenticated;

-- numbers the AI may use (last 28 days unless named otherwise); integers, no names
CREATE OR REPLACE FUNCTION public.coach_tip_facts(p_user uuid)
  RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_role  text;
  v_from  timestamptz := now() - interval '28 days';
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_done  numeric;
  f       jsonb;
BEGIN
  SELECT role INTO v_role FROM public.users WHERE id = p_user AND is_active;
  IF v_role IS NULL THEN RETURN NULL; END IF;

  SELECT round(100.0 * count(*) FILTER (WHERE done) / NULLIF(count(*) FILTER (WHERE checked_at IS NOT NULL), 0))
    INTO v_done FROM public.coach_actions WHERE user_id = p_user AND for_date > v_today - 14;

  IF v_role IN ('sales','telecaller') THEN
    SELECT jsonb_build_object(
      'days_worked',          (SELECT count(*) FROM public.work_sessions w WHERE w.user_id = p_user AND w.check_in_at >= v_from),
      'avg_checkin',          (SELECT to_char(avg((w.check_in_at AT TIME ZONE 'Asia/Kolkata')::time), 'HH24:MI') FROM public.work_sessions w WHERE w.user_id = p_user AND w.check_in_at >= v_from),
      'real_calls',           (SELECT count(*) FROM public.call_logs c WHERE c.user_id = p_user AND COALESCE(c.call_at, c.created_at) >= v_from AND c.duration_seconds >= 10 AND COALESCE(c.direction,'') <> 'missed'),
      'all_call_logs',        (SELECT count(*) FROM public.call_logs c WHERE c.user_id = p_user AND COALESCE(c.call_at, c.created_at) >= v_from),
      'done_meetings',        (SELECT count(DISTINCT (a.created_at AT TIME ZONE 'Asia/Kolkata')::date::text || COALESCE(a.lead_id::text, a.id::text))
                                 FROM public.lead_activities a WHERE a.created_by = p_user AND a.activity_type IN ('meeting','site_visit') AND a.created_at >= v_from
                                  AND COALESCE(a.notes,'') NOT LIKE 'Meeting scheduled%' AND COALESCE(a.notes,'') NOT LIKE 'I''m here · auto-check-in%'),
      'quotes_sent',          (SELECT count(*) FROM public.quotes q WHERE q.created_by = p_user AND q.created_at >= v_from),
      'quotes_won',           (SELECT count(*) FROM public.quotes q WHERE q.created_by = p_user AND q.status = 'won' AND q.updated_at >= v_from),
      'open_quotes_silent_5d',(SELECT count(*) FROM public.quotes q WHERE q.created_by = p_user AND q.status IN ('sent','negotiating')
                                  AND q.created_at >= now() - interval '90 days'
                                  AND NOT EXISTS (SELECT 1 FROM public.lead_activities a WHERE a.lead_id = q.lead_id AND a.created_by = p_user AND a.created_at > now() - interval '5 days')),
      'overdue_followups',    (SELECT count(*) FROM public.follow_ups fu WHERE fu.assigned_to = p_user AND NOT fu.is_done AND fu.follow_up_date < v_today),
      'avg_score_pct',        (SELECT round(avg(dp.score_pct)) FROM public.daily_performance dp WHERE dp.user_id = p_user AND dp.work_date > v_today - 28)
    ) INTO f;
  ELSIF v_role IN ('operation_executive','operation_head') THEN
    SELECT jsonb_build_object(
      'open_screen_faults',   (SELECT count(*) FROM public.ops_screen_faults x JOIN public.ops_depots d ON d.id = x.depot_id WHERE d.assigned_to = p_user AND x.status = 'open' AND x.kind IN ('offline','manual')),
      'cameras_off',          (SELECT count(*) FROM public.ops_screen_faults x JOIN public.ops_depots d ON d.id = x.depot_id WHERE d.assigned_to = p_user AND x.status = 'open' AND x.kind = 'camera'),
      'tickets_stuck_48h',    (SELECT count(*) FROM public.ops_tickets t WHERE t.assigned_to = p_user AND t.status = 'in_progress' AND t.opened_at < now() - interval '48 hours' AND t.updated_at < now() - interval '24 hours'),
      'faults_fixed_28d',     (SELECT count(*) FROM public.ops_screen_faults x WHERE x.fixed_by = p_user AND x.status = 'fixed' AND x.fixed_at >= v_from),
      'avg_uptime_pct_7d',    (SELECT round(avg(dp.score_pct)) FROM public.daily_performance dp WHERE dp.user_id = p_user AND dp.work_date > v_today - 7),
      'days_worked',          (SELECT count(*) FROM public.work_sessions w WHERE w.user_id = p_user AND w.check_in_at >= v_from)
    ) INTO f;
  ELSIF v_role IN ('staff','hr','accounts','office_admin') THEN
    SELECT jsonb_build_object(
      'tasks_finished_28d',   (SELECT count(*) FROM public.work_task_parts p WHERE p.assignee_id = p_user AND p.status = 'finished' AND p.finished_at >= v_from),
      'tasks_overdue_now',    (SELECT count(*) FROM public.work_task_parts p WHERE p.assignee_id = p_user AND p.status IN ('assigned','in_process') AND p.due_date < v_today
                                  AND (p.postponed_until IS NULL OR p.postponed_until <= v_today)),
      'tasks_stuck_3d',       (SELECT count(*) FROM public.work_task_parts p WHERE p.assignee_id = p_user AND p.status = 'in_process' AND p.started_at < now() - interval '3 days'),
      'ontime_pct_month',     (SELECT round(100.0 * s.on_time / NULLIF(s.counted, 0)) FROM public.work_ontime_stats(p_user, date_trunc('month', v_today)::date) s),
      'hours_tracked_7d',     (SELECT round(sum(EXTRACT(EPOCH FROM (COALESCE(e.ended_at, now()) - e.started_at)) - COALESCE(e.break_seconds, 0)) / 3600)
                                 FROM public.work_time_entries e WHERE e.user_id = p_user AND e.status = 'approved' AND e.started_at >= now() - interval '7 days')
    ) INTO f;
  ELSE
    RETURN NULL;
  END IF;

  RETURN f || jsonb_build_object('role', v_role, 'actions_done_pct_14d', v_done);
END $fn$;
REVOKE EXECUTE ON FUNCTION public.coach_tip_facts(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.coach_tip_facts(uuid) TO service_role;

-- the Edge endpoint saves through this (service role only): stores facts + the
-- same md5(facts::text) the dispatcher compares, one row per person per day
CREATE OR REPLACE FUNCTION public.coach_tip_save(p_user uuid, p_date date, p_en text, p_gu text, p_model text)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE f jsonb := public.coach_tip_facts(p_user);
BEGIN
  IF f IS NULL OR COALESCE(trim(p_en), '') = '' OR COALESCE(trim(p_gu), '') = '' THEN RETURN; END IF;
  INSERT INTO public.coach_tips (user_id, tip_date, en, gu, facts, facts_hash, model)
  VALUES (p_user, p_date, left(p_en, 400), left(p_gu, 600), f, md5(f::text), p_model)
  ON CONFLICT (user_id, tip_date) DO UPDATE SET
    en = EXCLUDED.en, gu = EXCLUDED.gu, facts = EXCLUDED.facts, facts_hash = EXCLUDED.facts_hash,
    model = EXCLUDED.model, created_at = now();
END $fn$;
REVOKE EXECUTE ON FUNCTION public.coach_tip_save(uuid, date, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.coach_tip_save(uuid, date, text, text, text) TO service_role;

-- dispatch: one POST per person who needs a fresh tip (secret pulled, never written here)
DO $do$
DECLARE v_def text; v_secret text;
BEGIN
  v_def := pg_get_functiondef('public.wa_ai_reply_dispatch'::regproc);
  v_secret := substring(v_def from $re$x-ai-secret'[^']*'([^']+)'$re$);
  IF v_secret IS NULL OR v_secret = '' OR v_secret LIKE '<%' THEN
    RAISE EXCEPTION 'could not read AI_REPLY_SECRET from wa_ai_reply_dispatch';
  END IF;
  EXECUTE format($fn$
    CREATE OR REPLACE FUNCTION public.coach_tip_dispatch()
    RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = public, extensions, pg_temp AS $body$
    DECLARE u record; f jsonb; h text; v_n integer := 0;
    BEGIN
      FOR u IN SELECT id FROM public.users WHERE is_active AND role IN
                 ('sales','telecaller','staff','hr','accounts','office_admin','operation_executive','operation_head') LOOP
        f := public.coach_tip_facts(u.id);
        CONTINUE WHEN f IS NULL;
        h := md5(f::text);
        -- skip when the numbers have not changed, or the last tip is under 2 days old
        CONTINUE WHEN EXISTS (SELECT 1 FROM public.coach_tips t WHERE t.user_id = u.id
                               AND (t.facts_hash = h OR t.created_at > now() - interval '2 days'));
        PERFORM net.http_post(
          url     := 'https://app.untitledad.in/api/coach/tip',
          headers := jsonb_build_object('Content-Type','application/json','x-ai-secret', %L),
          body    := jsonb_build_object('user_id', u.id));
        v_n := v_n + 1;
      END LOOP;
      RETURN v_n;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'coach_tip_dispatch failed: %%', SQLERRM;
      RETURN v_n;
    END; $body$;
  $fn$, v_secret);
  EXECUTE 'REVOKE ALL ON FUNCTION public.coach_tip_dispatch() FROM PUBLIC, anon, authenticated';
END $do$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'coach-tip') THEN PERFORM cron.unschedule('coach-tip'); END IF;
  PERFORM cron.schedule('coach-tip', '20 13 * * *', 'SELECT public.coach_tip_dispatch();');   -- 18:50 IST
END $$;

NOTIFY pgrst, 'reload schema';

-- VERIFY: table + RLS, cron job, functions closed to app users.
SELECT
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'coach_tips') AS tips_rls,
  (SELECT count(*) FROM cron.job WHERE jobname = 'coach-tip') AS cron_job,
  has_function_privilege('authenticated', 'public.coach_tip_facts(uuid)', 'execute') AS facts_auth,
  has_function_privilege('authenticated', 'public.coach_tip_dispatch()', 'execute') AS dispatch_auth;
