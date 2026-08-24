-- supabase_wa_quality_watch.sql
-- WhatsApp Agent v2 — Batch 4: quality-rating WATCHER + auto-pause (§227).
-- ─────────────────────────────────────────────────────────────────────────
-- Polls each WhatsApp number's Meta quality_rating a few times a day. On RED
-- (the step before a template block / all-message block / account lock), it
-- AUTO-PAUSES the risky OUTBOUND (ai_cadence_enabled + ai_nudge_enabled +
-- ai_followup_enabled + the first-message image) so the block/report signal
-- stops climbing before a 3rd flag lands — WITHOUT touching ai_enabled (the
-- reactive in-window replies stay on; that's the safe, policy-clean path).
-- YELLOW → logged as an alert (no auto-pause; it often recovers). Never
-- auto-RE-enables (the owner turns things back on manually after a recovery).
--
-- Additive, §45-safe: a new log table + dispatch + cron. Mirrors the §213/§215
-- dispatch (secret PULLED from wa_ai_reply_dispatch → no literal secret handled).
-- DEPLOY ORDER: run supabase_wa_cadence.sql FIRST (it creates ai_cadence_enabled).
-- The endpoint pauses the pre-existing flags in a separate write, so a missing
-- ai_cadence_enabled can't nuke the pause — but running cadence first is cleanest.

-- ── 1) log table ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wa_quality_log (
  id             bigserial PRIMARY KEY,
  checked_at     timestamptz NOT NULL DEFAULT now(),
  phone_number_id text,
  display_number text,
  quality_rating text,        -- GREEN | YELLOW | RED | UNKNOWN
  name_status    text,
  action         text,        -- ok | alert | auto_paused | error
  note           text
);
ALTER TABLE public.wa_quality_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wa_quality_log_read ON public.wa_quality_log;
CREATE POLICY wa_quality_log_read ON public.wa_quality_log
  FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin','co_owner','accounts'));   -- writes come from the service role (endpoint), which bypasses RLS

-- ── 2) dispatch — pg_net POST; x-ai-secret PULLED from wa_ai_reply_dispatch ──
DO $do$
DECLARE v_def text; v_secret text;
BEGIN
  v_def := pg_get_functiondef('public.wa_ai_reply_dispatch'::regproc);
  v_secret := substring(v_def from $re$x-ai-secret'[^']*'([^']+)'$re$);
  IF v_secret IS NULL OR v_secret = '' THEN
    RAISE EXCEPTION 'could not read AI_REPLY_SECRET from wa_ai_reply_dispatch';
  END IF;
  EXECUTE format($fn$
    CREATE OR REPLACE FUNCTION public.wa_quality_watch_dispatch()
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = public, extensions, pg_temp AS $body$
    BEGIN
      PERFORM net.http_post(
        url     := 'https://app.untitledad.in/api/wa/quality-watch',
        headers := jsonb_build_object('Content-Type','application/json','x-ai-secret', %L),
        body    := '{}'::jsonb);
    EXCEPTION WHEN OTHERS THEN NULL;
    END; $body$;
  $fn$, v_secret);
  EXECUTE 'REVOKE ALL ON FUNCTION public.wa_quality_watch_dispatch() FROM PUBLIC, anon, authenticated';
END $do$;

-- ── 3) cron — every 4 hours (00:10, 04:10, … UTC). Quality can drop fast; a
--       frequent read catches a RED early. The endpoint is idempotent (pausing
--       an already-paused account is a no-op). ──
SELECT cron.schedule('wa-quality-watch', '10 */4 * * *', $$SELECT public.wa_quality_watch_dispatch();$$);

NOTIFY pgrst, 'reload schema';

-- ── VERIFY — expect log_table 1 · dispatch_fn t · cron_job 1 ──
-- SELECT
--   (SELECT count(*) FROM information_schema.tables WHERE table_name='wa_quality_log') AS log_table,
--   to_regprocedure('public.wa_quality_watch_dispatch()') IS NOT NULL AS dispatch_fn,
--   (SELECT count(*) FROM cron.job WHERE jobname='wa-quality-watch') AS cron_job;
