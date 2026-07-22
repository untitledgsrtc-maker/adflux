-- ═══════════════════════════════════════════════════════════════════════════
-- Phase 251 — inbox sorts by LAST MESSAGE, not last inbound (2026-07-21)
-- ═══════════════════════════════════════════════════════════════════════════
-- ROOT CAUSE this fixes (owner report: "Jayna's leads' messages not visible
-- to me or the TC inbox; new messages show last, I want them first"):
--
--   CampaignInboxV2 ordered threads by `last_inbound_at` DESC + .limit(200).
--   Only the WEBHOOK (inbound) ever writes last_inbound_at. A conversation
--   CREATED by an outbound post-call template send (api/wa/send-template.js,
--   §120 P3) has last_inbound_at = NULL → with nullsFirst:false it sorts
--   AFTER every other thread → position ~333 of 332 → beyond the 200-row
--   fetch → the thread is NEVER LOADED, for admin or for the sending TC.
--   Same mechanism buried any thread whose latest activity is outbound.
--
-- THE FIX (single source, §71): every message — inbound (webhook), manual
-- reply (send.js), template (send-template.js), AI (ai-reply.js) — already
-- INSERTs a whatsapp_messages row. So ONE AFTER-INSERT trigger stamps the
-- conversation's last_message_at + last_message_direction. No endpoint is
-- edited, nothing to keep in lockstep, and any future sender is covered
-- automatically. last_message_direction='in' doubles as the inbox
-- "needs reply" marker.
--
-- §45: additive columns on a CAMPAIGN table; trigger fires only on campaign
-- message inserts (webhook/endpoints, service-role) — zero sales hot-path
-- touch. EXCEPTION-wrapped so a bump failure can never break a message
-- insert (the §46 store contract).
-- ═══════════════════════════════════════════════════════════════════════════

-- 1 · columns ---------------------------------------------------------------
ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS last_message_at        timestamptz,
  ADD COLUMN IF NOT EXISTS last_message_direction text;

-- 2 · the bump trigger (single source of "when did this thread last move") --
CREATE OR REPLACE FUNCTION public.wa_message_bump_conversation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- forward-only: a late retry / backfill insert with an old `at` must not
  -- drag a thread back down the list.
  UPDATE public.whatsapp_conversations
     SET last_message_at        = NEW.at,
         last_message_direction = NEW.direction
   WHERE id = NEW.conversation_id
     AND (last_message_at IS NULL OR NEW.at >= last_message_at);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- housekeeping must never break the message store (§46).
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wa_message_bump_conv ON public.whatsapp_messages;
CREATE TRIGGER trg_wa_message_bump_conv
  AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION public.wa_message_bump_conversation();

-- 3 · index for the inbox sort ----------------------------------------------
CREATE INDEX IF NOT EXISTS idx_wa_conv_last_message
  ON public.whatsapp_conversations (last_message_at DESC NULLS LAST);

-- 4 · backfill — newest message per conversation ----------------------------
UPDATE public.whatsapp_conversations c
   SET last_message_at        = m.at,
       last_message_direction = m.direction
  FROM (
    SELECT DISTINCT ON (conversation_id) conversation_id, at, direction
      FROM public.whatsapp_messages
     ORDER BY conversation_id, at DESC
  ) m
 WHERE m.conversation_id = c.id
   AND c.last_message_at IS NULL;

-- message-less conversations (webhook provisioned, nothing stored yet):
-- give them a sane position instead of NULL-at-the-bottom.
UPDATE public.whatsapp_conversations
   SET last_message_at = COALESCE(last_inbound_at, updated_at, created_at)
 WHERE last_message_at IS NULL;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFY (expect: trigger_present = 1 · still_null = 0 · the sample shows
-- the newest-touched threads first, direction reflecting the last message)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT count(*) AS trigger_present
  FROM pg_trigger
 WHERE tgname = 'trg_wa_message_bump_conv' AND NOT tgisinternal;

SELECT count(*) AS still_null
  FROM public.whatsapp_conversations
 WHERE last_message_at IS NULL;

SELECT customer_wa_id, last_message_at, last_message_direction
  FROM public.whatsapp_conversations
 ORDER BY last_message_at DESC NULLS LAST
 LIMIT 5;
