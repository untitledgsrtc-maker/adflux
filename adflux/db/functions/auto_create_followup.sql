-- ============================================================================
-- db/functions/auto_create_followup.sql - CANONICAL HOME (section 71: one definition)
-- ============================================================================
-- Trigger quotes_auto_followup (AFTER INSERT OR UPDATE on quotes).
-- When a quote becomes 'sent' it adds a quote-linked follow-up 3 days later and
-- (Phase 625) a 5-minute + next-day check, unless the lead's quote_chase is running.
-- Phase 625 (19-11-2026, owner): skipped when the quote's lead already has OPEN
--   quote_chase rows (5 min, next day, day 2...30 - spawn_quote_chase_cadence), so
--   the rep no longer gets a duplicate reminder. Still fires for a quote with no lead,
--   or a 2nd quote on a lead whose chases are over (guardian 625 finding 2).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.auto_create_followup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_soon timestamp := (now() + interval '5 minutes') AT TIME ZONE 'Asia/Kolkata';
  v_cad  text := CASE WHEN NEW.lead_id IS NOT NULL THEN 'quote_chase' END;
  v_seq  int  := CASE WHEN NEW.lead_id IS NOT NULL THEN 0 END;
BEGIN
  IF NEW.status = 'sent' AND (OLD.status IS NULL OR OLD.status != 'sent')
     AND (NEW.lead_id IS NULL
          OR NOT EXISTS (SELECT 1 FROM public.follow_ups f
                          WHERE f.lead_id = NEW.lead_id AND f.cadence_type = 'quote_chase' AND f.is_done = false)) THEN
    -- Phase 625: the owner's "quote sent -> 5 min -> next day" for quotes whose lead has
    -- no chase running (148 of 158 quotes in Oct-Nov 2026 never got lead chases: the lead
    -- was already QuoteSent - Direct Quote leads, 2nd quotes). Same rules as the lead path.
    IF EXTRACT(HOUR FROM v_soon) BETWEEN 9 AND 20 AND EXTRACT(DOW FROM v_soon) <> 0 THEN
      INSERT INTO public.follow_ups (quote_id, lead_id, assigned_to, follow_up_date, follow_up_time, note, auto_generated, sequence, cadence_type, action_hint)
      VALUES (NEW.id, NEW.lead_id, NEW.created_by, v_soon::date, date_trunc('minute', v_soon)::time,
              'Auto: Quote sent - check they got it', true, v_seq, v_cad, 'Confirm the quote reached them');
    END IF;
    INSERT INTO public.follow_ups (quote_id, lead_id, assigned_to, follow_up_date, follow_up_time, note, auto_generated, sequence, cadence_type, action_hint)
    VALUES (NEW.id, NEW.lead_id, NEW.created_by, public.next_workday((now() AT TIME ZONE 'Asia/Kolkata')::date + 1), '10:00:00',
            'Auto: Next-day check on the quote', true, v_seq, v_cad, 'Any questions on the quote?');
    INSERT INTO public.follow_ups (quote_id, assigned_to, follow_up_date, note)
    VALUES (
      NEW.id,
      NEW.created_by,
      (now() + INTERVAL '3 days')::date,
      'Auto follow-up after quote sent'
    );
  END IF;
  RETURN NEW;
END;
$function$;

NOTIFY pgrst, 'reload schema';

-- VERIFY: SELECT pg_get_functiondef('public.auto_create_followup()'::regprocedure) LIKE '%quote_chase%';  -- t
