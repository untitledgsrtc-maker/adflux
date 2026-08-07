-- ============================================================================
-- Phase 285 BACKFILL — re-label EXISTING WhatsApp leads by channel (2026-08-06)
-- ============================================================================
-- The Phase 285 trigger (db/functions/campaign_conversation_ensure_lead.sql)
-- labels NEW leads by channel (QR Board / Meta Ad / Social Media / WhatsApp).
-- This one-time backfill applies the SAME logic to leads that were created
-- BEFORE Phase 285 and are still generically tagged 'WhatsApp' / 'Social Media'.
--
-- SAFE BY DESIGN:
--   • Only touches leads whose CURRENT source IN ('WhatsApp','Social Media') —
--     the ONLY values C4.5 ever set. A lead sourced 'Field Meeting', 'Cronberry',
--     'Justdial', 'Referral', manual, etc. is NEVER re-labelled (real origin kept),
--     even if a WhatsApp chat later attached to it.
--   • Uses the EARLIEST linked whatsapp_conversation (the one that created the lead)
--     and the EXACT same order as the live trigger (location_id → meta campaign →
--     ad_headline → WhatsApp), so it re-creates what Phase 285 WOULD have set.
--   • Idempotent: `source IS DISTINCT FROM new` → only rows that actually change are
--     written; re-running does nothing.
--   • Display-label only — does NOT touch owner/routing/stage/cadence/anything else.
--
-- To DRY-RUN first, run ONLY the "PREVIEW" SELECT below (it changes nothing).
-- Then run the UPDATE. The VERIFY at the bottom shows the resulting distribution.
-- ============================================================================

-- ---- PREVIEW (optional, run first — read-only, shows what WOULD change) -----
-- WITH conv AS (
--   SELECT DISTINCT ON (c.lead_id)
--          c.lead_id, c.location_id, c.ad_headline, cmp.source_type AS camp_src_type
--     FROM public.whatsapp_conversations c
--     LEFT JOIN public.campaigns cmp ON cmp.id = c.campaign_id
--    WHERE c.lead_id IS NOT NULL
--    ORDER BY c.lead_id, c.created_at ASC
-- )
-- SELECT
--   CASE
--     WHEN conv.location_id IS NOT NULL THEN 'QR Board'
--     WHEN conv.camp_src_type = 'meta'  THEN 'Social Media'
--     WHEN conv.ad_headline IS NOT NULL THEN 'Meta Ad'
--     ELSE 'WhatsApp'
--   END AS new_source,
--   count(*) AS leads_that_change
-- FROM conv
-- JOIN public.leads l ON l.id = conv.lead_id
-- WHERE l.source IN ('WhatsApp','Social Media')
--   AND l.source IS DISTINCT FROM CASE
--     WHEN conv.location_id IS NOT NULL THEN 'QR Board'
--     WHEN conv.camp_src_type = 'meta'  THEN 'Social Media'
--     WHEN conv.ad_headline IS NOT NULL THEN 'Meta Ad'
--     ELSE 'WhatsApp' END
-- GROUP BY 1 ORDER BY 1;

-- ---- THE BACKFILL ----------------------------------------------------------
WITH conv AS (
  SELECT DISTINCT ON (c.lead_id)
         c.lead_id,
         c.location_id,
         c.ad_headline,
         cmp.source_type AS camp_src_type
    FROM public.whatsapp_conversations c
    LEFT JOIN public.campaigns cmp ON cmp.id = c.campaign_id
   WHERE c.lead_id IS NOT NULL
   ORDER BY c.lead_id, c.created_at ASC           -- earliest conversation per lead
),
newsrc AS (
  SELECT conv.lead_id,
         CASE
           WHEN conv.location_id IS NOT NULL THEN 'QR Board'
           WHEN conv.camp_src_type = 'meta'  THEN 'Social Media'
           WHEN conv.ad_headline IS NOT NULL THEN 'Meta Ad'
           ELSE 'WhatsApp'
         END AS src
    FROM conv
)
UPDATE public.leads l
   SET source = newsrc.src
  FROM newsrc
 WHERE l.id = newsrc.lead_id
   AND l.source IN ('WhatsApp','Social Media')     -- only C4.5-set sources
   AND l.source IS DISTINCT FROM newsrc.src;        -- only actual changes

-- ---- VERIFY (post-backfill distribution among WhatsApp-conversation leads) --
SELECT l.source, count(*) AS leads
  FROM public.leads l
 WHERE EXISTS (SELECT 1 FROM public.whatsapp_conversations c WHERE c.lead_id = l.id)
 GROUP BY l.source
 ORDER BY leads DESC;
