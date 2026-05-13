-- =====================================================================
-- Phase 34Q — propagate quote.status='won' / 'lost' to leads.stage
-- 13 May 2026
--
-- WHY
--
-- Owner reported: clicked "Mark Won" on a quote, the quote flipped
-- to 'won', but the originating lead stayed in 'QuoteSent' /
-- 'Working' and kept showing up in the rep's follow-up list. The
-- rep then had to manually open the lead and change the stage too.
-- Two-step Won = friction + every rep forgets the second step.
--
-- Phase 14 wired the FORWARD link (lead -> quote on create), but
-- never the BACKWARD link (quote status flip -> lead stage flip).
--
-- WHAT THIS MIGRATION DOES
--
-- Adds AFTER UPDATE trigger on quotes:
--   * When quote.status flips to 'won' AND quote has lead_id AND
--     lead.stage is NOT already Won/Lost → set lead.stage = 'Won'.
--   * When quote.status flips to 'lost' AND quote has lead_id AND
--     lead.stage is NOT already Won/Lost → set lead.stage = 'Lost',
--     lost_reason = 'NoNeed' (default; rep can re-edit).
--
-- Only fires on actual status transitions (NEW.status DISTINCT FROM
-- OLD.status) so non-status edits don't churn the lead.
--
-- Won/Lost are terminal — once the lead is there, it stays unless a
-- human re-opens it via the lead detail page.
--
-- Idempotent. No backfill (existing won/lost quotes left as-is —
-- some leads may have been intentionally split off).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.quote_status_propagate_to_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only act on real status transitions.
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- Skip if no lead linked.
  IF NEW.lead_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'won' THEN
    UPDATE public.leads
       SET stage      = 'Won',
           updated_at = now()
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

DROP TRIGGER IF EXISTS trg_quote_status_propagate_to_lead ON public.quotes;
CREATE TRIGGER trg_quote_status_propagate_to_lead
  AFTER UPDATE ON public.quotes
  FOR EACH ROW
  EXECUTE FUNCTION public.quote_status_propagate_to_lead();


NOTIFY pgrst, 'reload schema';


-- ─── VERIFY ──────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM pg_proc
    WHERE proname='quote_status_propagate_to_lead') AS function_exists,
  (SELECT count(*) FROM pg_trigger
    WHERE tgname='trg_quote_status_propagate_to_lead') AS trigger_exists;
