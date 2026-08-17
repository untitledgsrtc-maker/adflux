-- supabase_wa_team_assistant_p3.sql
-- WhatsApp Internal Team Assistant — Phase 3 (every-2-hour pending nudge).
-- Spec: docs/WHATSAPP_INTERNAL_ASSISTANT_SPEC.md · Edge fn: api/wa/team-nudge.js
--
-- Fires the team-nudge Edge fn 6x/day during work hours. That fn finds each
-- mapped rep who has (a) >=1 open follow-up due-today/overdue AND (b) an OPEN
-- 24h WhatsApp window (messaged our number in the last 24h), and sends a short
-- free-text reminder from the number they messaged, to their own number.
--
-- v1 = FREE-TEXT ONLY: a rep who has not messaged in 24h is skipped (no template
-- — that's P4). ₹0 messaging. Reps who say "hi" each morning keep the window
-- open all day and receive the nudges; silent reps do not (yet).
--
-- §45-safe: a NEW dispatch fn + a NEW cron job only. Zero change to leads /
-- quotes / whatsapp_conversations / the customer bot / any existing cron.
-- DEPLOY ORDER: safe either way — the fn is REVOKEd from client roles and the
-- Edge endpoint is secret-gated + fail-closed, so this is inert until BOTH this
-- runs AND api/wa/team-nudge.js is live with TEAM_ASSISTANT_SECRET set.
--
-- ⚠ Replace <TEAM_ASSISTANT_SECRET> below with the SAME value already set as
--   Vercel env TEAM_ASSISTANT_SECRET (the one P1's dispatch uses). BEFORE running.

-- ── 1. dispatch fn: async-fire the team-nudge Edge endpoint ──────────────────
-- Mirrors team_assistant_dispatch (§197 / P1): pg_net, secret header,
-- EXCEPTION-wrapped so a dispatch failure can never surface as a cron error.
CREATE OR REPLACE FUNCTION public.team_assistant_nudge_dispatch()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  BEGIN
    PERFORM net.http_post(
      url     := 'https://app.untitledad.in/api/wa/team-nudge',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-ta-secret', '<TEAM_ASSISTANT_SECRET>'),
      body    := '{}'::jsonb,
      timeout_milliseconds := 8000
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'team_assistant_nudge_dispatch failed: %', SQLERRM;
  END;
END;
$$;

-- Fires a WhatsApp send → no client role may call it directly.
REVOKE ALL ON FUNCTION public.team_assistant_nudge_dispatch() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.team_assistant_nudge_dispatch() FROM anon, authenticated;

-- ── 2. cron: 6x/day at work-hour boundaries ─────────────────────────────────
-- pg_cron runs in UTC. IST = UTC + 5:30, so 9/11/13/15/17/19 IST = 3:30 / 5:30 /
-- 7:30 / 9:30 / 11:30 / 13:30 UTC. The Edge fn re-gates IST 09:00–20:00 and
-- SKIPS SUNDAY (which an every-2h cron expression cannot express on its own).
-- Idempotent: unschedule the old job (by name) before re-adding.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'team-assistant-nudge') THEN
    PERFORM cron.unschedule('team-assistant-nudge');
  END IF;
END $$;

SELECT cron.schedule(
  'team-assistant-nudge',
  '30 3,5,7,9,11,13 * * *',
  'SELECT public.team_assistant_nudge_dispatch();'
);

NOTIFY pgrst, 'reload schema';

-- ── VERIFY ──────────────────────────────────────────────────────────────────
-- Expect: dispatch fn present + not client-executable, cron job scheduled once.
-- SELECT count(*) FROM pg_proc WHERE proname = 'team_assistant_nudge_dispatch';                       -- 1
-- SELECT jobname, schedule FROM cron.job WHERE jobname = 'team-assistant-nudge';                       -- 1 row, '30 3,5,7,9,11,13 * * *'
-- SELECT has_function_privilege('authenticated', 'public.team_assistant_nudge_dispatch()', 'EXECUTE'); -- f
--
-- To fire it once by hand (any time — the Edge fn returns {skipped:...} outside
-- work hours, so this is safe to run for a smoke test):
-- SELECT public.team_assistant_nudge_dispatch();
