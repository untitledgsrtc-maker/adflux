-- =====================================================================
-- Phase 264 — Meta Click-to-WhatsApp ad attribution (2026-07-28)
--
-- A Click-to-WhatsApp ad on Instagram/Facebook sends the person into
-- WhatsApp; Meta stamps their FIRST message with a `referral` (the ad's
-- headline + platform). api/wa/webhook.js reads it, finds the active
-- Meta campaign (campaigns.source_type='meta', e.g. "Social media") and
-- stamps the conversation with that campaign_id → the EXISTING C4.5
-- routing (campaign_conversation_ensure_lead) then auto-routes the lead
-- to the campaign's telecaller (Dhara), attributes it to the campaign,
-- and tags source 'Social Media' (Phase 264 C4.5 change). LED/QR/organic
-- chats have no referral → untouched.
--
-- This adds the ONE new column the webhook needs: ad_headline, so the AI
-- can open relevant to the ad the person actually clicked (the ad is
-- sometimes LED, sometimes a different offer — the AI reads the headline
-- and hands a non-LED offer to the team instead of pitching LED).
--
-- whatsapp_conversations.campaign_id already exists (C4.5 uses it).
-- Additive, nullable, idempotent — no existing code reads ad_headline;
-- §45-safe. The webhook write is deploy-order tolerant (retries without
-- ad_headline if the column is missing), so a push-before-SQL only means
-- the headline isn't stored until this runs — never a broken store.
-- =====================================================================

ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS ad_headline text;

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='whatsapp_conversations'
      AND column_name='ad_headline')  AS ad_headline_present,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='whatsapp_conversations'
      AND column_name='campaign_id')  AS campaign_id_present,
  (SELECT count(*) FROM public.campaigns
    WHERE source_type='meta' AND is_active) AS active_meta_campaigns;
