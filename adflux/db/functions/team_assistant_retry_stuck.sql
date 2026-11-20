-- ============================================================================
-- db/functions/team_assistant_retry_stuck.sql - CANONICAL HOME (section 71)
-- ============================================================================
-- Phase 635 (20-11-2026): a team WhatsApp message ("Good morning" etc.) whose bot
-- call timed out stayed status 'new' forever - nothing retried it (Riya, 20 Nov 9:56
-- IST, during a ~1 min server timeout burst). Cron 'team-assistant-retry' (every 5 min)
-- re-queues each request still 'new' 3-60 minutes after it arrived: it inserts a fresh
-- copy (the insert trigger team_assistant_dispatch posts it to the bot as usual - no
-- secret lives here) and marks the old row 'retried'. One retry per message (the copy
-- carries wamid NULL and is never re-copied: only rows WITH a wamid qualify).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.team_assistant_retry_stuck()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_n int := 0; r record;
BEGIN
  FOR r IN
    SELECT * FROM public.team_assistant_requests
     WHERE status = 'new' AND handled_at IS NULL AND wamid IS NOT NULL
       AND created_at BETWEEN now() - interval '60 minutes' AND now() - interval '3 minutes'
     ORDER BY created_at
     LIMIT 20
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.team_assistant_requests SET status = 'retried', handled_at = now() WHERE id = r.id;
    INSERT INTO public.team_assistant_requests (user_id, account_id, wa_from, phone_number_id, message_text, message_type, wamid)
    VALUES (r.user_id, r.account_id, r.wa_from, r.phone_number_id, r.message_text, r.message_type, NULL);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $function$;

REVOKE ALL ON FUNCTION public.team_assistant_retry_stuck() FROM PUBLIC, anon, authenticated;

DO $$ BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'team-assistant-retry';
  PERFORM cron.schedule('team-assistant-retry', '*/5 * * * *', 'SELECT public.team_assistant_retry_stuck();');
END $$;

-- VERIFY: SELECT count(*) FROM cron.job WHERE jobname = 'team-assistant-retry';  -- 1
