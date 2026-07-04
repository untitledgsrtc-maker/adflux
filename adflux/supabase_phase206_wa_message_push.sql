-- =====================================================================
-- Phase 206 — push the assigned rep on EVERY inbound WhatsApp message
-- 2026-07-04
--
-- WHY
--   C5 (supabase_campaign_c5_push_on_inbound_lead.sql) pushes ONCE, when a
--   chat first becomes a lead (lead_id NULL -> set). It explicitly does NOT
--   ping the ongoing conversation. Result: the customer's replies during a
--   live chat land silently — the rep only sees them if she happens to open
--   the inbox. Owner wants a sound on every message.
--
-- WHAT
--   AFTER INSERT on whatsapp_messages, for direction='in' only, push the
--   rep the chat is routed to. Unique per-message tag ('wa-msg-<msg id>')
--   so each message is a distinct notification that actually re-sounds
--   (a same-tag replace can be a SILENT swap — the whole point is sound).
--
-- OWNER RESOLUTION (Phase 205 model — the chat's assignee gets to reply,
--   so the chat's assignee gets the ping):
--     COALESCE( conversation.assigned_to,             -- admin-reassigned owner
--               lead.telecaller_id, lead.assigned_to) -- else the lead's owner
--   No owner resolvable -> skip (never a NULL-target push).
--
-- BURST COLLAPSE
--   A multi-part message / fast typer can land several inbound rows within
--   a second or two. To avoid machine-gunning her, skip if ANOTHER inbound
--   message on the SAME conversation arrived in the last 8 seconds — that
--   one already pushed. Genuine back-and-forth (> 8s apart) each sounds.
--   (Owner can ask to drop this window if he wants a ping on literally
--   every part.)
--
-- SAFE (CLAUDE.md §45)
--   • Trigger on a NEW campaign table (whatsapp_messages) — never the live
--     leads / lead_activities hot path. Read-only on leads/conversations.
--   • enqueue_push() uses pg_net (async) — the webhook's insert txn does
--     NOT wait on the HTTP push -> ZERO added latency to the webhook 200.
--   • Writes NO lead_activities (P0-3) -> cannot touch compute_daily_score
--     / the §33 meeting-KPI / incentive.
--   • Quiet-hours gated (is_push_allowed_now(), 9-21 IST) — off-hours the
--     message still lands in the inbox; only the phone ping waits.
--   • SECURITY DEFINER + hardened search_path -> may call enqueue_push even
--     though it is REVOKED from authenticated (§97.A2); DEFINER runs as
--     owner. (The webhook writes as service_role, which also has EXECUTE.)
--   • Whole body in EXCEPTION WHEN OTHERS -> a push failure can NEVER break
--     the message store or the webhook.
--   • Fires ONLY for direction='in' -> the rep's own outbound reply
--     (direction='out') never pings her.
--
-- NOTE — first contact gets two pings (C5 "new lead" + this "new message").
--   Redundant-but-harmless: different tags, both show. Owner wants to know;
--   if the double is unwanted, add a first-inbound skip here later.
--
-- Idempotent: CREATE OR REPLACE + DROP TRIGGER IF EXISTS.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.tg_push_on_wa_inbound_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_owner        uuid;
  v_conv_owner   uuid;
  v_lead_id      uuid;
  v_wa           text;
  v_cname        text;
  v_who          text;
  v_snip         text;
BEGIN
  -- Only inbound (customer) messages. Rep's own replies (direction='out')
  -- and status rows never ping.
  IF NEW.direction IS DISTINCT FROM 'in' THEN
    RETURN NEW;
  END IF;

  -- Burst collapse: another inbound on this conversation in the last 8s
  -- already pushed -> skip this part.
  IF EXISTS (
    SELECT 1 FROM public.whatsapp_messages m
     WHERE m.conversation_id = NEW.conversation_id
       AND m.direction = 'in'
       AND m.id <> NEW.id
       AND m.at > now() - interval '8 seconds'
  ) THEN
    RETURN NEW;
  END IF;

  -- Resolve the chat's owner (assignee wins, else the lead's owner).
  SELECT c.assigned_to, c.lead_id, c.customer_wa_id, c.customer_name
    INTO v_conv_owner, v_lead_id, v_wa, v_cname
    FROM public.whatsapp_conversations c
   WHERE c.id = NEW.conversation_id;

  v_owner := v_conv_owner;
  IF v_owner IS NULL AND v_lead_id IS NOT NULL THEN
    SELECT COALESCE(telecaller_id, assigned_to)
      INTO v_owner
      FROM public.leads
     WHERE id = v_lead_id;
  END IF;

  IF v_owner IS NULL THEN
    RETURN NEW;                         -- unrouted chat -> nobody to ping
  END IF;

  v_who  := COALESCE(NULLIF(BTRIM(v_cname), ''), NULLIF(v_wa, ''), 'WhatsApp');
  v_snip := left(COALESCE(NULLIF(BTRIM(NEW.body), ''), '[media]'), 80);

  -- Quiet-hours gate (9-21 IST). Off-hours: skip the ping, not the message.
  IF public.is_push_allowed_now() THEN
    PERFORM public.enqueue_push(
      v_owner,                          -- recipient (the assigned rep)
      v_who,                            -- title  = who messaged
      v_snip,                           -- body   = message preview
      '/campaigns/inbox',               -- deep link to the inbox
      'wa-msg-' || NEW.id::text         -- unique tag -> re-sounds every msg
    );
  END IF;

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  -- A push must NEVER break the message store / webhook (CLAUDE.md §45).
  RAISE WARNING '[tg_push_on_wa_inbound_message] msg % push skipped: %', NEW.id, SQLERRM;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_push_wa_inbound_message ON public.whatsapp_messages;
CREATE TRIGGER trg_push_wa_inbound_message
  AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW
  WHEN (NEW.direction = 'in')
  EXECUTE FUNCTION public.tg_push_on_wa_inbound_message();

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────────
-- 1) trigger present. 2) fn is SECURITY DEFINER. 3) carries the quiet-hours
--    gate. 4) resolves the conversation assignee (Phase 205 owner model).
SELECT
  (SELECT count(*) FROM pg_trigger
     WHERE tgname = 'trg_push_wa_inbound_message')                          AS trigger_present,     -- 1
  (SELECT prosecdef FROM pg_proc
     WHERE proname = 'tg_push_on_wa_inbound_message' LIMIT 1)               AS is_security_definer, -- t
  (SELECT position('is_push_allowed_now' in pg_get_functiondef(oid)) > 0
     FROM pg_proc WHERE proname = 'tg_push_on_wa_inbound_message' LIMIT 1)  AS has_quiet_gate,      -- t
  (SELECT position('c.assigned_to' in pg_get_functiondef(oid)) > 0
     FROM pg_proc WHERE proname = 'tg_push_on_wa_inbound_message' LIMIT 1)  AS resolves_assignee;   -- t

SELECT 'Phase 206 inbound-message push applied' AS status;
