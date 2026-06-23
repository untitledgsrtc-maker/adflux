-- supabase_phase168_qr_lead_location_backfill.sql
-- Phase 168 (2026-06-17) — QR "Leads" count shows 0 though leads ARE created.
--
-- ROOT (a multi-file CREATE-OR-REPLACE collision, the §33 mole pattern):
-- `campaign_conversation_ensure_lead()` is replaced by c45 → c8 → c8.1.
--   • C8  added `location_id` to the lead INSERT (stamps WHICH board pulled
--     the lead) so the QR & Locations page can roll leads up per board.
--   • C8.1 rewrote the function to route a board's lead to its telecaller —
--     and DROPPED `location_id` from the INSERT column list (c8_1:98-108 end
--     at `campaign_id`, no location_id). C8.1 is the live version, so every new
--     QR lead is created with location_id = NULL → the per-board Leads count
--     reads 0 even though the lead exists and routed fine. (SCANNED & MESSAGED
--     still work — they read whatsapp_conversations.location_id, which the
--     webhook stamps independently.)
--
-- FIX — the function below is C8.1 BYTE-FOR-BYTE (board→telecaller routing,
-- all 4 P0 contracts, the double EXCEPTION wrap) with the ONE regression
-- restored: `location_id` is back in the lead INSERT column list + VALUES
-- (NEW.location_id). New QR leads carry the board again. Plus a one-time
-- backfill for leads already created without it.
--
-- ⚠ LOCKSTEP (do NOT regress again): any future CREATE OR REPLACE of
-- `campaign_conversation_ensure_lead` MUST keep BOTH (a) the board→telecaller
-- routing (v_owner from campaign_locations.default_telecaller_id first) AND
-- (b) `location_id` in the lead INSERT. The canonical is now THIS file.
--
-- §45-safe: campaign trigger on the NEW whatsapp_conversations table only;
-- no existing rep/lead flow, no hot path. Idempotent (CREATE OR REPLACE +
-- the backfill only fills NULLs).

-- ── 1. C4.5 = C8.1 routing + the restored location_id stamp ─────────────
-- -------------------------------------------------------------------------
-- campaign_conversation_ensure_lead REMOVED from this file (Phase 178).
-- Canonical: db/functions/campaign_conversation_ensure_lead.sql
-- Do NOT re-add it here. Edit the canonical file only (§71). Trigger wiring
-- (trg_campaign_conv_ensure_lead) stays in c45 / c8_location.
-- -------------------------------------------------------------------------

-- ── 2. Backfill leads already created without the board ─────────────────
UPDATE public.leads l
   SET location_id = c.location_id
  FROM public.whatsapp_conversations c
 WHERE c.lead_id = l.id
   AND c.location_id IS NOT NULL
   AND l.location_id IS NULL;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- VERIFY
-- =====================================================================
-- V1: the live function now stamps location_id (expect t).
SELECT pg_get_functiondef('public.campaign_conversation_ensure_lead()'::regprocedure)
       ILIKE '%campaign_id, location_id%'  AS c45_stamps_location;

-- V2: leads now tagged to a board (was 0).
SELECT count(*) AS leads_with_board FROM public.leads WHERE location_id IS NOT NULL;

-- V3: per-board lead count (what the QR page reads). Non-zero for live boards.
SELECT cl.label AS board, cl.code, count(l.id) AS leads
  FROM public.campaign_locations cl
  LEFT JOIN public.leads l ON l.location_id = cl.id
 GROUP BY cl.id, cl.label, cl.code
 ORDER BY leads DESC NULLS LAST
 LIMIT 20;

SELECT 'Phase 168 QR lead→board (location_id) restore + backfill applied' AS status;
