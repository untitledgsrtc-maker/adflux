-- supabase_phase126_3_campaign_selftest_cleanup.sql
-- Phase 126.3 (2026-06-08) — remove the campaign self-test data before real
-- go-live so the TC queue + inbox aren't cluttered.
--
-- READ-FIRST CONFIRMED (8 Jun, owner ran the identify queries):
--   1 SELFTEST whatsapp_account · 2 conversations · 2 messages ·
--   2 inbound_leads · 1 WhatsApp-sourced lead
--   (129679a0-cba5-4429-9bef-82cd6cbd8238, stage Lost, quotes=0 → NO real
--   work). The campaign module is NOT live (no token) → ALL WhatsApp chat
--   data is test.
--
-- NOT TOUCHED — real owner data: campaign_locations (QR boards) + qr_scans
--   (real scans) + campaigns. Only the chat data + the one confirmed-test
--   lead are removed.
--
-- No BEGIN/COMMIT wrapper (CLAUDE.md §47 clipboard-truncation foot-gun) —
-- statements are ordered children→parents so FK refs resolve.

-- 1. messages (children of conversations)
DELETE FROM public.whatsapp_messages;

-- 2. inbound_leads audit rows (campaign-only audit table, all test)
DELETE FROM public.inbound_leads;

-- 3. conversations
DELETE FROM public.whatsapp_conversations;

-- 4. the SELFTEST account
DELETE FROM public.whatsapp_accounts;

-- 5. the one confirmed-test WhatsApp lead — GUARDED so it deletes ONLY while
--    it is still a WhatsApp lead with NO quote (defensive against id reuse).
DELETE FROM public.leads l
 WHERE l.id = '129679a0-cba5-4429-9bef-82cd6cbd8238'
   AND l.source = 'WhatsApp'
   AND NOT EXISTS (SELECT 1 FROM public.quotes q WHERE q.lead_id = l.id);

-- ─── VERIFY ──────────────────────────────────────────────────────────
-- The first five MUST read 0; the last two MUST stay non-zero (real data).
SELECT 'wa_accounts'       AS what, count(*) AS n FROM public.whatsapp_accounts
UNION ALL SELECT 'wa_conversations', count(*) FROM public.whatsapp_conversations
UNION ALL SELECT 'wa_messages',      count(*) FROM public.whatsapp_messages
UNION ALL SELECT 'inbound_leads',    count(*) FROM public.inbound_leads
UNION ALL SELECT 'wa_sourced_leads', count(*) FROM public.leads WHERE source = 'WhatsApp'
UNION ALL SELECT 'qr_boards_KEPT',   count(*) FROM public.campaign_locations
UNION ALL SELECT 'qr_scans_KEPT',    count(*) FROM public.qr_scans;

SELECT 'Phase 126.3 campaign self-test cleanup applied' AS status;
