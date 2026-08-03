-- =====================================================================
-- Move all hoarding-board QRs OFF the spam-flagged marketing number so it can
-- recover.  (2026-08-03, companion to CLAUDE.md §148 / Phase 275)
--
-- The marketing number 98982 73686 (919898273686, WABA 2870129030006085) is at
-- Quality = LOW with a live "sending spam" flag. §119 (20 Jul) pointed all 22
-- boards at it → ~210 cold scans/day → the block/report rate that flagged it.
-- To let it go QUIET + recover, move the boards back to the aged SERVICE number
-- 95815 78261 (919581578261, WABA 122098901360016777, High-quality, clean
-- history) — which now also has the Phase 275 soft first-contact behavior.
--
-- NO REPRINTING: a printed board QR encodes /api/q/<code>; campaign_locations
-- .qr_text is only the redirect target. Changing it re-routes the SAME physical
-- QR. Both numbers route inbound to the same telecaller (Rima, §54/§119), so
-- operationally identical. Boards only (client_name IS NULL); the 2 Client QRs
-- are untouched. Idempotent (replace).
--
-- Rebalance AFTER the marketing number's Quality climbs back to High (~2 weeks):
-- move a subset back with the reverse replace if wanted.
-- =====================================================================

UPDATE public.campaign_locations
   SET qr_text = replace(qr_text, '919898273686', '919581578261')
 WHERE client_name IS NULL
   AND qr_text LIKE '%919898273686%';

-- ─── VERIFY ──────────────────────────────────────────────────────────
-- Expect: on_service ≈ 22, on_marketing = 0.
SELECT
  count(*) FILTER (WHERE qr_text LIKE '%919581578261%') AS on_service,
  count(*) FILTER (WHERE qr_text LIKE '%919898273686%') AS on_marketing
FROM public.campaign_locations
WHERE client_name IS NULL;
