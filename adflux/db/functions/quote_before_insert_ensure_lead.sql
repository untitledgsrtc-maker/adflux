-- ============================================================================
-- db/functions/quote_before_insert_ensure_lead.sql — CANONICAL HOME (Phase 178 / Stage 2)
-- ============================================================================
-- ⭐ The ONE place quote_before_insert_ensure_lead lives (§71). Was in phase119 + phase144.
-- WHAT: BEFORE-INSERT trigger on quotes. "Every deal is a lead" — if a quote has no
--   lead_id, dedup by phone (attach) or create a new lead and link it. Covers Private
--   (client_name) AND Government (phone-less; named after client_company, §144).
-- 🔒 LOCKED CONTRACTS (§119 + §144):
--   • §144 — NO PHONE GATE. dedup runs ONLY when client_phone has >=10 digits; with
--     NO phone it SKIPS dedup and STILL creates the lead (govt proposals have no
--     contact phone). DO NOT re-add `IF phone IS NULL THEN RETURN` — that regression
--     stops every govt quote landing in the funnel (§64).
--   • dedup via find_open_lead_id_by_phone → attach (never collide, never reassign).
--   • new lead: stage from quote status (won/lost/QuoteSent), name = govt→company /
--     private→name, assigned_to=created_by, cadence_paused=true (no chase), heat cold.
--   • DOUBLE EXCEPTION-wrapped — a quote save can NEVER fail on lead housekeeping.
-- PROVENANCE: live dump 2026-06-24 (phase144 body). Trigger wiring in phase files.
-- SUPERSEDES: supabase_phase119_every_deal_a_lead.sql · supabase_phase144_govt_quote_creates_lead.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.quote_before_insert_ensure_lead()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_existing uuid; v_new uuid; v_stage text;
  v_owner uuid := NEW.created_by; v_has_phone boolean; v_name text;
BEGIN
  IF NEW.lead_id IS NOT NULL THEN RETURN NEW; END IF;
  BEGIN
    IF v_owner IS NULL THEN RETURN NEW; END IF;
    v_has_phone := NEW.client_phone IS NOT NULL
                   AND length(regexp_replace(NEW.client_phone, '\D', '', 'g')) >= 10;
    IF v_has_phone THEN
      v_existing := public.find_open_lead_id_by_phone(NEW.client_phone);
      IF v_existing IS NOT NULL THEN NEW.lead_id := v_existing; RETURN NEW; END IF;
    END IF;
    v_stage := CASE NEW.status WHEN 'won' THEN 'Won' WHEN 'lost' THEN 'Lost' ELSE 'QuoteSent' END;
    v_name := CASE WHEN NEW.segment = 'GOVERNMENT'
                THEN COALESCE(NULLIF(btrim(NEW.client_company),''), NULLIF(btrim(NEW.client_name),''), 'Govt proposal')
                ELSE COALESCE(NULLIF(btrim(NEW.client_name),''), 'Direct quote') END;
    INSERT INTO public.leads (name, phone, company, segment, source, stage,
      assigned_to, created_by, heat, cadence_paused, expected_value)
    VALUES (v_name, NEW.client_phone, NULLIF(btrim(NEW.client_company),''),
      COALESCE(NEW.segment,'PRIVATE'), 'Direct Quote', v_stage,
      v_owner, v_owner, 'cold', true, NEW.total_amount)
    RETURNING id INTO v_new;
    NEW.lead_id := v_new; RETURN NEW;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[quote_ensure_lead] skipped %: %', NEW.id, SQLERRM; RETURN NEW;
  END;
END $function$;

NOTIFY pgrst, 'reload schema';
-- VERIFY: LIKE '%find_open_lead_id_by_phone%' AND '%GOVERNMENT%' AND '%cadence_paused%'
--         AND '%v_has_phone%' (the §144 phone-optional gate) — all TRUE.
