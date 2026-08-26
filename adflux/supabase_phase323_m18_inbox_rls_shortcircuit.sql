-- ============================================================================
-- supabase_phase323_m18_inbox_rls_shortcircuit.sql   (Phase 323, audit M18)
-- Inbox RLS: short-circuit the per-row correlated EXISTS for admin / co_owner /
-- team-viewer callers. The campaign inbox polls every ~12s over up to ~4,000
-- whatsapp_conversations (and the messages inherit through a nested EXISTS), so
-- for a privileged caller the per-row leads/conversation EXISTS is pure waste.
--
-- SAFE — VISIBILITY IS UNCHANGED (provable): admin/co_owner already see every row
-- via wa_conv_admin / wa_msg_admin, and a team-viewer via wa_conv_team_viewer,
-- so ADDING `get_my_role() IN ('admin','co_owner') OR is_team_viewer()` as the
-- FIRST OR-terms of wa_conv_self_or_lead / wa_msg_via_conv cannot widen the row
-- set (those rows are already visible via the sibling policies). It only lets the
-- planner satisfy the OR on the cheap InitPlan (get_my_role()/is_team_viewer() are
-- STABLE → evaluated once) and SKIP the per-row EXISTS for those callers. For a
-- normal rep both new terms are false, so the policy reduces to its original
-- `assigned_to = auth.uid() OR (lead EXISTS)` — byte-identical behaviour.
--
-- Idempotent (DROP IF EXISTS + CREATE). Run off-peak — DROP POLICY briefly holds
-- a lock; these are campaign tables (not a per-second hot table like gps_pings),
-- so the window is tiny. The other policies (wa_conv_admin, wa_conv_team_viewer,
-- wa_msg_admin) are UNTOUCHED.
-- ============================================================================

-- ---------- whatsapp_conversations SELECT ----------
DROP POLICY IF EXISTS wa_conv_self_or_lead ON public.whatsapp_conversations;
CREATE POLICY wa_conv_self_or_lead ON public.whatsapp_conversations FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('admin','co_owner')                 -- InitPlan, first → short-circuits the EXISTS
    OR public.is_team_viewer()                                   -- InitPlan
    OR assigned_to = auth.uid()                                  -- cheap column compare
    OR (lead_id IS NOT NULL AND EXISTS (                         -- expensive per-row, LAST
          SELECT 1 FROM public.leads l WHERE l.id = whatsapp_conversations.lead_id))
  );

-- ---------- whatsapp_messages SELECT ----------
DROP POLICY IF EXISTS wa_msg_via_conv ON public.whatsapp_messages;
CREATE POLICY wa_msg_via_conv ON public.whatsapp_messages FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('admin','co_owner')                 -- InitPlan, first
    OR public.is_team_viewer()                                   -- InitPlan
    OR EXISTS (                                                  -- nested conv-RLS chain, LAST
          SELECT 1 FROM public.whatsapp_conversations c WHERE c.id = whatsapp_messages.conversation_id)
  );

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY (optional). 1) both policies present with the new qual:
--   SELECT polname, pg_get_expr(polqual, polrelid) AS using_qual
--   FROM pg_policy WHERE polname IN ('wa_conv_self_or_lead','wa_msg_via_conv');
--   -> the qual starts with (get_my_role() = ANY ... OR is_team_viewer() OR ...)
--
-- 2) VISIBILITY UNCHANGED — the whole point. Because the added terms are already
--    covered by sibling policies, a privileged/rep caller sees the SAME rows as
--    before. Confirm from the app (open /campaigns/inbox as admin, as a rep) —
--    thread list identical to before. (A pure SQL count can't impersonate a role
--    without JWT claims; the app is the real check — same as p6.)
--
-- 3) (advanced) confirm the planner skips the per-row EXISTS for an admin:
--    run EXPLAIN of a conversations SELECT under an impersonated admin JWT
--    (SET request.jwt.claims ...) and check the leads subplan is gone/one-shot.
-- ============================================================================
