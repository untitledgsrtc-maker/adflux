-- ============================================================================
-- db/functions/lead_activity_sync_followup.sql — CANONICAL HOME, DORMANT (Phase 334)
-- ============================================================================
--
-- ⛔ DORMANT: NO trigger calls this function. Phase 88.4 folded its logic into
--    lead_activity_aftermath() (step 5) and dropped trg_lead_activity_sync_followup.
--    It is kept ONLY because phase88_4's rollback note + supabase_phase34_followup_consolidation.sql
--    still reference it. DO NOT attach it to a trigger: it would double-write follow-ups.
--
-- WHY IT IS HERE: it carried the SAME wrong owner rule as lead_activity_aftermath
--    (COALESCE(assigned_to, activity author) — no telecaller_id). Phase 334 fixed it to
--    assigned_to -> telecaller_id -> author so a re-attach (rollback, or someone re-running
--    phase34) can never reintroduce the wrong-owner bug. Single signature (trigger fn).
-- SUPERSEDES: supabase_phase34_followup_consolidation.sql (function body removed there; the
--    trigger wiring in that file is untouched).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lead_activity_sync_followup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_owner uuid;
  v_existing uuid;
BEGIN
  IF NEW.next_action_date IS NULL THEN
    RETURN NEW;
  END IF;

  -- Owner of the follow-up: the lead's current assignee, then its telecaller (a
  -- telecaller-owned lead has assigned_to NULL), then the activity's author so a
  -- follow-up never lands without someone to action it.   (Phase 334)
  SELECT COALESCE(l.assigned_to, l.telecaller_id, NEW.created_by)
    INTO v_owner
    FROM public.leads l
   WHERE l.id = NEW.lead_id;

  IF v_owner IS NULL THEN
    RETURN NEW;
  END IF;

  -- Try to update an existing open follow-up first.
  SELECT id INTO v_existing
    FROM public.follow_ups
   WHERE lead_id = NEW.lead_id
     AND is_done = false
   ORDER BY follow_up_date ASC
   LIMIT 1;

  IF v_existing IS NOT NULL THEN
    UPDATE public.follow_ups
       SET follow_up_date = NEW.next_action_date,
           assigned_to    = v_owner,
           note           = COALESCE(NEW.notes, note)
     WHERE id = v_existing;
  ELSE
    INSERT INTO public.follow_ups (
      lead_id, assigned_to, follow_up_date, follow_up_time,
      note, auto_generated
    ) VALUES (
      NEW.lead_id,
      v_owner,
      NEW.next_action_date,
      '10:00:00',
      COALESCE(NEW.notes, 'Follow up'),
      true
    );
  END IF;

  RETURN NEW;
END;
$function$;

NOTIFY pgrst, 'reload schema';

-- VERIFY (read-only): SELECT pg_get_functiondef(p.oid) LIKE '%l.assigned_to, l.telecaller_id, NEW.created_by%' AS p334_owner_chain,
--   NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgfoid = p.oid AND NOT t.tgisinternal) AS still_dormant
--   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='lead_activity_sync_followup';
