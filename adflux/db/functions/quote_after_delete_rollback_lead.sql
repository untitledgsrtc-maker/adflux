-- ============================================================================
-- db/functions/quote_after_delete_rollback_lead.sql — CANONICAL HOME (Phase 178 / Stage 2)
-- ============================================================================
-- ⭐ The ONE place quote_after_delete_rollback_lead lives (§71). Was in phase34z50 + phase117.
-- WHAT: AFTER-DELETE trigger on quotes. Keeps the lead consistent when a quote is
--   deleted: repoint lead.quote_id to the most-recent surviving quote (or NULL); if
--   NONE survive and the lead was QuoteSent, demote it back to Working AND close its
--   now-orphaned quote_chase follow-ups.
-- 🔒 LOCKED: §34z50 repoint (newest surviving quote, else NULL) only where
--   lead.quote_id = OLD.id. §117 — on no-surviving-quote + QuoteSent: demote to
--   Working + close ONLY quote_chase FUs (never the lead's other rows), done_note
--   '[auto-closed: quote deleted, lead back to Working]'. DEFINER + EXCEPTION-safe path.
-- PROVENANCE: live dump 2026-06-24 (phase117 body). Trigger wiring in phase files.
-- SUPERSEDES: supabase_phase34z50_quote_lead_stage_consistency.sql · supabase_phase117_close_orphan_quote_chase.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.quote_after_delete_rollback_lead()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_next_quote uuid;
  v_lead_stage text;
BEGIN
  IF OLD.lead_id IS NULL THEN
    RETURN OLD;
  END IF;

  -- Most-recent surviving quote on the same lead, if any.
  SELECT q.id INTO v_next_quote
    FROM public.quotes q
   WHERE q.lead_id = OLD.lead_id
     AND q.id <> OLD.id
   ORDER BY q.created_at DESC
   LIMIT 1;

  -- Repoint or clear lead.quote_id when it pointed at the deleted row.
  UPDATE public.leads
     SET quote_id   = v_next_quote,
         updated_at = now()
   WHERE id = OLD.lead_id
     AND quote_id = OLD.id;

  -- No surviving quote: demote a QuoteSent lead back to Working AND
  -- close its now-orphaned quote-chase follow-ups (Phase 117 add).
  IF v_next_quote IS NULL THEN
    SELECT stage INTO v_lead_stage FROM public.leads WHERE id = OLD.lead_id;
    IF v_lead_stage = 'QuoteSent' THEN
      UPDATE public.leads
         SET stage      = 'Working',
             updated_at = now()
       WHERE id = OLD.lead_id;

      -- Phase 117 — the quote-chase cadence rows spawned at QuoteSent
      -- now chase a quote that was just deleted. Close them so they
      -- stop firing. quote_chase only — never the lead's other rows.
      UPDATE public.follow_ups
         SET is_done   = true,
             done_at   = now(),
             done_note = COALESCE(done_note, '')
                       || ' [auto-closed: quote deleted, lead back to Working]'
       WHERE lead_id      = OLD.lead_id
         AND is_done      = false
         AND cadence_type = 'quote_chase';
    END IF;
  END IF;

  RETURN OLD;
END;
$function$;

NOTIFY pgrst, 'reload schema';
-- VERIFY: LIKE '%quote_id   = v_next_quote%' AND '%stage      = ''Working''%' AND
--         '%cadence_type = ''quote_chase''%' AND '%auto-closed: quote deleted%'.
