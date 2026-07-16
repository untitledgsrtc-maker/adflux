-- supabase_phase246_ai_agent.sql
--
-- Phase 246 — AI auto-responder for the WhatsApp inbox (owner request 16 Jul).
-- When a customer messages 95815 78261, an AI agent replies on its own with
-- our real GSRTC LED context (screens/stations/rates/moat + the landing page),
-- answers questions, and keeps the lead warm — then hands off to the assigned
-- telecaller. It does NOT book or quote a final price (that stays human).
--
-- ═══ §45 / §46 SAFETY — this is FULLY ADDITIVE and OFF BY DEFAULT ═══
-- • Nothing in the live flow changes until `whatsapp_accounts.ai_enabled` is set
--   TRUE for an account. Default false → the dispatch trigger no-ops.
-- • The WEBHOOK IS UNTOUCHED. The AI is dispatched ASYNC via pg_net from an
--   AFTER-INSERT trigger on whatsapp_messages (inbound only) → zero added
--   latency to the webhook 200 (§46). Same pg_net pattern as §34Z.69 / §55.
-- • The trigger is on the CAMPAIGN whatsapp_messages table (NOT leads / not a
--   rep hot path). For the default (ai_enabled=false) it's one cheap flag read
--   then RETURN — no HTTP, no work.
-- • Turning AI ON = set ai_enabled=true AND turn the OLD bot OFF (bot_enabled
--   =false, auto_reply_enabled=false) so there's no double reply. AI and the
--   flat/flow bot are mutually-exclusive by the owner's config, not by code.
-- • Human takeover: a manual inbox reply (api/wa/send.js) sets ai_paused=true →
--   the AI goes silent on that thread until it's cleared.

-- ── flags ──
ALTER TABLE public.whatsapp_accounts      ADD COLUMN IF NOT EXISTS ai_enabled       boolean DEFAULT false;
ALTER TABLE public.whatsapp_accounts      ADD COLUMN IF NOT EXISTS ai_system_prompt  text;    -- optional override; the endpoint has a strong default
ALTER TABLE public.whatsapp_conversations ADD COLUMN IF NOT EXISTS ai_paused         boolean DEFAULT false;

COMMENT ON COLUMN public.whatsapp_accounts.ai_enabled IS
  'AI auto-responder on for this number. OFF by default. Turn the flat/flow bot off when you turn this on.';
COMMENT ON COLUMN public.whatsapp_conversations.ai_paused IS
  'Set true when a human takes over the thread (manual reply) — the AI stays silent until cleared.';

-- ── async dispatch trigger (inbound → fire the AI endpoint via pg_net) ──
-- ⚠️ FILL IN <AI_REPLY_SECRET>: pick a long random string, put it here AND in
--    the Vercel env AI_REPLY_SECRET (they must match). Do NOT commit the real
--    value — this file ships with the placeholder (same pattern as §110).
CREATE OR REPLACE FUNCTION public.wa_ai_reply_dispatch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ai_enabled boolean;
  v_paused     boolean;
BEGIN
  IF NEW.direction <> 'in' THEN RETURN NEW; END IF;
  BEGIN
    SELECT a.ai_enabled, COALESCE(c.ai_paused, false)
      INTO v_ai_enabled, v_paused
      FROM public.whatsapp_conversations c
      JOIN public.whatsapp_accounts a ON a.id = c.whatsapp_account_id
     WHERE c.id = NEW.conversation_id;

    IF COALESCE(v_ai_enabled, false) AND NOT v_paused THEN
      PERFORM net.http_post(
        url     := 'https://app.untitledad.in/api/wa/ai-reply',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-ai-secret', '<AI_REPLY_SECRET>'),
        body    := jsonb_build_object('conversation_id', NEW.conversation_id, 'message_id', NEW.id),
        timeout_milliseconds := 4000
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Never let AI dispatch break the inbound message store (§45/§46).
    RAISE WARNING 'wa_ai_reply_dispatch failed for message %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wa_ai_reply ON public.whatsapp_messages;
CREATE TRIGGER trg_wa_ai_reply
  AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW
  WHEN (NEW.direction = 'in')
  EXECUTE FUNCTION public.wa_ai_reply_dispatch();

NOTIFY pgrst, 'reload schema';

-- VERIFY:
--   -- columns present
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'whatsapp_accounts' AND column_name IN ('ai_enabled','ai_system_prompt');   -- 2 rows
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'whatsapp_conversations' AND column_name = 'ai_paused';                       -- 1 row
--   -- trigger present
--   SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_wa_ai_reply';                                 -- 1
--   -- everything still OFF (no account opted in yet)
--   SELECT count(*) FROM public.whatsapp_accounts WHERE ai_enabled;                                   -- 0
--
-- TO TURN ON (after the Edge fn is deployed + envs set + you've tested):
--   UPDATE public.whatsapp_accounts
--      SET ai_enabled = true, bot_enabled = false, auto_reply_enabled = false
--    WHERE display_number LIKE '%578261%';
