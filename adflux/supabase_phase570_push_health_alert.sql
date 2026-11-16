-- =====================================================================
-- Phase 570 — alert the admin when push delivery drops (17 Nov 2026)
-- =====================================================================
-- Builds on Phase 569 (push_outcomes). Every 30 min (5 and 35 past) the
-- function push_health_check() looks at the last 2 hours:
--   FAILURE RATE: >= 15 % of pushes with a recorded result failed/timed out,
--                 with at least 15 recorded results (no alert on tiny samples)
--   STUCK:        >= 10 pushes older than 2 h still have NO result at all and
--                 nothing recorded in the same window (pg_net not answering)
-- Either one sends ONE push to the admin(s) and writes a row in
-- push_health_alerts. Cool-down 6 h. Only between 08:00 and 22:00 IST.
-- ADDITIVE: new table + function + cron. No existing function or trigger touched.
-- Rollback: SELECT cron.unschedule('push-health-check'); DROP FUNCTION
-- public.push_health_check(); DROP TABLE public.push_health_alerts;
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.push_health_alerts (
  id         bigserial PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  kind       text NOT NULL CHECK (kind IN ('failure_rate','stuck')),
  recorded   integer NOT NULL,
  failed     integer NOT NULL,
  pending    integer NOT NULL,
  message    text NOT NULL
);

ALTER TABLE public.push_health_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS push_health_alerts_admin_read ON public.push_health_alerts;
CREATE POLICY push_health_alerts_admin_read ON public.push_health_alerts
  FOR SELECT USING (get_my_role() = ANY (ARRAY['admin'::text, 'co_owner'::text]));
REVOKE ALL ON public.push_health_alerts FROM anon, authenticated;
GRANT SELECT ON public.push_health_alerts TO authenticated;

CREATE OR REPLACE FUNCTION public.push_health_check()
  RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_hour    int := EXTRACT(HOUR FROM (now() AT TIME ZONE 'Asia/Kolkata'));
  v_rec     int;
  v_fail    int;
  v_pend    int;
  v_kind    text;
  v_msg     text;
  v_admin   record;
BEGIN
  IF v_hour < 8 OR v_hour >= 22 THEN RETURN 'quiet hours'; END IF;
  IF EXISTS (SELECT 1 FROM public.push_health_alerts WHERE at > now() - interval '6 hours') THEN
    RETURN 'cool-down';
  END IF;

  SELECT count(*) FILTER (WHERE o.outcome IN ('ok','failed','timeout')),
         count(*) FILTER (WHERE o.outcome IN ('failed','timeout'))
    INTO v_rec, v_fail
    FROM public.push_log pl
    JOIN public.push_outcomes o ON o.log_id = pl.id
   WHERE pl.enqueued_at >= now() - interval '2 hours';

  SELECT count(*) INTO v_pend
    FROM public.push_log pl
   WHERE pl.enqueued_at BETWEEN now() - interval '6 hours' AND now() - interval '2 hours'
     AND NOT EXISTS (SELECT 1 FROM public.push_outcomes o WHERE o.log_id = pl.id);

  IF v_rec >= 15 AND v_fail * 100 >= v_rec * 15 THEN
    v_kind := 'failure_rate';
    v_msg  := format('%s of %s pushes failed in the last 2 hours.', v_fail, v_rec);
  ELSIF v_pend >= 10 AND v_rec = 0 THEN
    v_kind := 'stuck';
    v_msg  := format('%s pushes have no delivery result and none were recorded in 2 hours.', v_pend);
  ELSE
    RETURN 'healthy';
  END IF;

  INSERT INTO public.push_health_alerts (kind, recorded, failed, pending, message)
  VALUES (v_kind, v_rec, v_fail, v_pend, v_msg);

  FOR v_admin IN SELECT id FROM public.users WHERE role = 'admin' AND is_active LOOP
    PERFORM public.enqueue_push(v_admin.id, 'Push delivery problem', v_msg, '/push-debug', 'push-health');
  END LOOP;
  RETURN v_kind;
END $fn$;

REVOKE EXECUTE ON FUNCTION public.push_health_check() FROM PUBLIC, anon, authenticated;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'push-health-check') THEN
    PERFORM cron.unschedule('push-health-check');
  END IF;
  PERFORM cron.schedule('push-health-check', '5,35 * * * *', 'SELECT public.push_health_check();');
END $$;

NOTIFY pgrst, 'reload schema';

-- VERIFY: 1 cron job, function not callable by logged-in users, no alert yet on healthy data.
SELECT
  (SELECT count(*) FROM cron.job WHERE jobname = 'push-health-check') AS cron_job,
  has_function_privilege('authenticated', 'public.push_health_check()', 'execute') AS fn_auth_exec,
  (SELECT count(*) FROM public.push_health_alerts) AS alerts_so_far;
