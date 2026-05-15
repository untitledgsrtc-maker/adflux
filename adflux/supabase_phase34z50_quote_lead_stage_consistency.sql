-- =====================================================================
-- Phase 34Z.50 — close two quote→lead consistency gaps
-- 15 May 2026
--
-- Two gotchas surfaced in the lead-lifecycle audit (15 May 2026):
--
-- #1  QuoteSent stage doesn't roll back when a quote is deleted.
--     leads.quote_id keeps pointing at a missing row, stage stays
--     'QuoteSent' forever. Rep can't tell from the list that the
--     quote was nuked.
--
-- #2  Phase 34Q trigger only fires on UPDATE of quotes.status. If a
--     quote is INSERTed with status already 'won' / 'lost' (rare —
--     happens on admin manual seed or some imports), the lead never
--     gets promoted. lead.quote_id is set by the JSX after-insert
--     hook, but the stage stays at QuoteSent.
--
-- Both fixes are AFTER-row triggers on public.quotes. Idempotent.
-- =====================================================================

-- ─── 1. Reuse the propagation function for INSERT too ────────────────
-- The existing function quote_status_propagate_to_lead() was written
-- for AFTER UPDATE (Phase 34Q). It bails when OLD.status IS NOT
-- DISTINCT FROM NEW.status, which never matches on INSERT. Wrap it
-- in a separate INSERT-side trigger function so a quote that arrives
-- already-won propagates.

CREATE OR REPLACE FUNCTION public.quote_status_propagate_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.lead_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'won' THEN
    UPDATE public.leads
       SET stage          = 'Won',
           expected_value = COALESCE(NEW.total_amount, expected_value),
           updated_at     = now()
     WHERE id = NEW.lead_id
       AND stage NOT IN ('Won', 'Lost');
  ELSIF NEW.status = 'lost' THEN
    UPDATE public.leads
       SET stage       = 'Lost',
           lost_reason = COALESCE(lost_reason, 'NoNeed'),
           updated_at  = now()
     WHERE id = NEW.lead_id
       AND stage NOT IN ('Won', 'Lost');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_quote_status_propagate_ins ON public.quotes;
CREATE TRIGGER trg_quote_status_propagate_ins
  AFTER INSERT ON public.quotes
  FOR EACH ROW
  EXECUTE FUNCTION public.quote_status_propagate_on_insert();


-- ─── 2. Roll back lead stage when its quote is deleted ───────────────
-- Strategy:
--   • If the deleted quote is the one referenced by leads.quote_id:
--       - Look for ANOTHER non-Won/Lost quote on the same lead; if
--         one exists, repoint quote_id at it (the most recent).
--       - Otherwise clear quote_id and, if the lead is still at
--         'QuoteSent', demote to 'Working' (the realistic prior
--         stage). Won / Lost / Nurture / New stay put — deleting a
--         quote doesn't undo a paid deal or reverse a Lost call.

CREATE OR REPLACE FUNCTION public.quote_after_delete_rollback_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next_quote uuid;
  v_lead_stage text;
BEGIN
  IF OLD.lead_id IS NULL THEN
    RETURN OLD;
  END IF;

  -- Find the most-recent surviving quote on the same lead, if any.
  SELECT q.id INTO v_next_quote
    FROM public.quotes q
   WHERE q.lead_id = OLD.lead_id
     AND q.id <> OLD.id
   ORDER BY q.created_at DESC
   LIMIT 1;

  -- Repoint or clear lead.quote_id when it pointed at the deleted row.
  UPDATE public.leads
     SET quote_id = v_next_quote,
         updated_at = now()
   WHERE id = OLD.lead_id
     AND quote_id = OLD.id;

  -- If there are no surviving quotes and the lead is still at
  -- 'QuoteSent', demote to 'Working'. Anything else (Won/Lost/Nurture/
  -- New) stays.
  IF v_next_quote IS NULL THEN
    SELECT stage INTO v_lead_stage FROM public.leads WHERE id = OLD.lead_id;
    IF v_lead_stage = 'QuoteSent' THEN
      UPDATE public.leads
         SET stage = 'Working',
             updated_at = now()
       WHERE id = OLD.lead_id;
    END IF;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_quote_after_delete_rollback_lead ON public.quotes;
CREATE TRIGGER trg_quote_after_delete_rollback_lead
  AFTER DELETE ON public.quotes
  FOR EACH ROW
  EXECUTE FUNCTION public.quote_after_delete_rollback_lead();


NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────────
-- Both triggers should exist after the run.
SELECT
  (SELECT count(*) FROM pg_trigger
    WHERE tgname = 'trg_quote_status_propagate_ins')         AS ins_trigger,
  (SELECT count(*) FROM pg_trigger
    WHERE tgname = 'trg_quote_after_delete_rollback_lead')   AS del_trigger;
