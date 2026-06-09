-- =====================================================================
-- Campaign — Chatbot (keyword auto-responder, hands off to a human)
-- 2026-06-09
--
-- A simple, reliable bot: when ON, an inbound message is matched against
-- keyword rules and the matching reply is sent (free-form, inside the 24h
-- window). It PAUSES the moment a human (telecaller) replies in that chat — so
-- the customer never gets bot + human double-messages. The welcome on the very
-- first message is the C7 auto-reply; this bot answers the follow-on questions.
--
-- SAFE (§45): additive columns on the campaign whatsapp_accounts / _messages
-- tables + one NEW rules table. The webhook reads these tolerantly (select '*')
-- so nothing fires until the SQL is run + the bot is switched on. Admin-only.
-- =====================================================================

-- on/off + optional fallback (account-level)
ALTER TABLE public.whatsapp_accounts ADD COLUMN IF NOT EXISTS bot_enabled boolean NOT NULL DEFAULT false;

-- mark a message as bot-sent, so "has a human replied?" = any outbound where
-- via_bot is NOT true. (The manual reply via /api/wa/send leaves this null.)
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS via_bot boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.campaign_bot_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keywords      text[] NOT NULL DEFAULT '{}',   -- match if the message contains ANY of these (case-insensitive)
  reply         text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  created_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.campaign_bot_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bot_rules_admin_all ON public.campaign_bot_rules;
CREATE POLICY bot_rules_admin_all ON public.campaign_bot_rules
  FOR ALL USING (public.get_my_role() IN ('admin', 'co_owner'))
  WITH CHECK (public.get_my_role() IN ('admin', 'co_owner'));

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema='public' AND table_name='whatsapp_accounts' AND column_name='bot_enabled')  AS bot_switch,   -- 1
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema='public' AND table_name='whatsapp_messages' AND column_name='via_bot')       AS via_bot_col,  -- 1
  (SELECT count(*) FROM information_schema.tables
     WHERE table_schema='public' AND table_name='campaign_bot_rules')                                AS rules_table;  -- 1

SELECT 'Campaign chatbot tables applied' AS status;
