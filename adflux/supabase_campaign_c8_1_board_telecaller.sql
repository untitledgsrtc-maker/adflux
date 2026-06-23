-- =====================================================================
-- Campaign C8.1 — board → telecaller DIRECT routing (match the QR mockup)
-- 2026-06-09
--
-- The "New board QR" mockup routes "Leads from this board route to → <TC>"
-- straight to a telecaller. Add campaign_locations.default_telecaller_id and
-- make C4.5 route a board's inbound lead by the BOARD's telecaller FIRST (most
-- specific), then the campaign, then the receiving account. Existing
-- campaign-routed boards are unaffected — the campaign fallback stays.
--
-- SAFE (§45): additive nullable column on a NEW campaign table. The C4.5
-- reproduction below changes ONLY the routing lookup ORDER (P0-2): a new
-- board-first lookup is added before the existing campaign + account lookups.
-- All 4 P0 contracts + the double-EXCEPTION conversation-store safety are
-- byte-preserved. Writes leads → guardian-audited.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE FUNCTION. The
-- trigger trg_campaign_conv_ensure_lead is unchanged (keeps pointing here).
-- =====================================================================

ALTER TABLE public.campaign_locations
  ADD COLUMN IF NOT EXISTS default_telecaller_id uuid REFERENCES public.users(id) ON DELETE SET NULL;

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
     WHERE table_schema = 'public' AND table_name = 'campaign_locations'
       AND column_name = 'default_telecaller_id')                                         AS column_present,  -- 1
  (SELECT position('campaign_locations WHERE id = NEW.location_id' in pg_get_functiondef(oid)) > 0
     FROM pg_proc WHERE proname = 'campaign_conversation_ensure_lead' LIMIT 1)             AS routes_by_board, -- t
  (SELECT prosecdef FROM pg_proc WHERE proname = 'campaign_conversation_ensure_lead' LIMIT 1) AS is_security_definer; -- t

SELECT 'Campaign C8.1 board→telecaller routing applied' AS status;
