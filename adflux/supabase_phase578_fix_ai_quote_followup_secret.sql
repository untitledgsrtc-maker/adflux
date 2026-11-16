-- =====================================================================
-- Phase 578 — ai_quote_followup_dispatch: real secret instead of the placeholder
-- =====================================================================
-- Found 17 Nov 2026: the live function sent the literal text '<AI_REPLY_SECRET>'
-- (supabase_ai_quote_followup.sql line ~205 ships a placeholder), so
-- /api/wa/ai-followup refused every call with 403 since it was installed.
-- Fix: rebuild the function with the secret PULLED from the live
-- wa_ai_reply_dispatch (same method as supabase_quote_nudge.sql); no secret is
-- written in this file. Body is otherwise identical.
-- NOTE: this sends nothing by itself. The job only messages customers when the
-- account flag ai_followup_enabled is true AND ai_cadence_enabled is false
-- (ai_quote_followup_candidates). On 17 Nov both are false on both numbers:
-- the quality watcher auto-paused WhatsApp follow-ups after a Meta RED rating
-- on 6-7 Nov.
-- If supabase_ai_quote_followup.sql is ever re-run, re-run THIS file after it.
-- =====================================================================

DO $do$
DECLARE v_def text; v_secret text;
BEGIN
  v_def := pg_get_functiondef('public.wa_ai_reply_dispatch'::regproc);
  v_secret := substring(v_def from $re$x-ai-secret'[^']*'([^']+)'$re$);
  IF v_secret IS NULL OR v_secret = '' OR v_secret LIKE '<%' THEN
    RAISE EXCEPTION 'could not read AI_REPLY_SECRET from wa_ai_reply_dispatch';
  END IF;
  EXECUTE format($fn$
    CREATE OR REPLACE FUNCTION public.ai_quote_followup_dispatch()
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = public, extensions, pg_temp AS $body$
    BEGIN
      PERFORM net.http_post(
        url     := 'https://app.untitledad.in/api/wa/ai-followup',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-ai-secret', %L),
        body    := '{}'::jsonb);
    EXCEPTION WHEN OTHERS THEN
      NULL;  -- never let a dispatch hiccup break the cron
    END; $body$;
  $fn$, v_secret);
  EXECUTE 'REVOKE ALL ON FUNCTION public.ai_quote_followup_dispatch() FROM PUBLIC, anon, authenticated';
END $do$;

NOTIFY pgrst, 'reload schema';

-- VERIFY: no placeholder left; still closed to app users.
SELECT
  (pg_get_functiondef('public.ai_quote_followup_dispatch'::regproc) NOT LIKE '%<AI_REPLY_SECRET>%') AS placeholder_gone,
  has_function_privilege('authenticated', 'public.ai_quote_followup_dispatch()', 'execute') AS auth_exec;
