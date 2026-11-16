-- =====================================================================
-- Phase 569 — push delivery monitoring that does not forget (17 Nov 2026)
-- =====================================================================
-- Problem: pg_net keeps HTTP responses only 6 hours (pg_net.ttl). The old
-- push_failures view joined push_log to net._http_response, so every push older
-- than 6 h looked "failed" (1,559 false failures in 7 days) and a REAL failure
-- vanished after 6 h.
-- Fix: every 30 minutes copy each push's outcome into a permanent table
-- (push_outcomes) BEFORE pg_net purges it; push_failures then reads only
-- recorded outcomes. A push with no response after 7 h is stored as 'unknown',
-- never as a failure.
-- ADDITIVE: new table + function + cron + view redefinition. enqueue_push and
-- push_log are untouched (no new work on the push send path).
-- Rollback: SELECT cron.unschedule('push-record-outcomes'); DROP TABLE
-- public.push_outcomes CASCADE; then re-run supabase_phase34z70 / phase153 view.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.push_outcomes (
  log_id      uuid PRIMARY KEY,
  outcome     text NOT NULL CHECK (outcome IN ('ok','failed','timeout','unknown')),
  status_code integer,
  detail      text,
  checked_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.push_outcomes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS push_outcomes_admin_read ON public.push_outcomes;
CREATE POLICY push_outcomes_admin_read ON public.push_outcomes
  FOR SELECT USING (get_my_role() = ANY (ARRAY['admin'::text, 'co_owner'::text]));
REVOKE ALL ON public.push_outcomes FROM anon, authenticated;
GRANT SELECT ON public.push_outcomes TO authenticated;

CREATE OR REPLACE FUNCTION public.push_record_outcomes()
  RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'net', 'pg_temp'
AS $fn$
DECLARE v_n integer;
BEGIN
  WITH ins AS (
    INSERT INTO public.push_outcomes (log_id, outcome, status_code, detail)
    SELECT pl.id,
           CASE WHEN r.id IS NULL                       THEN 'unknown'
                WHEN r.timed_out IS TRUE                THEN 'timeout'
                WHEN r.status_code BETWEEN 200 AND 299  THEN 'ok'
                ELSE 'failed' END,
           r.status_code,
           left(COALESCE(r.error_msg, r.content), 300)
      FROM public.push_log pl
      LEFT JOIN net._http_response r ON r.id = pl.request_id
     WHERE pl.enqueued_at >= now() - interval '2 days'
       AND NOT EXISTS (SELECT 1 FROM public.push_outcomes o WHERE o.log_id = pl.id)
       AND (r.id IS NOT NULL OR pl.enqueued_at < now() - interval '7 hours')
    ON CONFLICT (log_id) DO NOTHING
    RETURNING 1)
  SELECT count(*) INTO v_n FROM ins;
  RETURN v_n;
END $fn$;

REVOKE EXECUTE ON FUNCTION public.push_record_outcomes() FROM PUBLIC, anon, authenticated;

-- same columns and order as before, so nothing that reads it breaks
CREATE OR REPLACE VIEW public.push_failures AS
  SELECT pl.id          AS log_id,
         pl.request_id,
         pl.user_id,
         pl.title,
         pl.body,
         pl.url,
         pl.tag,
         pl.enqueued_at,
         o.status_code,
         o.detail       AS response_body,
         (o.outcome = 'timeout') AS timed_out
    FROM public.push_log pl
    JOIN public.push_outcomes o ON o.log_id = pl.id
   WHERE pl.enqueued_at >= now() - interval '7 days'
     AND o.outcome IN ('failed','timeout');
ALTER VIEW public.push_failures SET (security_invoker = on);

CREATE OR REPLACE VIEW public.push_delivery_daily AS
  SELECT (pl.enqueued_at AT TIME ZONE 'Asia/Kolkata')::date AS day_ist,
         count(*)                                          AS sent,
         count(*) FILTER (WHERE o.outcome = 'ok')          AS delivered,
         count(*) FILTER (WHERE o.outcome IN ('failed','timeout')) AS failed,
         count(*) FILTER (WHERE o.outcome = 'unknown' OR o.log_id IS NULL) AS not_known
    FROM public.push_log pl
    LEFT JOIN public.push_outcomes o ON o.log_id = pl.id
   WHERE pl.enqueued_at >= now() - interval '30 days'
   GROUP BY 1;
ALTER VIEW public.push_delivery_daily SET (security_invoker = on);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'push-record-outcomes') THEN
    PERFORM cron.unschedule('push-record-outcomes');
  END IF;
  PERFORM cron.schedule('push-record-outcomes', '*/30 * * * *', 'SELECT public.push_record_outcomes();');
END $$;

-- first capture now, so today's pushes are recorded immediately
SELECT public.push_record_outcomes();

NOTIFY pgrst, 'reload schema';

-- VERIFY: 1 cron job, table has rows, push_failures no longer lists no-response rows.
SELECT
  (SELECT count(*) FROM cron.job WHERE jobname = 'push-record-outcomes') AS cron_job,
  (SELECT count(*) FROM public.push_outcomes) AS outcomes_recorded,
  (SELECT count(*) FROM public.push_failures) AS real_failures_7d,
  has_function_privilege('authenticated', 'public.push_record_outcomes()', 'execute') AS fn_auth_exec;
