-- supabase_phase168_qr_lead_location_backfill.sql
-- Phase 168 (2026-06-17) — QR "Leads" count shows 0 though leads ARE created.
--
-- ROOT (a multi-file CREATE-OR-REPLACE collision, the §33 mole pattern):
-- `campaign_conversation_ensure_lead()` is replaced by c45 → c8 → c8.1.
--   • C8  added `location_id` to the lead INSERT (stamps WHICH board pulled
--     the lead) so the QR & Locations page can roll leads up per board.
--   • C8.1 rewrote the function to route a board's lead to its telecaller —
--     and DROPPED `location_id` from the INSERT column list (c8_1:98-108 end
--     at `campaign_id`, no location_id). C8.1 is the live version, so every new
--     QR lead is created with location_id = NULL → the per-board Leads count
--     reads 0 even though the lead exists and routed fine. (SCANNED & MESSAGED
--     still work — they read whatsapp_conversations.location_id, which the
--     webhook stamps independently.)
--
-- FIX — the function below is C8.1 BYTE-FOR-BYTE (board→telecaller routing,
-- all 4 P0 contracts, the double EXCEPTION wrap) with the ONE regression
-- restored: `location_id` is back in the lead INSERT column list + VALUES
-- (NEW.location_id). New QR leads carry the board again. Plus a one-time
-- backfill for leads already created without it.
--
-- ⚠ LOCKSTEP (do NOT regress again): any future CREATE OR REPLACE of
-- `campaign_conversation_ensure_lead` MUST keep BOTH (a) the board→telecaller
-- routing (v_owner from campaign_locations.default_telecaller_id first) AND
-- (b) `location_id` in the lead INSERT. The canonical is now THIS file.
--
-- §45-safe: campaign trigger on the NEW whatsapp_conversations table only;
-- no existing rep/lead flow, no hot path. Idempotent (CREATE OR REPLACE +
-- the backfill only fills NULLs).

-- ── 1. C4.5 = C8.1 routing + the restored location_id stamp ─────────────
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

    IF length(v_digits) < 10 THEN
      INSERT INTO public.inbound_leads (provider, external_event_id, status, norm_phone, dedupe_phone, campaign_id)
        VALUES ('whatsapp', v_evt, 'error', NEW.customer_wa_id, v_digits, NEW.campaign_id)
        ON CONFLICT (provider, external_event_id) DO NOTHING;
      RETURN NEW;
    END IF;

    -- P0-1 DEDUP — attach to an existing OPEN lead, never insert a collider.
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

    -- P0-2 ROUTING — board telecaller first, then campaign, then account.
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

    -- P0-2 — never a NULL-owner lead; queue for manual review instead.
    IF v_owner IS NULL THEN
      INSERT INTO public.inbound_leads (provider, external_event_id, status, norm_phone, dedupe_phone, campaign_id)
        VALUES ('whatsapp', v_evt, 'error', NEW.customer_wa_id, v_digits, NEW.campaign_id)
        ON CONFLICT (provider, external_event_id) DO NOTHING;
      RETURN NEW;
    END IF;

    -- Create the lead. location_id = NEW.location_id RESTORED (Phase 168) so
    -- the QR & Locations page rolls the lead up under its board. BOTH owner
    -- columns = v_owner (P0-2). cadence_paused → no follow-up/push. P0-3: no
    -- lead_activities. P0-4: stage 'New'.
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

    INSERT INTO public.inbound_leads (provider, external_event_id, status, norm_phone, dedupe_phone, campaign_id, lead_id)
      VALUES ('whatsapp', v_evt, 'converted', NEW.customer_wa_id, v_digits, NEW.campaign_id, v_new)
      ON CONFLICT (provider, external_event_id) DO NOTHING;
    RETURN NEW;

  EXCEPTION WHEN OTHERS THEN
    -- Absolute safety: a race/error must never break the conversation store.
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

-- ── 2. Backfill leads already created without the board ─────────────────
UPDATE public.leads l
   SET location_id = c.location_id
  FROM public.whatsapp_conversations c
 WHERE c.lead_id = l.id
   AND c.location_id IS NOT NULL
   AND l.location_id IS NULL;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- VERIFY
-- =====================================================================
-- V1: the live function now stamps location_id (expect t).
SELECT pg_get_functiondef('public.campaign_conversation_ensure_lead()'::regprocedure)
       ILIKE '%campaign_id, location_id%'  AS c45_stamps_location;

-- V2: leads now tagged to a board (was 0).
SELECT count(*) AS leads_with_board FROM public.leads WHERE location_id IS NOT NULL;

-- V3: per-board lead count (what the QR page reads). Non-zero for live boards.
SELECT cl.label AS board, cl.code, count(l.id) AS leads
  FROM public.campaign_locations cl
  LEFT JOIN public.leads l ON l.location_id = cl.id
 GROUP BY cl.id, cl.label, cl.code
 ORDER BY leads DESC NULLS LAST
 LIMIT 20;

SELECT 'Phase 168 QR lead→board (location_id) restore + backfill applied' AS status;
