-- =====================================================================
-- Phase 266 — map SPECIFIC Meta ads to a campaign (fix LED over-tagging)
-- 2026-07-28
--
-- Phase 264 attributed EVERY Meta Click-to-WhatsApp lead to the active
-- 'meta' campaign → tagged 'Social Media' + routed to Dhara. But the
-- owner runs LED-screen ads on Meta too (Click-to-WhatsApp). "From a
-- Meta ad" ≠ "social offer" — so LED-ad leads were being mislabeled
-- Social + sent to Dhara.
--
-- Fix: attribute a Meta lead to a campaign ONLY when the ad's Meta id is
-- listed in campaigns.meta_ad_ids. So:
--   • LED ad on Meta (not mapped)   → stays LED, normal WhatsApp pipeline.
--   • SOCIAL ad on Meta (id mapped) → Social Media + routed to Dhara.
-- Empty map (today) → NO Click-to-WhatsApp lead is Social-tagged.
--
-- The webhook (api/wa/webhook.js Phase 266) matches referral.source_id
-- (the Meta AD id) against this array. The owner pastes the social ad's
-- id here when the social-media-services ad goes live:
--   UPDATE public.campaigns SET meta_ad_ids = ARRAY['<ad_id>']
--    WHERE source_type='meta' AND name ILIKE '%social%';
--
-- Additive, nullable, idempotent. Until it's populated, the webhook's
-- ARRAY-contains match returns nothing → all Meta CTWA leads flow LED
-- (the safe default), so a push-before-SQL cannot over-tag either.
-- =====================================================================

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS meta_ad_ids text[];

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='campaigns'
      AND column_name='meta_ad_ids')  AS meta_ad_ids_present,
  (SELECT count(*) FROM public.campaigns
    WHERE source_type='meta' AND is_active
      AND meta_ad_ids IS NOT NULL AND array_length(meta_ad_ids,1) > 0) AS meta_campaigns_mapped;
