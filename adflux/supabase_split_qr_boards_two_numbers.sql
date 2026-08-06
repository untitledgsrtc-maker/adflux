-- =====================================================================
-- Split the QR boards across BOTH WhatsApp numbers (spam-flag recovery, §148)
-- 2026-08-06
--
-- §119 pointed ALL 22 hoarding-board QRs at the MARKETING number 919898273686.
-- That number got spam-flagged (§148) because every cold board-scan gets an instant
-- AI reply on a young number → some report it. This halves the cold-scan load:
-- ~half the boards move to the AGED, clean SERVICE number 919581578261 (both are
-- AI-answered + route inbound to Rima, §119 — no routing breaks).
--
-- NO REPRINTING: printed QRs encode /api/q/<code>; qr_text is only the redirect
-- target (§119/§232). Changing qr_text re-points the physical QR with no reprint.
--
-- Scope: client_name IS NULL = BOARDS only (never the 2 client QRs). Only rows whose
-- qr_text routes to one of the two numbers.
--
-- IDEMPOTENT: the split is keyed on the board's STABLE id order (rn parity), and each
-- board is SET to its target number regardless of its current value — so re-running
-- lands the exact same 50/50 (no drift). Even rn → service, odd rn → marketing.
-- =====================================================================

WITH boards AS (
  SELECT id, row_number() OVER (ORDER BY id) AS rn
    FROM public.campaign_locations
   WHERE client_name IS NULL
     AND (qr_text LIKE '%919898273686%' OR qr_text LIKE '%919581578261%')
)
UPDATE public.campaign_locations c
   SET qr_text = regexp_replace(
                   c.qr_text,
                   '919898273686|919581578261',
                   CASE WHEN b.rn % 2 = 0 THEN '919581578261'   -- service (aged, clean)
                                          ELSE '919898273686'   -- marketing (flagged, healing)
                   END,
                   'g')
  FROM boards b
 WHERE c.id = b.id;

-- ==== VERIFY =========================================================
-- Expect a ~50/50 split of the boards across the two numbers.
SELECT
  count(*) FILTER (WHERE qr_text LIKE '%919581578261%') AS on_service_95815,
  count(*) FILTER (WHERE qr_text LIKE '%919898273686%') AS on_marketing_98982,
  count(*)                                              AS total_boards
FROM public.campaign_locations
WHERE client_name IS NULL
  AND (qr_text LIKE '%919581578261%' OR qr_text LIKE '%919898273686%');
