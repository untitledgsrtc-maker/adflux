-- =====================================================================
-- Campaign C11 — a new WhatsApp lead carries the customer's PROFILE NAME
-- 2026-06-09
--
-- A WhatsApp inbound webhook includes the sender's profile name
-- (value.contacts[].profile.name). We weren't capturing it, so C4.5 created
-- the lead as the generic 'WhatsApp lead'. Now: the webhook stores the name on
-- whatsapp_conversations.customer_name, and C4.5 uses it for the lead's name
-- (falling back to 'WhatsApp lead' when absent).
--
-- SAFE (§45): additive nullable column on a NEW campaign table. The C4.5
-- reproduction below is the CURRENT (C8.1 board-first) function, byte-identical
-- EXCEPT the single lead-name expression. All 4 P0 contracts + the board→
-- campaign→account routing + the double-EXCEPTION store-safety are preserved.
-- Only NEW leads get the name (P0-1 dedup never renames an existing lead).
-- Writes leads → guardian-audited.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE. Trigger unchanged.
-- =====================================================================

ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS customer_name text;

-- -------------------------------------------------------------------------
-- campaign_conversation_ensure_lead REMOVED from this file (Phase 178).
-- Canonical: db/functions/campaign_conversation_ensure_lead.sql
-- Do NOT re-add it here. Edit the canonical file only (§71). Trigger wiring
-- (trg_campaign_conv_ensure_lead) stays in c45 / c8_location.
-- -------------------------------------------------------------------------

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'whatsapp_conversations'
       AND column_name = 'customer_name')                                                 AS column_present,    -- 1
  (SELECT position('NEW.customer_name' in pg_get_functiondef(oid)) > 0
     FROM pg_proc WHERE proname = 'campaign_conversation_ensure_lead' LIMIT 1)             AS uses_name,         -- t
  (SELECT position('campaign_locations WHERE id = NEW.location_id' in pg_get_functiondef(oid)) > 0
     FROM pg_proc WHERE proname = 'campaign_conversation_ensure_lead' LIMIT 1)             AS routes_by_board;   -- t (C8.1 preserved)

SELECT 'Campaign C11 lead-name applied' AS status;
