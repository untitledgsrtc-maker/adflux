-- =====================================================================
-- Campaign C11 — a new WhatsApp lead carries the customer's PROFILE NAME
-- 2026-06-09
--
-- A WhatsApp inbound webhook includes the sender's profile name
-- (value.contacts[].profile.name). We weren't capturing it, so C4.5 created
-- the lead as the generic 'WhatsApp lead'. Now: the webhook stores the name on
-- whatsapp_conversations.customer_name, and C4.5 uses it for the lead's name
-- (falling back to 'WhatsApp lead' when absent).
--
-- SAFE (§45): additive nullable column on a NEW campaign table. The C4.5
-- reproduction below is the CURRENT (C8.1 board-first) function, byte-identical
-- EXCEPT the single lead-name expression. All 4 P0 contracts + the board→
-- campaign→account routing + the double-EXCEPTION store-safety are preserved.
-- Only NEW leads get the name (P0-1 dedup never renames an existing lead).
-- Writes leads → guardian-audited.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE. Trigger unchanged.
-- =====================================================================

ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS customer_name text;

CREATE OR REPLACE FUNCTION public.campaign_conversation_ensure_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing  uuid;
  v_new       uuid;
  v_owner     uuid;
  v_segment   text;
  v_digits    text;
  v_evt       text := NEW.id::text;   -- one lead-attempt per conversation
BEGIN
  -- Already linked (defensive) → nothing to do.
  IF NEW.lead_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_digits := regexp_replace(COALESCE(NEW.customer_wa_id, ''), '\D', '', 'g');

    -- Need a usable phone (≥10 digits) to make or match a lead.
    IF length(v_digits) < 10 THEN
      INSERT INTO public.inbound_leads (provider, external_event_id, status, norm_phone, dedupe_phone, campaign_id)
        VALUES ('whatsapp', v_evt, 'error', NEW.customer_wa_id, v_digits, NEW.campaign_id)
        ON CONFLICT (provider, external_event_id) DO NOTHING;
      RETURN NEW;
    END IF;

    -- P0-1 DEDUP — link to an existing OPEN lead, never insert a colliding
    -- phone (so the dup-phone block can't fire). Never reassign it.
    v_existing := public.find_open_lead_id_by_phone(NEW.customer_wa_id);
    IF v_existing IS NOT NULL THEN
      UPDATE public.whatsapp_conversations
         SET lead_id = v_existing, updated_at = now()
       WHERE id = NEW.id AND lead_id IS NULL;
      INSERT INTO public.inbound_leads (provider, external_event_id, status, norm_phone, dedupe_phone, campaign_id, lead_id)
        VALUES ('whatsapp', v_evt, 'duplicate', NEW.customer_wa_id, v_digits, NEW.campaign_id, v_existing)
        ON CONFLICT (provider, external_event_id) DO NOTHING;
      RETURN NEW;
    END IF;

    -- P0-2 ROUTING — owner from the BOARD first (most specific: a board can
    -- route straight to a telecaller), then the campaign, then the receiving
    -- account; segment from the campaign, else PRIVATE.
    IF NEW.location_id IS NOT NULL THEN
      SELECT default_telecaller_id INTO v_owner
        FROM public.campaign_locations WHERE id = NEW.location_id;
    END IF;
    IF v_owner IS NULL AND NEW.campaign_id IS NOT NULL THEN
      SELECT default_telecaller_id, COALESCE(segment, 'PRIVATE')
        INTO v_owner, v_segment
        FROM public.campaigns WHERE id = NEW.campaign_id;
    END IF;
    IF v_owner IS NULL AND NEW.whatsapp_account_id IS NOT NULL THEN
      SELECT default_telecaller_id INTO v_owner
        FROM public.whatsapp_accounts WHERE id = NEW.whatsapp_account_id;
    END IF;
    v_segment := COALESCE(v_segment, 'PRIVATE');

    -- P0-2 — NEVER a NULL-owner campaign lead. No telecaller configured →
    -- queue for manual review, create NO lead (won't dump into round-robin).
    IF v_owner IS NULL THEN
      INSERT INTO public.inbound_leads (provider, external_event_id, status, norm_phone, dedupe_phone, campaign_id)
        VALUES ('whatsapp', v_evt, 'error', NEW.customer_wa_id, v_digits, NEW.campaign_id)
        ON CONFLICT (provider, external_event_id) DO NOTHING;
      RETURN NEW;
    END IF;

    -- Create the lead. BOTH owner columns = v_owner (see P0-2 header note):
    -- telecaller_id routes the TC queue; the non-NULL assigned_to makes the
    -- round-robin skip. cadence_paused = true → no follow-up/push cascade.
    -- P0-3: no lead_activities write. P0-4: stage 'New'. C11: name = the
    -- customer's WhatsApp profile name when present, else 'WhatsApp lead'.
    INSERT INTO public.leads (
      name, phone, segment, source, stage,
      telecaller_id, assigned_to, created_by, heat, cadence_paused, campaign_id
    ) VALUES (
      COALESCE(NULLIF(NEW.customer_name, ''), 'WhatsApp lead'),
      NEW.customer_wa_id,
      v_segment,
      'WhatsApp',
      'New',
      v_owner, v_owner, v_owner, 'warm', true, NEW.campaign_id
    )
    RETURNING id INTO v_new;

    UPDATE public.whatsapp_conversations
       SET lead_id = v_new,
           assigned_to = COALESCE(assigned_to, v_owner),
           updated_at = now()
     WHERE id = NEW.id AND lead_id IS NULL;

    INSERT INTO public.inbound_leads (provider, external_event_id, status, norm_phone, dedupe_phone, campaign_id, lead_id)
      VALUES ('whatsapp', v_evt, 'converted', NEW.customer_wa_id, v_digits, NEW.campaign_id, v_new)
      ON CONFLICT (provider, external_event_id) DO NOTHING;
    RETURN NEW;

  EXCEPTION WHEN OTHERS THEN
    -- Absolute safety: a race or any error must not break the conversation
    -- store. Try to attach to a now-existing lead; else log 'error'. Never
    -- re-raise. The inner block is itself wrapped so even the audit insert
    -- failing can't escape.
    BEGIN
      v_existing := public.find_open_lead_id_by_phone(NEW.customer_wa_id);
      IF v_existing IS NOT NULL THEN
        UPDATE public.whatsapp_conversations
           SET lead_id = v_existing, updated_at = now()
         WHERE id = NEW.id AND lead_id IS NULL;
        INSERT INTO public.inbound_leads (provider, external_event_id, status, norm_phone, dedupe_phone, campaign_id, lead_id)
          VALUES ('whatsapp', v_evt, 'duplicate', NEW.customer_wa_id, v_digits, NEW.campaign_id, v_existing)
          ON CONFLICT (provider, external_event_id) DO NOTHING;
      ELSE
        INSERT INTO public.inbound_leads (provider, external_event_id, status, norm_phone, dedupe_phone, campaign_id)
          VALUES ('whatsapp', v_evt, 'error', NEW.customer_wa_id, v_digits, NEW.campaign_id)
          ON CONFLICT (provider, external_event_id) DO NOTHING;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[campaign_ensure_lead] hard-fail conv %: %', NEW.id, SQLERRM;
    END;
    RETURN NEW;
  END;
END $$;

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'whatsapp_conversations'
       AND column_name = 'customer_name')                                                 AS column_present,    -- 1
  (SELECT position('NEW.customer_name' in pg_get_functiondef(oid)) > 0
     FROM pg_proc WHERE proname = 'campaign_conversation_ensure_lead' LIMIT 1)             AS uses_name,         -- t
  (SELECT position('campaign_locations WHERE id = NEW.location_id' in pg_get_functiondef(oid)) > 0
     FROM pg_proc WHERE proname = 'campaign_conversation_ensure_lead' LIMIT 1)             AS routes_by_board;   -- t (C8.1 preserved)

SELECT 'Campaign C11 lead-name applied' AS status;
