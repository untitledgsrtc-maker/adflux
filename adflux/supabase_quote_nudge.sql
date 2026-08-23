-- supabase_quote_nudge.sql
-- Same-day OPEN-WINDOW quote nudge (2026-08-21).
--
-- After the AI auto-builds + sends a quote (§210 ai_build_quote, source='ai_quote'),
-- if the customer stays SILENT ~2–4h but their 24h WhatsApp service window is STILL
-- OPEN, send ONE gentle FREE-TEXT nudge ("did you get the quote? any questions?").
-- FREE (inside the open window → plain text, no template, no ₹0.8 marketing cost) and
-- ZERO spam risk (only ever messaging someone who messaged us <24h ago). Sidesteps
-- the whole template-reclassification mess (§213) — nothing here is a paid template.
--
-- Ships OFF: whatsapp_accounts.ai_nudge_enabled DEFAULT false = global kill switch.
-- Additive (new column + flag + 2 RPCs + dispatch + cron). §45/§46-safe. Mirrors the
-- §213 ai_quote_followup pattern (cron → pg_net → Edge endpoint → send + mark).

-- ── 1) flag + markers (§226: 2 same-day touches, quoted + un-quoted) ─────────
ALTER TABLE public.whatsapp_accounts      ADD COLUMN IF NOT EXISTS ai_nudge_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.whatsapp_conversations ADD COLUMN IF NOT EXISTS quote_nudge_at    timestamptz;
ALTER TABLE public.whatsapp_conversations ADD COLUMN IF NOT EXISTS quote_nudge_count int NOT NULL DEFAULT 0;
-- backfill: a conversation already nudged once under the old single-marker logic → count 1,
-- so the widened engine can only ever give it TOUCH 2, never a duplicate touch 1.
UPDATE public.whatsapp_conversations SET quote_nudge_count = 1
  WHERE quote_nudge_at IS NOT NULL AND quote_nudge_count = 0;

COMMENT ON COLUMN public.whatsapp_accounts.ai_nudge_enabled IS
  'Same-day open-window nudge on/off (supabase_quote_nudge.sql). Default false.';

-- ── 2) candidates — up to 2 SAME-DAY touches, for quoted AND un-quoted engaged leads ──
-- Touch 1 (~2h+ silent) then Touch 2 (~5h+ silent, only if STILL no reply). Window OPEN
-- (free text, ₹0, no template). Skips Lost/Won/opted-out/DNC (owner: not-interested / lost →
-- no follow-up). "Engaged" = the AI has already replied at least once (a real inquiry, not a
-- cold silent scan). `touch` (1|2) + `has_quote` drive which of 4 messages the endpoint sends.
CREATE OR REPLACE FUNCTION public.quote_nudge_candidates()
RETURNS TABLE (conversation_id uuid, customer_wa_id text, phone_number_id text, lead_name text, touch int, has_quote boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT cv.id, cv.customer_wa_id, a.phone_number_id, COALESCE(l.name, ''),
         COALESCE(cv.quote_nudge_count, 0) + 1 AS touch,
         EXISTS (SELECT 1 FROM public.quotes q WHERE q.lead_id = cv.lead_id) AS has_quote
  FROM public.whatsapp_conversations cv
  JOIN public.whatsapp_accounts a ON a.id = cv.whatsapp_account_id
  JOIN public.leads l             ON l.id = cv.lead_id
  WHERE a.ai_nudge_enabled = true
    AND a.phone_number_id IS NOT NULL
    AND cv.customer_wa_id ~ '^[0-9]{10,15}$'
    AND COALESCE(cv.ai_paused, false) = false                        -- a rep hasn't taken over
    AND cv.window_expires_at > now()                                 -- 24h window OPEN → free text
    AND cv.last_inbound_at IS NOT NULL                               -- they messaged us
    AND COALESCE(l.wa_opt_out, false)  = false
    AND COALESCE(l.do_not_call, false) = false
    AND COALESCE(l.stage, '') NOT IN ('Lost','Won')                  -- not-interested / lost / won → no follow-up
    AND EXISTS (SELECT 1 FROM public.whatsapp_messages m
                 WHERE m.conversation_id = cv.id AND m.direction = 'out')  -- engaged: we already replied
    AND COALESCE(cv.quote_nudge_count, 0) < 2                         -- max 2 same-day touches
    AND (
      -- touch 1: silent ~2h+, none sent yet
      (COALESCE(cv.quote_nudge_count, 0) = 0
         AND cv.last_inbound_at <= now() - interval '2 hours'
         AND cv.last_inbound_at >  now() - interval '10 hours')
      OR
      -- touch 2: silent ~5h+, touch 1 already sent, NO reply since touch 1
      (COALESCE(cv.quote_nudge_count, 0) = 1
         AND cv.quote_nudge_at IS NOT NULL
         AND cv.last_inbound_at <= cv.quote_nudge_at
         AND cv.last_inbound_at <= now() - interval '5 hours'
         AND cv.last_inbound_at >  now() - interval '10 hours')
    )
  LIMIT 200;
$$;

-- ── 3) mark — increment the same-day touch counter (mark-then-send, §215 P1) ──
CREATE OR REPLACE FUNCTION public.quote_nudge_mark(p_conversation_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE public.whatsapp_conversations
  SET quote_nudge_count = COALESCE(quote_nudge_count,0) + 1, quote_nudge_at = now()
  WHERE id = p_conversation_id AND COALESCE(quote_nudge_count,0) < 2;
$$;

REVOKE ALL ON FUNCTION public.quote_nudge_candidates()   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.quote_nudge_mark(uuid)     FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quote_nudge_candidates() TO service_role;
GRANT EXECUTE ON FUNCTION public.quote_nudge_mark(uuid)   TO service_role;

-- ── 4) dispatch — pg_net POST to the Edge endpoint. The x-ai-secret is PULLED from
--       the live wa_ai_reply_dispatch (§213/§246) so NO literal secret is handled. ──
DO $do$
DECLARE v_def text; v_secret text;
BEGIN
  v_def := pg_get_functiondef('public.wa_ai_reply_dispatch'::regproc);
  v_secret := substring(v_def from $re$x-ai-secret'[^']*'([^']+)'$re$);
  IF v_secret IS NULL OR v_secret = '' THEN
    RAISE EXCEPTION 'could not read AI_REPLY_SECRET from wa_ai_reply_dispatch';
  END IF;
  EXECUTE format($fn$
    CREATE OR REPLACE FUNCTION public.quote_nudge_dispatch()
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = public, extensions, pg_temp AS $body$
    BEGIN
      PERFORM net.http_post(
        url     := 'https://app.untitledad.in/api/wa/quote-nudge',
        headers := jsonb_build_object('Content-Type','application/json','x-ai-secret', %L),
        body    := '{}'::jsonb);
    EXCEPTION WHEN OTHERS THEN NULL;
    END; $body$;
  $fn$, v_secret);
  EXECUTE 'REVOKE ALL ON FUNCTION public.quote_nudge_dispatch() FROM PUBLIC, anon, authenticated';
END $do$;

-- ── 5) cron — hourly at :07; the endpoint re-gates IST business hours + skips Sunday. ──
SELECT cron.schedule('quote-nudge', '7 * * * *', $$SELECT public.quote_nudge_dispatch();$$);

NOTIFY pgrst, 'reload schema';

-- ── VERIFY — expect flag_col 1 · mark_col 1 · cand_fn t · dispatch_fn t · cron_job 1 · enabled_accts 0 ──
-- SELECT
--   (SELECT count(*) FROM information_schema.columns WHERE table_name='whatsapp_accounts' AND column_name='ai_nudge_enabled')=1 AS flag_col,
--   (SELECT count(*) FROM information_schema.columns WHERE table_name='whatsapp_conversations' AND column_name='quote_nudge_at')=1 AS mark_col,
--   to_regprocedure('public.quote_nudge_candidates()') IS NOT NULL AS cand_fn,
--   to_regprocedure('public.quote_nudge_dispatch()')   IS NOT NULL AS dispatch_fn,
--   (SELECT count(*) FROM cron.job WHERE jobname='quote-nudge') AS cron_job,
--   (SELECT count(*) FROM public.whatsapp_accounts WHERE ai_nudge_enabled) AS enabled_accts;
