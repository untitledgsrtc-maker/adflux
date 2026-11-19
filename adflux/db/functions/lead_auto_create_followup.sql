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
--    Phase 625 (19-11-2026): ALSO a 'first call (5 min)' row 5 minutes after insert, in
--    push hours only, not Sunday, not Excel imports, not bulk entry (>10 leads/minute).
--
-- 🔒 LOCKED: only stage IN ('New','Working') + a non-null owner (assigned_to ?? telecaller_id ?? created_by - Phase 333)
--    get a row. note prefix 'Auto-scheduled:' is what cancel_lead_cadence's legacy-row
--    close + isSystemClose key off — keep it. auto_generated=true.
--
-- PROVENANCE: captured byte-for-byte from the LIVE DB 2026-06-24 (the phase33d6
--    body). Single signature (trigger fn). Re-running this file is safe (CREATE OR REPLACE).
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
  v_owner   uuid;
  v_now_ist timestamp := now() AT TIME ZONE 'Asia/Kolkata';
  v_soon    timestamp := (now() + interval '5 minutes') AT TIME ZONE 'Asia/Kolkata';
BEGIN
  -- Phase 333: assigned_to, THEN telecaller_id, THEN created_by (a TC-owned lead has assigned_to NULL).
  v_owner := COALESCE(NEW.assigned_to, NEW.telecaller_id, NEW.created_by);
  IF v_owner IS NULL THEN
    RETURN NEW;   -- no owner = no actionable follow-up (e.g. legacy import)
  END IF;
  IF NEW.stage NOT IN ('New', 'Working') THEN
    RETURN NEW;
  END IF;

  -- Phase 625: a "first call" follow-up 5 minutes after the lead is added. Only in
  -- push hours (due time 09:00-20:59 IST, same window as is_push_allowed_now), never on Sunday, never for an
  -- Excel import, and never when this creator added more than 10 leads in the last
  -- minute (bulk entry) - so a rep is never flooded. The 10:00 row below covers the rest.
  IF EXTRACT(HOUR FROM v_soon) BETWEEN 9 AND 20          -- push hours, checked on the DUE time
     AND EXTRACT(DOW FROM v_soon) <> 0
     AND COALESCE(NEW.source, '') <> 'Excel'
     AND (SELECT count(*) FROM public.leads x
           WHERE x.created_by IS NOT DISTINCT FROM NEW.created_by
             AND x.created_at > now() - interval '1 minute') <= 10 THEN
    INSERT INTO public.follow_ups (lead_id, assigned_to, follow_up_date, follow_up_time, note, auto_generated)
    VALUES (NEW.id, v_owner, v_soon::date, date_trunc('minute', v_soon)::time,
            'Auto-scheduled: first call (5 min)', true);
  END IF;

  -- Next working day 10:00 (Phase 625: IST date + Sunday skip; was CURRENT_DATE + 1, a UTC date).
  INSERT INTO public.follow_ups (
    lead_id, assigned_to, follow_up_date, follow_up_time,
    note, auto_generated
  ) VALUES (
    NEW.id,
    v_owner,
    public.next_workday(v_now_ist::date + 1),
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
--   pg_get_functiondef(p.oid) LIKE '%next_workday(v_now_ist::date + 1)%'         AS tomorrow,
--   pg_get_functiondef(p.oid) LIKE '%first call (5 min)%'                        AS p625_five_min,
--   pg_get_functiondef(p.oid) LIKE '%auto_generated%'                           AS auto_generated_flag,
--   pg_get_functiondef(p.oid) LIKE '%NEW.assigned_to, NEW.telecaller_id, NEW.created_by%' AS p333_tc_owner
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = 'lead_auto_create_followup';
