-- =====================================================================
-- PHASE 144 — "every deal = a lead" now covers GOVERNMENT quotes too
-- 2026-06-12
--
-- Owner: "we had a rule that any direct quote creates a lead — now it's
-- not showing." Diagnosis: it works for PRIVATE but never for GOVERNMENT.
--
-- ROOT CAUSE (Phase 119 trigger quote_before_insert_ensure_lead):
--   The trigger required a valid 10-digit phone (its line 77-79) before
--   creating a lead. Government proposals have NO contact phone — the
--   recipient is a DEPARTMENT, and the govt wizard's "Contact Phone" is
--   optional (left blank). So the phone gate silently skipped every govt
--   quote → govt quotes never got a lead, while private (phone entered)
--   did. Not a regression — the gate just never let govt through.
--
-- FIX (this file):
--   • Relax the trigger: only DEDUP-by-phone when a usable phone exists
--     (unchanged for private). When there's no phone, SKIP the dedup and
--     still CREATE a lead (leads.phone is nullable — verified phase12
--     line 110). So EVERY direct quote lands in the funnel, govt included.
--   • Govt leads are named after the DEPARTMENT (client_company), not the
--     "પ્રતિ,/Respected Sir," salutation that govt quotes put in
--     client_name. Private leads keep using client_name (the contact
--     person) — behaviour byte-unchanged.
--   • One-time backfill of the existing phone-less orphan quotes (govt +
--     any private walk-in without a phone).
--
-- §45 / §28-safe:
--   • CREATE OR REPLACE of the SAME function the existing trigger points
--     at — no trigger drop, no contract removed. Still SECURITY DEFINER,
--     still pg_temp-hardened, still DOUBLE EXCEPTION-wrapped → a quote
--     save can NEVER fail on lead housekeeping.
--   • find_open_lead_id_by_phone() is only called WITH a valid phone, so
--     the Phase 34W dup-phone block still cannot fire (we link, not
--     insert, when a phone matches).
--   • New govt leads insert cadence_paused=true → Phase 33D.6 spawns NO
--     follow-up chase (owner's "no chase on direct deals" rule, kept).
--   • assigned_to = creator (non-NULL) → the round-robin auto-assign
--     can't hijack it. segment set from the quote → tagged for Phase 142.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.quote_before_insert_ensure_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing  uuid;
  v_new       uuid;
  v_stage     text;
  v_owner     uuid := NEW.created_by;
  v_has_phone boolean;
  v_name      text;
BEGIN
  -- Normal path: quote already linked to a lead → no-op, zero cost.
  IF NEW.lead_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Orphan path — wrapped so a failure here can NEVER block the quote.
  BEGIN
    -- Still need a real owner to attach a lead to.
    IF v_owner IS NULL THEN
      RETURN NEW;
    END IF;

    v_has_phone := NEW.client_phone IS NOT NULL
                   AND length(regexp_replace(NEW.client_phone, '\D', '', 'g')) >= 10;

    -- Phase 144 — dedup ONLY when we have a usable phone (unchanged for
    -- private). With a phone, link to an existing open lead; the dup-phone
    -- block can't fire because we link, never insert, on a match.
    IF v_has_phone THEN
      v_existing := public.find_open_lead_id_by_phone(NEW.client_phone);
      IF v_existing IS NOT NULL THEN
        NEW.lead_id := v_existing;
        RETURN NEW;
      END IF;
    END IF;

    -- No open lead (or no phone) → create one, SILENTLY (cadence_paused).
    v_stage := CASE NEW.status
                 WHEN 'won'  THEN 'Won'
                 WHEN 'lost' THEN 'Lost'
                 ELSE 'QuoteSent'
               END;

    -- Govt quotes store the salutation in client_name and the department
    -- in client_company → name the lead after the department. Private
    -- keeps client_name (the contact person) — unchanged.
    v_name := CASE
                WHEN NEW.segment = 'GOVERNMENT'
                  THEN COALESCE(NULLIF(btrim(NEW.client_company), ''),
                               NULLIF(btrim(NEW.client_name), ''),
                               'Govt proposal')
                ELSE COALESCE(NULLIF(btrim(NEW.client_name), ''), 'Direct quote')
              END;

    INSERT INTO public.leads (
      name, phone, company, segment, source, stage,
      assigned_to, created_by, heat, cadence_paused, expected_value
    ) VALUES (
      v_name,
      NEW.client_phone,                              -- may be NULL (govt)
      NULLIF(btrim(NEW.client_company), ''),
      COALESCE(NEW.segment, 'PRIVATE'),
      'Direct Quote',
      v_stage,
      v_owner, v_owner, 'cold', true, NEW.total_amount
    )
    RETURNING id INTO v_new;

    NEW.lead_id := v_new;
    RETURN NEW;

  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[quote_ensure_lead] skipped for quote % (phone %): %',
      NEW.id, NEW.client_phone, SQLERRM;
    RETURN NEW;
  END;
END $$;

-- Trigger already exists (Phase 119) and points at this function name —
-- CREATE OR REPLACE above swaps the body in place. No trigger churn.


-- ─── One-time backfill — phone-less orphan quotes (govt + walk-ins) ──
DO $$
DECLARE
  q          record;
  v_existing uuid;
  v_new      uuid;
  v_stage    text;
  v_has_phone boolean;
  v_name     text;
BEGIN
  FOR q IN SELECT * FROM public.quotes
            WHERE lead_id IS NULL AND created_by IS NOT NULL LOOP
    BEGIN
      v_has_phone := q.client_phone IS NOT NULL
                     AND length(regexp_replace(q.client_phone, '\D', '', 'g')) >= 10;

      IF v_has_phone THEN
        v_existing := public.find_open_lead_id_by_phone(q.client_phone);
        IF v_existing IS NOT NULL THEN
          UPDATE public.quotes SET lead_id = v_existing WHERE id = q.id AND lead_id IS NULL;
          UPDATE public.leads  SET quote_id = q.id      WHERE id = v_existing AND quote_id IS NULL;
          CONTINUE;
        END IF;
      END IF;

      v_stage := CASE q.status
                   WHEN 'won'  THEN 'Won'
                   WHEN 'lost' THEN 'Lost'
                   ELSE 'QuoteSent'
                 END;

      v_name := CASE
                  WHEN q.segment = 'GOVERNMENT'
                    THEN COALESCE(NULLIF(btrim(q.client_company), ''),
                                 NULLIF(btrim(q.client_name), ''),
                                 'Govt proposal')
                  ELSE COALESCE(NULLIF(btrim(q.client_name), ''), 'Direct quote')
                END;

      INSERT INTO public.leads (
        name, phone, company, segment, source, stage,
        assigned_to, created_by, heat, cadence_paused, expected_value, quote_id
      ) VALUES (
        v_name,
        q.client_phone,
        NULLIF(btrim(q.client_company), ''),
        COALESCE(q.segment, 'PRIVATE'),
        'Direct Quote',
        v_stage,
        q.created_by, q.created_by, 'cold', true, q.total_amount, q.id
      )
      RETURNING id INTO v_new;

      UPDATE public.quotes SET lead_id = v_new WHERE id = q.id AND lead_id IS NULL;

    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[phase144-backfill] skipped quote %: %', q.id, SQLERRM;
    END;
  END LOOP;
END $$;


-- self-register
DO $$
BEGIN
  IF to_regclass('public.applied_migrations') IS NOT NULL THEN
    INSERT INTO public.applied_migrations (name, note)
    VALUES ('supabase_phase144_govt_quote_creates_lead.sql',
            'every-deal-a-lead now covers phone-less (government) quotes + backfill')
    ON CONFLICT (name) DO NOTHING;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';


-- ─── VERIFY — orphans should drop to only owner-less quotes ──────────
SELECT
  (SELECT count(*) FROM pg_trigger
     WHERE tgname='trg_quote_before_insert_ensure_lead')              AS trigger_present,
  (SELECT count(*) FROM public.quotes WHERE lead_id IS NULL)          AS remaining_orphans,
  (SELECT count(*) FROM public.quotes
     WHERE lead_id IS NULL AND created_by IS NOT NULL)                AS fixable_orphans_left,
  (SELECT count(*) FROM public.quotes q JOIN public.leads l ON l.id=q.lead_id
     WHERE q.segment='GOVERNMENT')                                    AS govt_quotes_with_lead;

SELECT 'Phase 144 govt-quote-creates-lead applied' AS status;
