-- supabase_phase660_wa_push_title.sql (23-11-2026)
-- WhatsApp-message push title: a customer name with no letter or digit rendered as a
-- blank title (286 of 6,511 pushes). Fall back to the customer's number.
-- Body = live function captured via pg_get_functiondef, one line changed. Idempotent.

CREATE OR REPLACE FUNCTION public.tg_push_on_wa_inbound_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_owner        uuid;
  v_conv_owner   uuid;
  v_lead_id      uuid;
  v_wa           text;
  v_cname        text;
  v_who          text;
  v_snip         text;
BEGIN
  -- Only inbound (customer) messages. Rep's own replies never ping.
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

  -- Phase 660: a name with no letter/digit (emoji-only or invisible chars) showed as a
  -- blank push title; fall back to the number.
  v_who  := COALESCE(CASE WHEN v_cname ~ '[[:alnum:]]' THEN BTRIM(v_cname) END, NULLIF(v_wa, ''), 'WhatsApp');
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
  RAISE WARNING '[tg_push_on_wa_inbound_message] msg % push skipped: %', NEW.id, SQLERRM;
  RETURN NEW;
END $function$
;

NOTIFY pgrst, 'reload schema';

-- VERIFY: expect has_660 = true, still_security_definer = true
SELECT pg_get_functiondef('public.tg_push_on_wa_inbound_message'::regproc) LIKE '%[[:alnum:]]%' AS has_660,
       (SELECT prosecdef FROM pg_proc WHERE oid = 'public.tg_push_on_wa_inbound_message'::regproc) AS still_security_definer;
