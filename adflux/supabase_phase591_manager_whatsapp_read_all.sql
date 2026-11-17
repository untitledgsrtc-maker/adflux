-- Phase 591 — Sales manager (Devang) reads ALL WhatsApp chats, like admin (2026-11-17)
-- Owner: "WhatsApp not same as admin" -> picked "see all chats like admin".
-- Read-only: replies stay limited to his own chats (api/wa/send) and reassign stays
-- admin-only. Deliberately NOT the can_view_team_dashboard flag: that also opens the
-- team_all_* RPCs (company-wide leads/quotes), which breaks his team-only scope.
-- Messages follow automatically (wa_msg_via_conv checks conversation visibility).
-- Additive: no existing policy touched.

DROP POLICY IF EXISTS wa_conv_manager_read ON public.whatsapp_conversations;
CREATE POLICY wa_conv_manager_read ON public.whatsapp_conversations
  FOR SELECT USING ((SELECT public.is_sales_manager()));

NOTIFY pgrst, 'reload schema';

-- VERIFY:
-- SELECT policyname FROM pg_policies WHERE tablename='whatsapp_conversations' AND policyname='wa_conv_manager_read';  -- 1 row
