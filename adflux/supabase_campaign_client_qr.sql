-- =====================================================================
-- Campaign — Client QR support
-- 2026-06-07
--
-- WHAT
--   A "client QR" is a tracked QR the owner makes FOR a client (e.g. the
--   client wants a QR in their video that opens WhatsApp to THEIR number).
--   It reuses the same /api/q/<CODE> redirect + qr_scans tracker, but it is
--   NOT one of the owner's lead-gen boards: it points at the client's own
--   number, has no campaign + no routing, and never becomes the owner's lead
--   (the chat lands in the client's WhatsApp, not the owner's webhook).
--
--   This adds ONE nullable column to distinguish them: a row with
--   `client_name` SET is a client QR; NULL = an own board. The QR pages
--   filter on it (boards tab: client_name IS NULL; client tab: NOT NULL).
--
-- SAFETY (CLAUDE.md §45)
--   • Additive nullable column, read only by the campaign QR pages. No
--     existing flow/trigger/RLS touched. The C8 ensure-lead trigger is on
--     whatsapp_conversations (not campaign_locations) and is unaffected.
--   • Idempotent (ADD COLUMN IF NOT EXISTS).
-- =====================================================================

ALTER TABLE public.campaign_locations
  ADD COLUMN IF NOT EXISTS client_name text;

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────────
SELECT count(*) AS client_name_col
FROM information_schema.columns
WHERE table_name = 'campaign_locations' AND column_name = 'client_name';   -- → 1

SELECT 'Campaign client_name column applied' AS status;
