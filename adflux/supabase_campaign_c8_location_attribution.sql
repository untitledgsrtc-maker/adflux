-- =====================================================================
-- Campaign C8 — QR board (location) attribution
-- 2026-06-07
--
-- WHAT
--   A QR board encodes  "Hi, saw your screen at <place> [RR-AHM-01]"  in
--   the wa.me text (CampaignQrV2). When the customer sends, the webhook
--   reads the [CODE], matches campaign_locations, and stamps the
--   conversation with campaign_id + location_id (in api/wa/webhook.js,
--   C8 part). This file:
--     1. adds the nullable location_id columns (additive — no existing
--        code reads them, frozen pages SELECT * but ignore it).
--     2. SUPERSEDES the C4.5 campaign_conversation_ensure_lead() function
--        so the created lead also carries location_id (the board) — the
--        dashboard then rolls up messaged → lead → won PER BOARD.
--
--   v1 attribution = "messaged" only (a message carrying [CODE] arrives) —
--   raw scan counts are owner-locked OUT (spec §7).
--
-- SAFETY (CLAUDE.md §45)
--   • leads.location_id + whatsapp_conversations.location_id are NULLABLE,
--     ON DELETE SET NULL, read by no existing flow. Pure additive columns.
--   • The function is byte-identical to C4.5 EXCEPT one extra column in the
--     leads INSERT (location_id = NEW.location_id). All 4 P0 contracts,
--     the double EXCEPTION wrap, cadence_paused, the round-robin BOTH-owner
--     fix, and the NEW-table trigger are preserved unchanged.
--   • SUPERSEDED (Phase 178): the canonical function body now lives in
--     db/functions/campaign_conversation_ensure_lead.sql. This file keeps only
--     its ALTER TABLE columns + the CREATE TRIGGER wiring.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE + DROP TRIGGER
-- IF EXISTS).
-- =====================================================================

-- ─── 1. Additive location columns ───────────────────────────────────
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS location_id uuid
  REFERENCES public.campaign_locations(id) ON DELETE SET NULL;

ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS location_id uuid
  REFERENCES public.campaign_locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_location_id ON public.leads (location_id);

-- ─── 2. C4.5 function + location_id (CANONICAL) ─────────────────────
-- -------------------------------------------------------------------------
-- campaign_conversation_ensure_lead REMOVED from this file (Phase 178).
-- Canonical: db/functions/campaign_conversation_ensure_lead.sql
-- Do NOT re-add it here. Edit the canonical file only (§71). Trigger wiring
-- (trg_campaign_conv_ensure_lead) stays in c45 / c8_location.
-- -------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_campaign_conv_ensure_lead ON public.whatsapp_conversations;
CREATE TRIGGER trg_campaign_conv_ensure_lead
  AFTER INSERT ON public.whatsapp_conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.campaign_conversation_ensure_lead();

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name='leads' AND column_name='location_id')                         AS leads_location_col,   -- → 1
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name='whatsapp_conversations' AND column_name='location_id')         AS conv_location_col,    -- → 1
  (SELECT count(*) FROM pg_trigger WHERE tgname='trg_campaign_conv_ensure_lead')     AS trigger_present;      -- → 1

SELECT 'Campaign C8 location attribution applied' AS status;
