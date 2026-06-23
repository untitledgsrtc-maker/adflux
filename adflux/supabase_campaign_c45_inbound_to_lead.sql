-- =====================================================================
-- Campaign C4.5 — inbound WhatsApp conversation → lead (P0 contracts)
-- 2026-06-07
--
-- WHAT
--   When the webhook's C4-store creates a NEW whatsapp_conversations row
--   (first inbound from a customer), auto create-or-attach a lead so the
--   chat becomes a workable lead in the EXISTING leads table — the same
--   table the Excel upload + wizards write. AFTER-INSERT trigger on the
--   NEW table whatsapp_conversations (fires exactly once per conversation:
--   the upsert's ON-CONFLICT-UPDATE branch on later messages does NOT fire
--   an INSERT trigger).
--
-- THE 4 P0 CONTRACTS (frozen — see _design_reference/CAMPAIGN_MODULE_STRUCTURE.md)
--   P0-1 DEDUP — call find_open_lead_id_by_phone() FIRST (the same fn the
--     Phase 34W dup-phone block uses). If an OPEN lead exists, LINK to it,
--     never INSERT → trg_leads_block_dup_phone can never fire. Never
--     reassign an existing lead.
--   P0-2 ROUTING — owner = campaign.default_telecaller_id ?? account
--     .default_telecaller_id. NEVER a NULL-owner lead (that dumps into the
--     live round-robin). No owner configured → queue inbound_leads 'error',
--     create NO lead. The TC queue reads telecaller_id; the live round-robin
--     (leads_auto_assign) fills assigned_to whenever it is NULL, IGNORING
--     telecaller_id. So we set BOTH telecaller_id AND assigned_to to the
--     SAME owner: telecaller_id routes the TC queue; the non-NULL assigned_to
--     is the supported "self-assign" that makes the round-robin skip (no
--     random-rep hijack, no double-owner). This deviates from the doc's
--     "set exactly one" ONLY because the live round-robin forces it.
--   P0-3 ACTIVITY — write NO lead_activities at all (so nothing can touch
--     compute_daily_score / the §33 meeting-KPI / incentive). The inbound
--     text already lives in whatsapp_messages.
--   P0-4 STAGE — 'New' only (a valid live stage).
--
-- SAFETY — the conversation store must NEVER break (CLAUDE.md §45)
--   • Whole body wrapped in BEGIN…EXCEPTION WHEN OTHERS. Any failure →
--     log an inbound_leads 'error' row + RETURN; the conversation row
--     still commits exactly as today. A race (lead appeared between the
--     find and the insert) is recovered by re-finding + attaching.
--   • cadence_paused = true → the Phase 33D.6 lead-create trigger early-
--     returns → NO follow-up / push cascade inside the webhook transaction
--     (minimal blast radius; notifications are a later step C5+).
--   • NEW table trigger only. No existing flow/file touched. The lead lands
--     via the SAME insert contract reps already see — a new row, not new
--     behavior.
--
-- Idempotent (CREATE OR REPLACE + DROP TRIGGER IF EXISTS). inbound_leads
-- (provider, external_event_id) UNIQUE makes re-fire a no-op.
-- =====================================================================

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
-- 1) trigger present. 2) function is SECURITY DEFINER + hardened search_path.
SELECT
  (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_campaign_conv_ensure_lead') AS trigger_present,   -- → 1
  (SELECT prosecdef FROM pg_proc WHERE proname = 'campaign_conversation_ensure_lead' LIMIT 1) AS is_security_definer; -- → t

-- 3) After a real inbound from a configured account/campaign, expect:
--    inbound_leads.status = 'converted' (or 'duplicate' if the phone already
--    had an open lead, or 'error' if no telecaller is configured), and the
--    conversation's lead_id set.
-- SELECT status, count(*) FROM public.inbound_leads WHERE provider='whatsapp' GROUP BY status;

SELECT 'Campaign C4.5 inbound→lead applied' AS status;
