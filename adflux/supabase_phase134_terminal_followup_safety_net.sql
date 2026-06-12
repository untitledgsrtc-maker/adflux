-- =====================================================================
-- PHASE 134 — terminal-state follow-up leaks: heal + standing safety-net
-- 2026-06-12
--
-- Owner: "lost lead / lost quote / won+paid still show in follow-up."
-- Live counts were tiny (1 / 0 / 0) — today's heals already swept most.
-- But the structural holes are real; close them so it can't recur.
--
-- The system intent (Phase 76.3 trg_z_close_followups_on_terminal): a
-- lead reaching Lost/Won has ZERO open follow_ups. It fires on the lead
-- stage transition and closes all LEAD-TIED rows. Two gaps remain:
--
--  GAP 1 — payment-collection FUs are LEAD-BLIND. Phase 33G spawns them
--    with quote_id only (lead_id NULL), so the terminal-close
--    (WHERE lead_id = NEW.id) never matches → a Lost lead / Lost quote
--    keeps its payment reminder open.
--  GAP 2 — ORPHAN quotes (lead_id NULL, pre-Phase-119) won/lost don't
--    propagate to any lead (quote_status_propagate_to_lead bails on
--    NULL lead_id) → the quote's chase + payment FUs never close.
--
-- FIX (additive, §45-safe — both triggers fire ONLY on a status/stage
-- transition, never on a normal quote/lead edit; no push, no cadence
-- type, no compute_daily_score touched; EXCEPTION-wrapped so a quote /
-- lead save can NEVER fail on follow-up housekeeping):
--
--  A. quote status -> won/lost closes that quote's own follow_ups
--     (keyed on quote_id → covers orphan quotes too). On LOST: close
--     chase + payment (dead deal). On WON: close chase only, KEEP
--     payment (rep still collects until fully paid — owner's choice).
--  B. lead stage -> Lost closes payment-collection FUs for that lead's
--     quotes (the lead-blind gap, for leads marked Lost directly, not
--     via a quote). Won leaves payment open (collect the money).
--  + one-time heal of the existing backlog.
-- =====================================================================


-- ─── A. Quote won/lost closes its own follow-ups ─────────────────────
CREATE OR REPLACE FUNCTION public.quote_terminal_close_followups()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  -- EXCEPTION-wrapped: a quote save must never fail on FU housekeeping.
  BEGIN
    IF NEW.status = 'lost' THEN
      -- Dead deal: close every open follow_up tied to this quote
      -- (quote_chase + payment-collection), lead_id-agnostic.
      UPDATE public.follow_ups
         SET is_done   = true,
             done_at   = COALESCE(done_at, now()),
             done_note = COALESCE(done_note, 'Auto-closed: quote lost (Phase 134)')
       WHERE quote_id = NEW.id
         AND is_done = false;
    ELSIF NEW.status = 'won' THEN
      -- Won: stop chasing the quote, but KEEP payment-collection open
      -- (rep collects until fully paid — closes via Phase 130 §4).
      UPDATE public.follow_ups
         SET is_done   = true,
             done_at   = COALESCE(done_at, now()),
             done_note = COALESCE(done_note, 'Auto-closed: quote won (Phase 134)')
       WHERE quote_id = NEW.id
         AND is_done = false
         AND COALESCE(note, '') NOT LIKE 'Payment collection%';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'quote_terminal_close_followups skipped for quote %: %',
                  NEW.id, SQLERRM;
  END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_quote_terminal_close_followups ON public.quotes;
CREATE TRIGGER trg_quote_terminal_close_followups
  AFTER UPDATE OF status ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.quote_terminal_close_followups();


-- ─── B. Lead -> Lost closes its quotes' payment-collection FUs ───────
-- (lead-blind gap, for a lead marked Lost directly. Won leaves payment
-- FUs open — collect. Lead-tied FUs are already closed by the Phase 76.3
-- terminal-close; this only adds the payment rows it can't reach.)
CREATE OR REPLACE FUNCTION public.lead_lost_close_payment_fu()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.stage <> 'Lost' OR OLD.stage IS NOT DISTINCT FROM NEW.stage THEN
    RETURN NEW;
  END IF;

  BEGIN
    UPDATE public.follow_ups fu
       SET is_done   = true,
           done_at   = COALESCE(fu.done_at, now()),
           done_note = COALESCE(fu.done_note, 'Auto-closed: lead lost (Phase 134)')
     WHERE fu.is_done = false
       AND fu.note LIKE 'Payment collection%'
       AND fu.quote_id IN (SELECT q.id FROM public.quotes q WHERE q.lead_id = NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'lead_lost_close_payment_fu skipped for lead %: %',
                  NEW.id, SQLERRM;
  END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_lead_lost_close_payment_fu ON public.leads;
CREATE TRIGGER trg_lead_lost_close_payment_fu
  AFTER UPDATE OF stage ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.lead_lost_close_payment_fu();


-- ─── One-time heal of the existing backlog ───────────────────────────
-- A) any open LEAD-TIED follow_up on a Lost/Won lead (enforces the
--    terminal-close intent on drifted rows — the live "1"), EXCEPT a
--    lost_nurture row on a Lost lead: closing that via is_done fires
--    truth1 followup_after_done which RE-SPAWNS lost_nurture while
--    stage='Lost' (guardian P1 — would re-leak). Those are DELETEd in
--    A2 instead (DELETE never fires the AFTER-UPDATE trigger — mirrors
--    Phase 76.3's own lost_nurture cleanup).
UPDATE public.follow_ups fu
   SET is_done   = true,
       done_at   = COALESCE(fu.done_at, now()),
       done_note = COALESCE(fu.done_note, 'Auto-closed: lead is terminal (Phase 134 heal)')
  FROM public.leads l
 WHERE l.id = fu.lead_id
   AND fu.is_done = false
   AND l.stage IN ('Lost', 'Won')
   AND NOT (l.stage = 'Lost' AND fu.cadence_type = 'lost_nurture');

-- A2) DELETE open lost_nurture rows on Lost leads (respawn-safe — a
--     DELETE bypasses followup_after_done; lost leads are meant to carry
--     zero open follow_ups per the Phase 76.3 terminal contract).
DELETE FROM public.follow_ups fu
 USING public.leads l
 WHERE l.id = fu.lead_id
   AND fu.is_done = false
   AND l.stage = 'Lost'
   AND fu.cadence_type = 'lost_nurture';

-- B) payment-collection FUs on a LOST quote OR a quote whose lead is
--    Lost (dead deal). WON-quote payment FUs are KEPT (collect).
UPDATE public.follow_ups fu
   SET is_done   = true,
       done_at   = COALESCE(fu.done_at, now()),
       done_note = COALESCE(fu.done_note, 'Auto-closed: deal lost (Phase 134 heal)')
  FROM public.quotes q
 WHERE q.id = fu.quote_id
   AND fu.is_done = false
   AND fu.note LIKE 'Payment collection%'
   AND (q.status = 'lost'
        OR EXISTS (SELECT 1 FROM public.leads l WHERE l.id = q.lead_id AND l.stage = 'Lost'));

-- C) quote_chase FUs on a LOST quote (quote-tied; orphan-safe).
UPDATE public.follow_ups fu
   SET is_done   = true,
       done_at   = COALESCE(fu.done_at, now()),
       done_note = COALESCE(fu.done_note, 'Auto-closed: quote lost (Phase 134 heal)')
  FROM public.quotes q
 WHERE q.id = fu.quote_id
   AND fu.is_done = false
   AND fu.cadence_type = 'quote_chase'
   AND q.status = 'lost';


-- self-register
DO $$
BEGIN
  IF to_regclass('public.applied_migrations') IS NOT NULL THEN
    INSERT INTO public.applied_migrations (name, note)
    VALUES ('supabase_phase134_terminal_followup_safety_net.sql',
            'Close FU leaks on lost/won quote + lost lead (payment-blind + orphan-quote gaps) + heal')
    ON CONFLICT (name) DO NOTHING;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';


-- ─── VERIFY — expect quote_trg=1, lead_trg=1, all 3 leak counts 0 ────
SELECT
  (SELECT count(*) FROM pg_trigger WHERE tgname='trg_quote_terminal_close_followups') AS quote_trg,
  (SELECT count(*) FROM pg_trigger WHERE tgname='trg_lead_lost_close_payment_fu')     AS lead_trg,
  (SELECT count(*) FROM public.follow_ups f JOIN public.leads l ON l.id=f.lead_id
     WHERE f.is_done=false AND l.stage IN ('Lost','Won'))                             AS open_lead_tied_on_terminal,
  (SELECT count(*) FROM public.follow_ups f JOIN public.quotes q ON q.id=f.quote_id
     WHERE f.is_done=false AND f.note LIKE 'Payment collection%' AND q.status='lost') AS payment_on_lost_quotes,
  (SELECT count(*) FROM public.follow_ups f JOIN public.quotes q ON q.id=f.quote_id
     WHERE f.is_done=false AND f.cadence_type='quote_chase' AND q.status='lost')      AS chase_on_lost_quotes;

SELECT 'Phase 134 terminal follow-up safety-net applied' AS status;
