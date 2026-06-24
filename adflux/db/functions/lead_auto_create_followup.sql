-- ============================================================================
-- db/functions/lead_auto_create_followup.sql — CANONICAL HOME (Phase 178 / Stage 2)
-- ============================================================================
--
-- ⭐ The ONE place lead_auto_create_followup is allowed to live (§71). It lived in
--    2 files (phase33d4_auto_lead_followup, phase33d6_full_cadence).
--
-- WHAT IT DOES: AFTER-INSERT trigger on leads. For a New/Working lead with an owner,
--    auto-schedules a first follow-up tomorrow 10:00 (note 'Auto-scheduled: follow up
--    with new lead', auto_generated=true). The "first contact tomorrow" prompt.
--
-- 🔒 LOCKED: only stage IN ('New','Working') + a non-null owner (assigned_to ?? created_by)
--    get a row. note prefix 'Auto-scheduled:' is what cancel_lead_cadence's legacy-row
--    close + isSystemClose key off — keep it. auto_generated=true.
--
-- PROVENANCE: captured byte-for-byte from the LIVE DB 2026-06-24 (the phase33d6
--    body). Single signature (trigger fn). Running this file is a NO-OP.
--
-- TRIGGER WIRING lives in the phase files. Canonical owns the body only.
-- SUPERSEDES: supabase_phase33d4_auto_lead_followup.sql · supabase_phase33d6_full_cadence.sql
-- REVERT: re-run this file.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lead_auto_create_followup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_owner uuid;
BEGIN
  -- Owner of the follow-up: prefer assigned_to (the rep who will
  -- action it), fall back to created_by (the person who entered the
  -- lead). One of these is always non-null for sales-created leads.
  v_owner := COALESCE(NEW.assigned_to, NEW.created_by);
  IF v_owner IS NULL THEN
    -- No owner = no actionable follow-up (e.g. legacy import). Skip.
    RETURN NEW;
  END IF;

  -- Only auto-schedule for active stages. Won/Lost/Nurture leads
  -- don't need a "first contact tomorrow" prompt.
  IF NEW.stage NOT IN ('New', 'Working') THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.follow_ups (
    lead_id, assigned_to, follow_up_date, follow_up_time,
    note, auto_generated
  ) VALUES (
    NEW.id,
    v_owner,
    (CURRENT_DATE + INTERVAL '1 day')::date,
    '10:00:00',
    'Auto-scheduled: follow up with new lead',
    true
  );

  RETURN NEW;
END;
$function$;

NOTIFY pgrst, 'reload schema';

-- VERIFY (read-only): all TRUE.
-- SELECT
--   pg_get_functiondef(p.oid) LIKE '%Auto-scheduled: follow up with new lead%' AS note_marker,
--   pg_get_functiondef(p.oid) LIKE '%stage NOT IN (''New'', ''Working'')%'      AS active_stage_gate,
--   pg_get_functiondef(p.oid) LIKE '%CURRENT_DATE + INTERVAL ''1 day''%'         AS tomorrow,
--   pg_get_functiondef(p.oid) LIKE '%auto_generated%'                           AS auto_generated_flag
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = 'lead_auto_create_followup';
