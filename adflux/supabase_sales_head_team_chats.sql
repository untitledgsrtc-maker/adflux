-- =====================================================================
-- SALES HEAD — read-only whole-team WhatsApp inbox (chats)
-- 2026-08-06 · spec: docs/SALES_HEAD_SPEC.md
--
-- A "Sales Head" = a user with users.can_view_team_dashboard=true (is_team_viewer()).
-- They already see all-team leads/quotes/follow-ups/GPS read-only via gated RPCs
-- (§84/§116/§247). This adds the missing piece: they can READ every rep's WhatsApp
-- conversation.
--
-- ONE policy is enough: a SELECT policy letting a team viewer see every
-- conversation. Messages INHERIT automatically — the existing wa_msg_via_conv
-- policy is `EXISTS (SELECT 1 FROM whatsapp_conversations c WHERE c.id = ...)`,
-- and that subquery runs under the caller's conversation-RLS, so widening the
-- conversation view widens the message view with it (the c2 header says exactly
-- this: "messages: inherit visibility from the conversation").
--
-- READ-ONLY by construction:
--   • No write policy is added → a team viewer can't INSERT/UPDATE/DELETE a
--     conversation or reassign it.
--   • Sending is blocked server-side: api/wa/send gates a non-admin to threads
--     where conv.assigned_to = uid OR the lead is theirs (§205). A Sales Head is
--     neither on another rep's chat → the send is refused even if the composer shows.
--
-- BOUNDED (not the §84 app-wide-leak trap): the only rep-facing pages that read
-- whatsapp_conversations/messages are the campaign inbox + the campaign tab-bar
-- counts; CampaignQrV2 / CampaignIntegrationsV2 are admin-route-gated (a Sales Head
-- can't open them). The AI/webhook use the service role (RLS-exempt). So this broad
-- SELECT is scoped to the campaign surface the head is entitled to — it can't leak
-- into /work, /leads, dashboards the way a broad `leads` policy did.
--
-- Fails closed: is_team_viewer() = COALESCE(users.can_view_team_dashboard, false),
-- so a NULL role / no auth.uid() → false → no access. Idempotent.
-- =====================================================================

DROP POLICY IF EXISTS wa_conv_team_viewer ON public.whatsapp_conversations;
CREATE POLICY wa_conv_team_viewer ON public.whatsapp_conversations FOR SELECT TO authenticated
  USING (public.is_team_viewer());

NOTIFY pgrst, 'reload schema';

-- ==== VERIFY =========================================================
-- Expect team_viewer_policy = 1. (Messages need NO new policy — they inherit.)
SELECT 'team_viewer_policy' AS check,
       (SELECT count(*) FROM pg_policies
         WHERE schemaname='public' AND tablename='whatsapp_conversations'
           AND policyname='wa_conv_team_viewer') AS n_expect_1
UNION ALL
SELECT 'msg_inherits_via_conv',
       (SELECT count(*) FROM pg_policies
         WHERE schemaname='public' AND tablename='whatsapp_messages'
           AND policyname='wa_msg_via_conv');   -- must still exist (=1) for inheritance
