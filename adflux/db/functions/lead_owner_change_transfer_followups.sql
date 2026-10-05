-- ============================================================================
-- db/functions/lead_owner_change_transfer_followups.sql — CANONICAL HOME (Phase 334)
-- ============================================================================
--
-- ⭐ The ONE place lead_owner_change_transfer_followups is allowed to live (§71/§72).
--    Before this it lived only in supabase_phase130_push_hygiene.sql (body now a pointer).
--
-- WHAT IT DOES: AFTER UPDATE OF assigned_to, telecaller_id ON leads (trg_lead_owner_change_transfer_fu,
--    wiring stays in phase130). When a lead's owner really changes (reassign RPC, inbox write, any
--    admin edit) the lead's OPEN follow-ups move to the new owner, silently (assigned_to-only update
--    fires no push). Fires only on an owner-column write -> zero cost on normal lead saves.
--
-- 🔒 PHASE 334 CHANGE: the move rule is now
--      held by the previous owner (manual + auto, Phase 130)   OR   auto_generated = true (NEW)
--    Before, ONLY rows held by the old owner moved, so a cadence follow-up that had been parked on
--    the lead's CREATOR (the Phase 333 wrong-owner bug) or on a rep who left was never moved when the
--    lead was later reassigned -> 17 stranded rows (Jayna 8, Brijesh 6, Jignesh 3) on leads now owned
--    by Jani / Kirti / Mayur. Auto-generated rows are cadence/system rows: they ALWAYS belong to the
--    lead's current owner, wherever they were parked. MANUAL rows held by a third person (an admin who
--    followed up on purpose) are still left alone.
--
-- 🔒 LOCKED (unchanged from Phase 130): never transfer to nobody; no-op when the owner did not really
--    change; rows already held by a current owner stay; quote-only payment follow-ups (lead_id NULL)
--    are untouched; EXCEPTION-wrapped so a reassign can never fail on follow-up housekeeping; SECURITY
--    DEFINER + search_path public; NO push (tg_push_followup_due watches follow_up_date/is_done only).
--
-- PROVENANCE: captured from the LIVE DB 2026-10-05, then the auto_generated clause added.
-- SUPERSEDES: supabase_phase130_push_hygiene.sql (function body removed there; trigger wiring stays).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lead_owner_change_transfer_followups()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_new_owner uuid;
BEGIN
  v_new_owner := COALESCE(NEW.assigned_to, NEW.telecaller_id);
  IF v_new_owner IS NULL THEN
    RETURN NEW;                       -- never transfer to nobody
  END IF;
  IF NEW.assigned_to   IS NOT DISTINCT FROM OLD.assigned_to
     AND NEW.telecaller_id IS NOT DISTINCT FROM OLD.telecaller_id THEN
    RETURN NEW;                       -- defensive: no real owner change
  END IF;

  -- EXCEPTION-wrapped: a reassign must never fail on FU housekeeping.
  BEGIN
    UPDATE public.follow_ups fu
       SET assigned_to = v_new_owner
     WHERE fu.lead_id = NEW.id
       AND fu.is_done = false
       AND fu.assigned_to IS NOT NULL
       AND fu.assigned_to IS DISTINCT FROM NEW.assigned_to
       AND fu.assigned_to IS DISTINCT FROM NEW.telecaller_id
       AND ( fu.assigned_to IN (OLD.assigned_to, OLD.telecaller_id)   -- Phase 130: held by the previous owner
             OR fu.auto_generated = true );                          -- Phase 334: cadence rows follow the lead, wherever parked
    -- Push note: tg_push_followup_due is UPDATE OF follow_up_date,
    -- is_done (34Z.55) -> this UPDATE fires NO push. The new owner is
    -- told via the existing quiet-hours-gated reassign push, and the
    -- fu-due cron / morning digest read assigned_to live from now on.
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'lead_owner_change_transfer_followups skipped for lead %: %',
                  NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$function$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY / TRIPWIRE — read-only. All five must be TRUE.
-- ============================================================================
-- SELECT
--   pg_get_functiondef(p.oid) LIKE '%OR fu.auto_generated = true%'                        AS p334_auto_rows_follow_lead,
--   pg_get_functiondef(p.oid) LIKE '%fu.assigned_to IN (OLD.assigned_to, OLD.telecaller_id)%' AS p130_old_owner_rule,
--   pg_get_functiondef(p.oid) LIKE '%never transfer to nobody%'                            AS never_to_nobody,
--   pg_get_functiondef(p.oid) LIKE '%EXCEPTION WHEN OTHERS%'                               AS exception_wrapped,
--   p.prosecdef                                                                            AS security_definer
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = 'lead_owner_change_transfer_followups';
