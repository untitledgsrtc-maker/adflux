-- =====================================================================
-- Campaign C5 — push the telecaller when a new WhatsApp lead arrives
-- 2026-06-09
--
-- WHAT
--   When C4.5 (campaign_conversation_ensure_lead) FIRST links a lead to a
--   WhatsApp conversation — i.e. a new customer messaged the campaign
--   number and became a lead — push the lead's owner (the configured
--   telecaller) so they know without watching the inbox.
--
-- WHY a trigger on lead_id (not on conversation INSERT)
--   C4.5 runs AFTER INSERT on whatsapp_conversations and, in its body,
--   UPDATEs the conversation to set lead_id (+ assigned_to). Firing on
--   the conversation INSERT would race C4.5 (lead_id / owner not set yet).
--   Firing AFTER UPDATE OF lead_id (NULL -> set) is deterministic: it runs
--   once, after C4.5 has created/attached the lead and stamped the owner.
--   • new lead  -> C4.5 set telecaller_id = assigned_to = the telecaller.
--   • dedup     -> attached to an existing open lead -> push THAT lead's
--                  owner (could be a sales rep). COALESCE(telecaller_id,
--                  assigned_to) resolves both.
--
-- SAFE (CLAUDE.md §45 + the design §13.6)
--   • Trigger on a NEW campaign table (whatsapp_conversations) — never on
--     the live leads/lead_activities hot path. Read-only on leads.
--   • enqueue_push() uses pg_net (async) — the calling txn does NOT wait
--     on the HTTP push, so ZERO latency is added to the webhook 200.
--   • DEFINER + hardened search_path; can call enqueue_push even though it
--     is REVOKED from authenticated (Phase 97.A2) — DEFINER runs as owner.
--   • Quiet-hours gated via is_push_allowed_now() (Phase 61.4 / 98.A) —
--     off-hours the chat still lands in the inbox + the lead in the queue;
--     only the phone ping waits.
--   • DOUBLE-safety: whole body in EXCEPTION WHEN OTHERS — a push failure
--     can NEVER break the C4.5 lead-create or the conversation store.
--   • Writes NO lead_activities (P0-3 preserved) — cannot touch
--     compute_daily_score / the §33 meeting-KPI / incentive.
--
-- One push per conversation (tag 'wa-lead-<conv id>'); a returning
-- customer's later messages do NOT re-push (lead_id already set -> the
-- NULL->set WHEN gate is false). Per-message "reply" pings during a live
-- chat are a separate, throttled enhancement — not built here.
--
-- Idempotent: CREATE OR REPLACE + DROP TRIGGER IF EXISTS.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.tg_push_on_wa_inbound_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_owner    uuid;
  v_name     text;
  v_company  text;
  v_lphone   text;   -- the lead's stored phone
  v_phone    text;   -- phone to display
  v_title    text;
  v_body     text;
BEGIN
  -- Belt-and-suspenders (the trigger WHEN already gates NULL -> set).
  IF NEW.lead_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Owner to ping. Read-only on leads. For a campaign-new lead this is the
  -- configured telecaller; for a dedup-attached lead it's that lead's rep.
  SELECT COALESCE(telecaller_id, assigned_to), name, company, phone
    INTO v_owner, v_name, v_company, v_lphone
    FROM public.leads
   WHERE id = NEW.lead_id;

  IF NOT FOUND OR v_owner IS NULL THEN
    RETURN NEW;
  END IF;

  v_phone := COALESCE(NULLIF(NEW.customer_wa_id, ''), v_lphone, '');
  v_title := 'New WhatsApp lead';
  v_body  := COALESCE(NULLIF(v_name, ''), NULLIF(v_company, ''), v_phone)
             || CASE WHEN v_phone <> '' AND v_phone <> COALESCE(v_name, '')
                     THEN ' · ' || v_phone ELSE '' END;

  -- Quiet-hours gate (9-21 IST). Off-hours: skip the ping, not the lead.
  IF public.is_push_allowed_now() THEN
    PERFORM public.enqueue_push(
      v_owner,                           -- recipient
      v_title,                           -- title
      v_body,                            -- body
      '/leads/' || NEW.lead_id::text,    -- deep link (TC can open own lead)
      'wa-lead-' || NEW.id::text         -- per-conversation dedupe tag
    );
  END IF;

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  -- A push must NEVER break the store / C4.5 (CLAUDE.md §45).
  RAISE WARNING '[tg_push_on_wa_inbound_lead] conv % push skipped: %', NEW.id, SQLERRM;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_push_wa_inbound_lead ON public.whatsapp_conversations;
CREATE TRIGGER trg_push_wa_inbound_lead
  AFTER UPDATE OF lead_id ON public.whatsapp_conversations
  FOR EACH ROW
  WHEN (OLD.lead_id IS NULL AND NEW.lead_id IS NOT NULL)
  EXECUTE FUNCTION public.tg_push_on_wa_inbound_lead();

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────────
-- 1) trigger present. 2) function is SECURITY DEFINER + search_path hardened
--    + carries the quiet-hours gate.
SELECT
  (SELECT count(*) FROM pg_trigger
     WHERE tgname = 'trg_push_wa_inbound_lead')                       AS trigger_present,      -- 1
  (SELECT prosecdef FROM pg_proc
     WHERE proname = 'tg_push_on_wa_inbound_lead' LIMIT 1)            AS is_security_definer,  -- t
  (SELECT position('is_push_allowed_now' in pg_get_functiondef(oid)) > 0
     FROM pg_proc WHERE proname = 'tg_push_on_wa_inbound_lead' LIMIT 1) AS has_quiet_gate;     -- t

SELECT 'Campaign C5 inbound-lead push applied' AS status;
