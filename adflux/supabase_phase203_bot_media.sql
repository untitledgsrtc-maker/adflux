-- ============================================================================
-- Phase 203 — media in bot replies (welcome + keyword) + {{name}} personalize
-- ============================================================================
-- Owner: (1) the welcome's {{1}} should become the person's name, (2) a bot
-- reply should be able to carry an image/video/PDF, not just text.
--   • {{1}} / {{name}} substitution — code-only (webhook personalize()).
--   • Media — a bot reply is a free-form SERVICE message, so it can send an
--     image/video/document by link (no template/approval). These columns hold
--     the media the webhook attaches:
--       whatsapp_accounts.auto_reply_media_url / _type  → the welcome reply
--       campaign_bot_rules.media_url / media_type       → a keyword reply
--     media_type ∈ image | video | document (NULL = text only).
-- Media files go in the existing campaign-media bucket (Phase 199).
-- Additive + idempotent (§8). §45-safe.
-- ============================================================================

ALTER TABLE public.whatsapp_accounts
  ADD COLUMN IF NOT EXISTS auto_reply_media_url  text,
  ADD COLUMN IF NOT EXISTS auto_reply_media_type text;

ALTER TABLE public.campaign_bot_rules
  ADD COLUMN IF NOT EXISTS media_url  text,
  ADD COLUMN IF NOT EXISTS media_type text;

NOTIFY pgrst, 'reload schema';

-- VERIFY:
-- SELECT table_name, column_name FROM information_schema.columns
--   WHERE table_schema='public'
--     AND (table_name='whatsapp_accounts'  AND column_name LIKE 'auto_reply_media%')
--      OR (table_name='campaign_bot_rules' AND column_name LIKE 'media_%');    -- 4 rows
