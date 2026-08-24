-- supabase_wa_ai_recovery.sql
-- WhatsApp Agent v2 — Batch 2b: GHOSTED-INBOUND recovery (§225 audit item).
-- ─────────────────────────────────────────────────────────────────────────
-- The normal AI reply fires on the message INSERT (wa_ai_reply_dispatch §246 →
-- pg_net POST → /api/wa/ai-reply). If that ONE async POST is DROPPED (a Vercel
-- cold-start / 500 / network blip), the customer's message goes silently
-- unanswered — no reply from either side. This cron is the safety net: every
-- 5 min it finds an inbound that got NO reply and re-fires the SAME ai-reply
-- dispatch for it, ONCE.
--
-- WHY THIS IS SAFE (can never double-reply / spam):
-- - It re-POSTs to the EXISTING /api/wa/ai-reply, which re-checks EVERY gate
--   itself (ai_enabled, ai_paused, 24h window, lead opt-out, AND "newest message
--   is inbound" — ai-reply.js:186). So if the message was ALREADY answered
--   (newest is now outbound) ai-reply no-ops (`already_handled`). The candidate
--   query here is just a fast pre-filter; ai-reply is the authoritative gate.
-- - ONE shot per stuck inbound: a new `ai_recovery_at` marker is claimed BEFORE
--   the async post (§215 mark-then-send) so a lost post can never infinite-retry.
--   The owner's spec is "re-send ONCE"; a sustained multi-hour ai-reply outage is
--   an infra failure the quality watcher / monitoring surfaces, not something a
--   per-message loop should paper over.
-- - The 4-minute floor gives the normal INSERT-time dispatch time to reply first,
--   so this only ever catches genuinely-DROPPED dispatches (no race with the
--   normal path). Bounded to the last 3h + LIMIT 50/run.
--
-- Additive, §45-safe: one nullable column + a new dispatch fn + a new cron. No
-- existing flow, ai-reply.js, or frozen surface touched. Mirrors the §227
-- quality-watch dispatch (secret PULLED from wa_ai_reply_dispatch → no literal
-- secret handled here). DEPLOY ORDER: run this AFTER supabase_phase246 exists
-- (it reads the AI secret from wa_ai_reply_dispatch); then re-run
-- supabase_phase211_anon_execute_sweep.sql (re-locks wa_ai_recovery_dispatch).

-- ── 1) one-shot recovery marker ─────────────────────────────────────────────
ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS ai_recovery_at timestamptz;

-- ── 2) dispatch — loops stuck inbounds, claims ai_recovery_at, re-fires ai-reply.
--       x-ai-secret PULLED from wa_ai_reply_dispatch (no literal secret in this file).
DO $do$
DECLARE v_def text; v_secret text;
BEGIN
  v_def := pg_get_functiondef('public.wa_ai_reply_dispatch'::regproc);
  v_secret := substring(v_def from $re$x-ai-secret'[^']*'([^']+)'$re$);
  IF v_secret IS NULL OR v_secret = '' THEN
    RAISE EXCEPTION 'could not read AI_REPLY_SECRET from wa_ai_reply_dispatch';
  END IF;
  EXECUTE format($fn$
    CREATE OR REPLACE FUNCTION public.wa_ai_recovery_dispatch()
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = public, extensions, pg_temp AS $body$
    DECLARE r record;
    BEGIN
      FOR r IN
        SELECT c.id
          FROM public.whatsapp_conversations c
          JOIN public.whatsapp_accounts a ON a.id = c.whatsapp_account_id
          LEFT JOIN public.leads l ON l.id = c.lead_id
         WHERE a.ai_enabled = true
           AND c.ai_paused = false
           AND c.last_message_direction = 'in'                 -- newest is inbound = no reply yet
           AND c.window_expires_at > now()                     -- still repliable (free, in-window)
           AND c.last_inbound_at BETWEEN now() - interval '3 hours'
                                     AND now() - interval '4 minutes'   -- past normal latency, still fresh
           AND (c.ai_recovery_at IS NULL OR c.ai_recovery_at < c.last_inbound_at)  -- one shot per stuck inbound
           AND COALESCE(l.wa_opt_out, false) = false
           AND COALESCE(l.do_not_call, false) = false
         ORDER BY c.last_inbound_at ASC
         LIMIT 50
      LOOP
        -- claim BEFORE the async post (§215 mark-then-send) → never infinite-retries
        UPDATE public.whatsapp_conversations SET ai_recovery_at = now() WHERE id = r.id;
        PERFORM net.http_post(
          url     := 'https://app.untitledad.in/api/wa/ai-reply',
          headers := jsonb_build_object('Content-Type','application/json','x-ai-secret', %L),
          body    := jsonb_build_object('conversation_id', r.id::text));
      END LOOP;
    EXCEPTION WHEN OTHERS THEN NULL;  -- a recovery failure can never break anything (§45/§46)
    END; $body$;
  $fn$, v_secret);
  EXECUTE 'REVOKE ALL ON FUNCTION public.wa_ai_recovery_dispatch() FROM PUBLIC, anon, authenticated';
END $do$;

-- ── 3) cron — every 5 min. ai-reply re-checks every gate (can't double-reply);
--       the ai_recovery_at one-shot + the 3h/4min window bound the work. ──
SELECT cron.schedule('wa-ai-recovery', '*/5 * * * *', $$SELECT public.wa_ai_recovery_dispatch();$$);

NOTIFY pgrst, 'reload schema';

-- ── VERIFY — expect recovery_col 1 · dispatch_fn t · dispatch_locked f · cron_job 1 ──
-- SELECT
--   (SELECT count(*) FROM information_schema.columns
--     WHERE table_name='whatsapp_conversations' AND column_name='ai_recovery_at') AS recovery_col,
--   to_regprocedure('public.wa_ai_recovery_dispatch()') IS NOT NULL                AS dispatch_fn,
--   has_function_privilege('authenticated','public.wa_ai_recovery_dispatch()','EXECUTE') AS dispatch_locked,
--   (SELECT count(*) FROM cron.job WHERE jobname='wa-ai-recovery')                 AS cron_job;
