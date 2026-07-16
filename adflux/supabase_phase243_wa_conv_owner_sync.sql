-- supabase_phase243_wa_conv_owner_sync.sql
--
-- Phase 243 — WhatsApp inbox read-leak fix. A telecaller (Rima, the account
-- default router) was seeing EVERY chat, even leads reassigned away from her.
--
-- ROOT CAUSE: every inbound conversation is stamped whatsapp_conversations
-- .assigned_to = the account's default_telecaller_id (Rima) by C4.5 routing,
-- and REASSIGNING the lead updated only public.leads — it NEVER updated the
-- conversation's owner. So the RLS SELECT policy `wa_conv_self_or_lead`
-- (assigned_to = auth.uid() OR lead-owned) kept returning those chats to Rima
-- forever via the frozen assigned_to stamp. Genuine PII read leak (she could
-- READ other reps' customer threads; the SEND path is separately gated).
--
-- FIX (additive, §45-safe — admin/co_owner FOR-ALL policy untouched, so they
-- still see everything; this only re-points the rep-scoping stamp):
--   1. A trigger on public.leads (AFTER UPDATE OF assigned_to, telecaller_id)
--      re-points the conversation to the lead's CURRENT owner. Column-specific
--      → fires ONLY on an ownership change (reassign), NOT on a normal lead
--      save (stage/heat/notes) → zero hot-path cost. Covers EVERY reassign
--      entry point (reassign_lead RPC, bulk, the inbox path that writes leads,
--      any future path) — single-source, mirrors the Phase 130 owner-transfer
--      trigger.
--   2. A one-time heal of existing stuck conversations.
--
-- Lead owner = COALESCE(telecaller_id, assigned_to): the reassign RPC writes
-- the two columns mutually-exclusively (TC target → telecaller_id, sales
-- target → assigned_to, the other NULL, Phase 99.C), so COALESCE picks the
-- live owner in both cases. C4.5 sets BOTH = the default TC on a new inbound,
-- so COALESCE = that TC. Never null out the conversation owner when the lead
-- has no owner (the IS NOT NULL guard) — don't orphan a live chat.

-- ── 1. sync trigger ──
CREATE OR REPLACE FUNCTION public.sync_wa_conversation_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_new_owner uuid := COALESCE(NEW.telecaller_id, NEW.assigned_to);
BEGIN
  -- Owner didn't actually change → nothing to do (the UPDATE may have targeted
  -- the columns with the same value).
  IF v_new_owner IS NOT DISTINCT FROM COALESCE(OLD.telecaller_id, OLD.assigned_to) THEN
    RETURN NEW;
  END IF;
  -- Best-effort — a conversation re-point must NEVER roll back or break the
  -- lead reassign itself (§45). SECURITY DEFINER so the UPDATE bypasses the
  -- rep's own conversation RLS (a non-admin has no UPDATE policy on the table).
  BEGIN
    IF v_new_owner IS NOT NULL THEN
      UPDATE public.whatsapp_conversations
         SET assigned_to = v_new_owner
       WHERE lead_id = NEW.id
         AND assigned_to IS DISTINCT FROM v_new_owner;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'sync_wa_conversation_owner failed for lead %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_owner_sync_wa_conv ON public.leads;
CREATE TRIGGER trg_lead_owner_sync_wa_conv
  AFTER UPDATE OF assigned_to, telecaller_id ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_wa_conversation_owner();

-- ── 2. one-time heal — re-point every conversation stuck on a stale owner ──
-- Idempotent: re-running finds 0 mismatched rows once healed.
UPDATE public.whatsapp_conversations c
   SET assigned_to = COALESCE(l.telecaller_id, l.assigned_to)
  FROM public.leads l
 WHERE l.id = c.lead_id
   AND c.assigned_to IS DISTINCT FROM COALESCE(l.telecaller_id, l.assigned_to)
   AND COALESCE(l.telecaller_id, l.assigned_to) IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- VERIFY:
--   -- trigger present → 1
--   SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_lead_owner_sync_wa_conv';
--   -- no conversation left on a stale owner → 0
--   SELECT count(*) FROM public.whatsapp_conversations c
--     JOIN public.leads l ON l.id = c.lead_id
--    WHERE c.assigned_to IS DISTINCT FROM COALESCE(l.telecaller_id, l.assigned_to)
--      AND COALESCE(l.telecaller_id, l.assigned_to) IS NOT NULL;
