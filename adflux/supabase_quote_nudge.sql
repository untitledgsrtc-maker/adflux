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

-- ── 1) flag (OFF) + one-nudge marker ────────────────────────────────────────
ALTER TABLE public.whatsapp_accounts      ADD COLUMN IF NOT EXISTS ai_nudge_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.whatsapp_conversations ADD COLUMN IF NOT EXISTS quote_nudge_at   timestamptz;

COMMENT ON COLUMN public.whatsapp_accounts.ai_nudge_enabled IS
  'Same-day open-window quote nudge on/off (supabase_quote_nudge.sql). Default false.';

-- ── 2) candidates ───────────────────────────────────────────────────────────
-- A conversation whose lead got an AI quote 2–4h ago, is still silent, window open,
-- not rep-paused, not opted-out/DNC, not already nudged, on a nudge-enabled account.
CREATE OR REPLACE FUNCTION public.quote_nudge_candidates()
RETURNS TABLE (conversation_id uuid, customer_wa_id text, phone_number_id text, lead_name text)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT cv.id, cv.customer_wa_id, a.phone_number_id, COALESCE(l.name, '')
  FROM public.whatsapp_conversations cv
  JOIN public.whatsapp_accounts a ON a.id = cv.whatsapp_account_id
  JOIN public.leads l             ON l.id = cv.lead_id
  JOIN LATERAL (
    SELECT q.created_at
    FROM public.quotes q
    WHERE q.lead_id = cv.lead_id AND q.source = 'ai_quote'
    ORDER BY q.created_at DESC
    LIMIT 1
  ) q ON true
  WHERE a.ai_nudge_enabled = true
    AND a.phone_number_id IS NOT NULL
    AND cv.customer_wa_id ~ '^[0-9]{10,15}$'
    AND cv.quote_nudge_at IS NULL                                   -- one nudge, ever
    AND COALESCE(cv.ai_paused, false) = false                       -- a rep hasn't taken over
    AND cv.window_expires_at > now()                                -- 24h service window still OPEN (free text)
    AND q.created_at <= now() - interval '2 hours'                  -- quote at least 2h old
    AND q.created_at >  now() - interval '4 hours'                  -- but no older than 4h (same-day)
    AND (cv.last_inbound_at IS NULL OR cv.last_inbound_at <= q.created_at)  -- SILENT since the quote
    AND COALESCE(l.wa_opt_out, false) = false
    AND COALESCE(l.do_not_call, false) = false
  LIMIT 200;
$$;

-- ── 3) mark (idempotent — one nudge per conversation) ───────────────────────
CREATE OR REPLACE FUNCTION public.quote_nudge_mark(p_conversation_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE public.whatsapp_conversations SET quote_nudge_at = now()
  WHERE id = p_conversation_id AND quote_nudge_at IS NULL;
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
