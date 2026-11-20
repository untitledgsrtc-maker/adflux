-- ============================================================================
-- db/functions/tg_push_on_followup_due.sql - CANONICAL HOME (section 71). Captured
-- from live 20-11-2026 (Phase 34Z.55 per-task push, FROZEN contract) + Phase 636:
-- skips during a bulk reassign (app.bulk_reassign = 'on', set by reassign_leads_bulk).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tg_push_on_followup_due()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_lead   record;
  v_title  text;
  v_body   text;
BEGIN
  -- Phase 636: a bulk reassign (>20 leads) sends ONE summary push instead of one per follow-up.
  IF COALESCE(current_setting('app.bulk_reassign', true), '') = 'on' THEN RETURN NEW; END IF;
  IF NEW.assigned_to IS NULL OR NEW.is_done IS TRUE THEN RETURN NEW; END IF;
  IF NEW.follow_up_date IS NULL OR NEW.follow_up_date > CURRENT_DATE THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.follow_up_date IS NOT NULL
       AND OLD.follow_up_date <= CURRENT_DATE
       AND OLD.is_done = NEW.is_done THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Phase 61.4 — quiet hours.
  IF NOT public.is_push_allowed_now() THEN RETURN NEW; END IF;

  SELECT id, name, company, phone INTO v_lead
    FROM public.leads WHERE id = NEW.lead_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  v_title := 'Follow-up · ' || COALESCE(v_lead.name, v_lead.company, 'lead');
  v_body  := COALESCE(NEW.note,
                      'Due ' || to_char(NEW.follow_up_date, 'DD Mon'));

  PERFORM public.enqueue_push(
    NEW.assigned_to, v_title, v_body,
    '/leads/' || v_lead.id::text,
    'fu-' || NEW.id::text
  );
  RETURN NEW;
END $function$;

NOTIFY pgrst, 'reload schema';
-- VERIFY: SELECT pg_get_functiondef('public.tg_push_on_followup_due()'::regprocedure) LIKE '%app.bulk_reassign%';  -- t
