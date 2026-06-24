-- =====================================================================
-- Phase 119 — "every deal = a lead": auto-attach a lead to every quote
-- 2026-06-06
--
-- OWNER DIRECTIVE
--   Funnel completeness + unambiguous credit. Today a rep can make a
--   quote WITHOUT a lead (standalone / walk-in / repeat client) — 17
--   such orphan quotes exist (₹1.15 Cr, 8 won). Those deals never show
--   in the lead → quote → won funnel, and credit rides on the quote's
--   name field instead of a lead owner.
--
--   Decision: every quote should carry a lead. If a lead already exists
--   for the phone, LINK to it. If not, CREATE one — SILENTLY (no chase
--   follow-ups; owner picked "no chase" for direct/walk-in deals).
--
-- WHAT THIS FILE DOES
--   1. BEFORE INSERT trigger on quotes — for any quote inserted with
--      lead_id NULL: find an existing OPEN lead by phone and link it,
--      else create a fresh lead and link it. Then set NEW.lead_id.
--   2. One-time backfill of the existing orphan quotes (same logic).
--
-- WHY A TRIGGER (not 4 wizard edits)
--   One trigger covers ALL quote-creation paths (Private LED, Other
--   Media, Auto Hood, GSRTC, and any future wizard) — DRY, and it can't
--   be forgotten in a new wizard. The §28-frozen wizard files are NOT
--   touched.
--
-- SAFETY — quote creation must NEVER break (CLAUDE.md §45, money flow)
--   • Normal quote (lead_id already set) → the trigger no-ops on the
--     first IF. The common path pays a single boolean check. Zero new
--     load on the hot path.
--   • The orphan branch is wrapped in BEGIN…EXCEPTION WHEN OTHERS. If
--     ANYTHING fails (dup-phone block, RLS, bad data), the quote still
--     saves exactly as today (lead_id stays NULL) — graceful, never a
--     rollback of the quote.
--   • Dup-phone block avoidance: we LINK via the SAME
--     find_open_lead_id_by_phone() the Phase 34W block uses, and only
--     INSERT a lead when it returns NULL — so the block can never fire.
--   • leads.quote_id is FK→quotes(id); in a BEFORE INSERT the quote row
--     doesn't exist yet, so we do NOT set it (the authoritative link is
--     quote.lead_id, set on NEW). The backfill (quote already exists)
--     DOES set both directions.
--
-- NO CHASE (owner directive)
--   The auto-created lead is inserted with cadence_paused = true. The
--   Phase 33D.6 lead-create trigger early-returns on cadence_paused
--   (line 148) → it spawns NO follow-ups of any kind. Walk-in / repeat
--   deals get a lead in the funnel, but no reminder cadence.
--
-- Idempotent. Re-run safe (backfill only touches still-orphan quotes).
-- =====================================================================

-- ─── 1. Trigger function: ensure every quote has a lead ─────────────
-- -------------------------------------------------------------------------
-- quote_before_insert_ensure_lead REMOVED from this file (Phase 178). Canonical: db/functions/quote_before_insert_ensure_lead.sql
-- Do NOT re-add (§71). Trigger wiring stays.
-- -------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_quote_before_insert_ensure_lead ON public.quotes;
CREATE TRIGGER trg_quote_before_insert_ensure_lead
  BEFORE INSERT ON public.quotes
  FOR EACH ROW
  EXECUTE FUNCTION public.quote_before_insert_ensure_lead();


-- ─── 2. One-time backfill of the existing orphan quotes ─────────────
-- Same find-or-create logic, per-quote exception-wrapped so one bad row
-- can't abort the whole pass. Quote already exists here, so we CAN set
-- leads.quote_id (the back-pointer) too.
DO $$
DECLARE
  q          record;
  v_existing uuid;
  v_new      uuid;
  v_stage    text;
BEGIN
  FOR q IN SELECT * FROM public.quotes WHERE lead_id IS NULL LOOP
    BEGIN
      IF q.created_by IS NULL
         OR q.client_phone IS NULL
         OR length(regexp_replace(q.client_phone, '\D', '', 'g')) < 10 THEN
        CONTINUE;
      END IF;

      v_existing := public.find_open_lead_id_by_phone(q.client_phone);
      IF v_existing IS NOT NULL THEN
        UPDATE public.quotes SET lead_id = v_existing WHERE id = q.id AND lead_id IS NULL;
        UPDATE public.leads  SET quote_id = q.id      WHERE id = v_existing AND quote_id IS NULL;
        CONTINUE;
      END IF;

      v_stage := CASE q.status
                   WHEN 'won'  THEN 'Won'
                   WHEN 'lost' THEN 'Lost'
                   ELSE 'QuoteSent'
                 END;

      INSERT INTO public.leads (
        name, phone, company, segment, source, stage,
        assigned_to, created_by, heat, cadence_paused, expected_value, quote_id
      ) VALUES (
        COALESCE(NULLIF(btrim(q.client_name), ''), 'Direct quote'),
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
      RAISE WARNING '[phase119-backfill] skipped quote %: %', q.id, SQLERRM;
    END;
  END LOOP;
END $$;


NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────────
-- trigger present; orphans should drop to only the unsalvageable ones
-- (no phone / no owner); direct-quote leads now exist.
SELECT
  (SELECT count(*) FROM pg_trigger
    WHERE tgname = 'trg_quote_before_insert_ensure_lead')          AS trigger_present,
  (SELECT count(*) FROM public.quotes WHERE lead_id IS NULL)        AS remaining_orphans,
  (SELECT count(*) FROM public.leads  WHERE source = 'Direct Quote') AS direct_quote_leads;

SELECT 'Phase 119 every-deal-a-lead applied' AS status;
