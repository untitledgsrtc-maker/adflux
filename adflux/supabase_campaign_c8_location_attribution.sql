-- =====================================================================
-- Campaign C8 — QR board (location) attribution
-- 2026-06-07
--
-- WHAT
--   A QR board encodes  "Hi, saw your screen at <place> [RR-AHM-01]"  in
--   the wa.me text (CampaignQrV2). When the customer sends, the webhook
--   reads the [CODE], matches campaign_locations, and stamps the
--   conversation with campaign_id + location_id (in api/wa/webhook.js,
--   C8 part). This file:
--     1. adds the nullable location_id columns (additive — no existing
--        code reads them, frozen pages SELECT * but ignore it).
--     2. SUPERSEDES the C4.5 campaign_conversation_ensure_lead() function
--        so the created lead also carries location_id (the board) — the
--        dashboard then rolls up messaged → lead → won PER BOARD.
--
--   v1 attribution = "messaged" only (a message carrying [CODE] arrives) —
--   raw scan counts are owner-locked OUT (spec §7).
--
-- SAFETY (CLAUDE.md §45)
--   • leads.location_id + whatsapp_conversations.location_id are NULLABLE,
--     ON DELETE SET NULL, read by no existing flow. Pure additive columns.
--   • The function is byte-identical to C4.5 EXCEPT one extra column in the
--     leads INSERT (location_id = NEW.location_id). All 4 P0 contracts,
--     the double EXCEPTION wrap, cadence_paused, the round-robin BOTH-owner
--     fix, and the NEW-table trigger are preserved unchanged.
--   • This is the CANONICAL campaign_conversation_ensure_lead() now — if
--     C4.5's file is ever re-run, re-run this one AFTER it.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE + DROP TRIGGER
-- IF EXISTS).
-- =====================================================================

-- ─── 1. Additive location columns ───────────────────────────────────
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS location_id uuid
  REFERENCES public.campaign_locations(id) ON DELETE SET NULL;

ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS location_id uuid
  REFERENCES public.campaign_locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_location_id ON public.leads (location_id);

-- ─── 2. C4.5 function + location_id (CANONICAL) ─────────────────────
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
  IF NEW.lead_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_digits := regexp_replace(COALESCE(NEW.customer_wa_id, ''), '\D', '', 'g');

    IF length(v_digits) < 10 THEN
      INSERT INTO public.inbound_leads (provider, external_event_id, status, norm_phone, dedupe_phone, campaign_id, location_id)
        VALUES ('whatsapp', v_evt, 'error', NEW.customer_wa_id, v_digits, NEW.campaign_id, NEW.location_id)
        ON CONFLICT (provider, external_event_id) DO NOTHING;
      RETURN NEW;
    END IF;

    -- P0-1 DEDUP — attach to an existing OPEN lead, never insert a
    -- colliding phone, never reassign.
    v_existing := public.find_open_lead_id_by_phone(NEW.customer_wa_id);
    IF v_existing IS NOT NULL THEN
      UPDATE public.whatsapp_conversations
         SET lead_id = v_existing, updated_at = now()
       WHERE id = NEW.id AND lead_id IS NULL;
      INSERT INTO public.inbound_leads (provider, external_event_id, status, norm_phone, dedupe_phone, campaign_id, location_id, lead_id)
        VALUES ('whatsapp', v_evt, 'duplicate', NEW.customer_wa_id, v_digits, NEW.campaign_id, NEW.location_id, v_existing)
        ON CONFLICT (provider, external_event_id) DO NOTHING;
      RETURN NEW;
    END IF;

    -- P0-2 ROUTING — owner from campaign then account; segment from
    -- campaign else PRIVATE.
    IF NEW.campaign_id IS NOT NULL THEN
      SELECT default_telecaller_id, COALESCE(segment, 'PRIVATE')
        INTO v_owner, v_segment
        FROM public.campaigns WHERE id = NEW.campaign_id;
    END IF;
    IF v_owner IS NULL AND NEW.whatsapp_account_id IS NOT NULL THEN
      SELECT default_telecaller_id INTO v_owner
        FROM public.whatsapp_accounts WHERE id = NEW.whatsapp_account_id;
    END IF;
    v_segment := COALESCE(v_segment, 'PRIVATE');

    -- P0-2 — never a NULL-owner lead.
    IF v_owner IS NULL THEN
      INSERT INTO public.inbound_leads (provider, external_event_id, status, norm_phone, dedupe_phone, campaign_id, location_id)
        VALUES ('whatsapp', v_evt, 'error', NEW.customer_wa_id, v_digits, NEW.campaign_id, NEW.location_id)
        ON CONFLICT (provider, external_event_id) DO NOTHING;
      RETURN NEW;
    END IF;

    -- Create the lead. BOTH owner cols = v_owner (round-robin skip). C8:
    -- location_id = NEW.location_id stamps WHICH board this lead came from.
    -- P0-3: no lead_activities. P0-4: stage 'New'. cadence_paused → no cascade.
    INSERT INTO public.leads (
      name, phone, segment, source, stage,
      telecaller_id, assigned_to, created_by, heat, cadence_paused, campaign_id, location_id
    ) VALUES (
      'WhatsApp lead',
      NEW.customer_wa_id,
      v_segment,
      'WhatsApp',
      'New',
      v_owner, v_owner, v_owner, 'warm', true, NEW.campaign_id, NEW.location_id
    )
    RETURNING id INTO v_new;

    UPDATE public.whatsapp_conversations
       SET lead_id = v_new,
           assigned_to = COALESCE(assigned_to, v_owner),
           updated_at = now()
     WHERE id = NEW.id AND lead_id IS NULL;

    INSERT INTO public.inbound_leads (provider, external_event_id, status, norm_phone, dedupe_phone, campaign_id, location_id, lead_id)
      VALUES ('whatsapp', v_evt, 'converted', NEW.customer_wa_id, v_digits, NEW.campaign_id, NEW.location_id, v_new)
      ON CONFLICT (provider, external_event_id) DO NOTHING;
    RETURN NEW;

  EXCEPTION WHEN OTHERS THEN
    BEGIN
      v_existing := public.find_open_lead_id_by_phone(NEW.customer_wa_id);
      IF v_existing IS NOT NULL THEN
        UPDATE public.whatsapp_conversations
           SET lead_id = v_existing, updated_at = now()
         WHERE id = NEW.id AND lead_id IS NULL;
        INSERT INTO public.inbound_leads (provider, external_event_id, status, norm_phone, dedupe_phone, campaign_id, location_id, lead_id)
          VALUES ('whatsapp', v_evt, 'duplicate', NEW.customer_wa_id, v_digits, NEW.campaign_id, NEW.location_id, v_existing)
          ON CONFLICT (provider, external_event_id) DO NOTHING;
      ELSE
        INSERT INTO public.inbound_leads (provider, external_event_id, status, norm_phone, dedupe_phone, campaign_id, location_id)
          VALUES ('whatsapp', v_evt, 'error', NEW.customer_wa_id, v_digits, NEW.campaign_id, NEW.location_id)
          ON CONFLICT (provider, external_event_id) DO NOTHING;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[campaign_ensure_lead] hard-fail conv %: %', NEW.id, SQLERRM;
    END;
    RETURN NEW;
  END;
END $$;

DROP TRIGGER IF EXISTS trg_campaign_conv_ensure_lead ON public.whatsapp_conversations;
CREATE TRIGGER trg_campaign_conv_ensure_lead
  AFTER INSERT ON public.whatsapp_conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.campaign_conversation_ensure_lead();

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name='leads' AND column_name='location_id')                         AS leads_location_col,   -- → 1
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name='whatsapp_conversations' AND column_name='location_id')         AS conv_location_col,    -- → 1
  (SELECT count(*) FROM pg_trigger WHERE tgname='trg_campaign_conv_ensure_lead')     AS trigger_present;      -- → 1

SELECT 'Campaign C8 location attribution applied' AS status;
