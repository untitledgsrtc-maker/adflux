-- ============================================================================
-- db/functions/campaign_conversation_ensure_lead.sql — CANONICAL HOME (Phase 178 / Stage 2)
-- ============================================================================
--
-- ⭐ The ONE place campaign_conversation_ensure_lead is allowed to live.
--    To change it, EDIT THIS FILE and run it once in Studio. Never re-paste it
--    into a new phaseN/campaign file (§71). It lived in 5 files (C4.5 → C8 →
--    C8.1 → C11 → Phase 168); each rebuild risked dropping an earlier fix —
--    Phase 168 existed BECAUSE C8.1 silently dropped C8's location_id (§168).
--
-- WHAT IT DOES: AFTER-INSERT trigger function on whatsapp_conversations. Turns
--    an inbound WhatsApp chat into a lead. It WRITES the live `leads` table, so
--    the 4 P0 contracts below are SACRED (§46/§53). NOT money, but lead-writing
--    → guardian before any change.
--
-- TRIGGER WIRING lives elsewhere (intentionally NOT in this file): the
--    `trg_campaign_conv_ensure_lead` AFTER INSERT trigger on
--    whatsapp_conversations is defined (idempotent) in
--    supabase_campaign_c45_inbound_to_lead.sql and
--    supabase_campaign_c8_location_attribution.sql. This canonical owns the
--    FUNCTION BODY only. Re-running this file replaces the body; the live
--    trigger keeps pointing at it by name.
--
-- PROVENANCE: captured byte-for-byte from the LIVE database 2026-06-23 via
--    pg_get_functiondef. Single signature (trigger fn, no args). Running this
--    file now is a NO-OP.
--
-- SUPERSEDES (Phase 178 removed the function body from each; their triggers /
--    other functions / backfills stay):
--      supabase_campaign_c45_inbound_to_lead.sql        (keeps its CREATE TRIGGER)
--      supabase_campaign_c8_location_attribution.sql    (keeps its CREATE TRIGGER)
--      supabase_campaign_c8_1_board_telecaller.sql      (keeps its 2nd function)
--      supabase_campaign_c11_lead_name.sql
--      supabase_phase168_qr_lead_location_backfill.sql  (keeps its backfill)
--
-- LOCKED P0 CONTRACTS in the body (a diff that breaks any is a BLOCK, §46/§53):
--    • P0-1 DEDUP   — find_open_lead_id_by_phone() FIRST → attach to the open
--                     lead, NEVER insert a colliding phone, NEVER reassign.
--    • P0-2 ROUTING — owner = location → campaign → account telecaller; sets
--                     BOTH telecaller_id AND assigned_to = v_owner (the
--                     round-robin-safe contract); NEVER a NULL-owner lead
--                     (queues 'error' in inbound_leads instead).
--    • P0-3         — writes NO lead_activities (can't touch compute_daily_score / §33).
--    • P0-4         — stage 'New' only; cadence_paused=true → no follow-up/push cascade.
--    • Phase 168    — location_id = NEW.location_id on the lead INSERT (QR board
--                     roll-up). C8.1 dropped this once; do NOT drop it again.
--    • Safety       — double EXCEPTION wrap: a race/error must NEVER break the
--                     whatsapp_conversations store.
--
-- REVERT: re-run this file. TRIPWIRE: VERIFY block at the bottom (run any time).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.campaign_conversation_ensure_lead()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
END $function$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY / TRIPWIRE — read-only, run any time. All six must be TRUE.
-- A FALSE means an older copy was re-run and stripped a P0 contract → re-run this.
-- ============================================================================
-- SELECT
--   pg_get_functiondef(p.oid) LIKE '%find_open_lead_id_by_phone%' AS p0_1_dedup,
--   pg_get_functiondef(p.oid) LIKE '%cadence_paused%'             AS p0_4_no_cascade,
--   pg_get_functiondef(p.oid) LIKE '%NEW.location_id%'            AS phase168_location,
--   pg_get_functiondef(p.oid) LIKE '%''WhatsApp''%'               AS source_whatsapp,
--   pg_get_functiondef(p.oid) LIKE '%inbound_leads%'              AS routing_audit_queue,
--   pg_get_functiondef(p.oid) LIKE '%EXCEPTION WHEN OTHERS%'      AS never_break_store
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = 'campaign_conversation_ensure_lead';
