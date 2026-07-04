-- ============================================================================
-- Phase 204 — chatbot tap-buttons (WhatsApp interactive) — mockup phase 1
-- ============================================================================
-- The greeting becomes a WhatsApp interactive message with buttons the customer
-- TAPS (Rates / Site photos / Get a quote / Talk to a person) instead of typing
-- a keyword. Each button carries an action: send a reply (text + optional media)
-- or hand off to a telecaller. WhatsApp allows 3 reply-buttons; 4-10 options are
-- sent as a list message (the webhook picks the right format).
--
-- One row per button, ordered by position, attached to the account's greeting.
-- Additive + idempotent (§8). Text/keyword replies (Phase 203) still work when
-- there are no buttons. §45-safe.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.campaign_bot_buttons (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  whatsapp_account_id uuid REFERENCES public.whatsapp_accounts(id) ON DELETE CASCADE,
  label               text NOT NULL,                 -- the button text (≤20 chars ideal)
  position            int  NOT NULL DEFAULT 0,
  action              text NOT NULL DEFAULT 'send',   -- 'send' | 'handoff'
  reply_text          text,                            -- reply body when action='send'
  media_url           text,                            -- optional image/video/PDF on the reply
  media_type          text,                            -- image | video | document
  is_active           boolean NOT NULL DEFAULT true,
  created_by          uuid REFERENCES public.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bot_buttons_account
  ON public.campaign_bot_buttons (whatsapp_account_id, position);

ALTER TABLE public.campaign_bot_buttons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bot_buttons_admin_all ON public.campaign_bot_buttons;
CREATE POLICY bot_buttons_admin_all ON public.campaign_bot_buttons
  FOR ALL
  USING (public.get_my_role() IN ('admin', 'co_owner'))
  WITH CHECK (public.get_my_role() IN ('admin', 'co_owner'));

NOTIFY pgrst, 'reload schema';

-- VERIFY:
-- SELECT to_regclass('public.campaign_bot_buttons') IS NOT NULL AS table_present;   -- t
-- SELECT count(*) FROM pg_policies WHERE tablename='campaign_bot_buttons';          -- 1
