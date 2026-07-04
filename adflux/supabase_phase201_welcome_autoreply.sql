-- ============================================================================
-- Phase 201 — WhatsApp welcome auto-reply (free, service-window reply)
-- ============================================================================
-- Owner directive (4 Jul 2026): don't broadcast (paid marketing templates).
-- Instead, when a customer messages the WhatsApp number FIRST, auto-reply them
-- with a welcome — that's a service message, free inside the 24h window.
--
-- The webhook (api/wa/webhook.js line ~306) already sends acct.auto_reply_text
-- on a new conversation's first inbound WHEN acct.auto_reply_enabled is true —
-- but those two columns were never created + had no UI toggle. This adds them;
-- Phase 201 wires the Chatbot page's Greeting node to edit + switch them.
--
-- Additive + idempotent (§8). Separate from the keyword chatbot (bot_enabled +
-- campaign_bot_rules, supabase_campaign_chatbot.sql). §45-safe.
-- ============================================================================

ALTER TABLE public.whatsapp_accounts
  ADD COLUMN IF NOT EXISTS auto_reply_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_reply_text    text;

NOTIFY pgrst, 'reload schema';

-- VERIFY:
-- SELECT column_name FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='whatsapp_accounts'
--     AND column_name IN ('auto_reply_enabled','auto_reply_text');       -- 2 rows
