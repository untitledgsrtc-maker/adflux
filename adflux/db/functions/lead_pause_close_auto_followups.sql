-- ============================================================================
-- db/functions/lead_pause_close_auto_followups.sql — CANONICAL HOME (Phase 178 / Stage 2)
-- ============================================================================
--
-- ⭐ The ONE place lead_pause_close_auto_followups is allowed to live (§71). It
--    lived in 2 files (phase128_3_nurture_pause_close, phase129_resume_respawn_nurture).
--
-- WHAT IT DOES: AFTER-UPDATE-OF-cadence_paused trigger on leads.
--    • §128.3 — on PAUSE ON: closes all OPEN auto follow-ups (the cadence rows +
--      the legacy 33D.4 'Auto-scheduled:%' rows) with note '[closed: auto
--      follow-ups paused]'.
--    • §129 — on RESUME (pause OFF): for a Nurture lead ONLY, books the next
--      check-in at +30 days via spawn_nurture_followup — but ONLY if no open
--      nurture row already exists (idempotent re-toggle safe).
--
-- 🔒 LOCKED CONTRACTS (a diff that breaks any is a BLOCK):
--    • Pause-ON edge: NEW.cadence_paused IS TRUE AND OLD.cadence_paused IS DISTINCT
--      FROM TRUE. Resume edge: NEW NOT TRUE AND OLD IS TRUE.
--    • §129 resume respawns nurture ONLY while stage='Nurture', ONLY if no open
--      nurture FU exists, at +30 days (via spawn_nurture_followup). Do NOT respawn
--      on Lost/Working resume; do NOT book earlier than +30d.
--    • note '[closed: auto follow-ups paused]' — §175 isSystemClose marker.
--
-- PROVENANCE: captured byte-for-byte from the LIVE DB 2026-06-24 (the phase129
--    body — the §129 superset of §128.3). Single signature (trigger fn). NO-OP run.
--
-- TRIGGER WIRING lives in the phase files. SUPERSEDES:
--    supabase_phase128_3_nurture_pause_close.sql · supabase_phase129_resume_respawn_nurture.sql
-- REVERT: re-run this file.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lead_pause_close_auto_followups()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_owner uuid;
BEGIN
  IF NEW.cadence_paused IS TRUE AND OLD.cadence_paused IS DISTINCT FROM TRUE THEN
    -- Pause ON: close open AUTO follow-ups (Phase 128.3, unchanged).
    UPDATE public.follow_ups
       SET is_done = true,
           note = COALESCE(note, '') || ' [closed: auto follow-ups paused]'
     WHERE lead_id = NEW.id
       AND is_done = false
       AND (cadence_type IN ('lead_intro','quote_chase','nurture','lost_nurture')
            OR (cadence_type IS NULL AND auto_generated = true
                AND note LIKE 'Auto-scheduled:%'));

  ELSIF NEW.cadence_paused IS NOT TRUE AND OLD.cadence_paused IS TRUE THEN
    -- PHASE-129 Resume: Nurture leads ONLY — book the next check-in at
    -- +30 days (next workday), never earlier. Skip when an open nurture
    -- row already exists (idempotent re-toggle safe).
    IF NEW.stage = 'Nurture' THEN
      v_owner := COALESCE(NEW.assigned_to, NEW.created_by);
      IF v_owner IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.follow_ups
         WHERE lead_id = NEW.id AND is_done = false AND cadence_type = 'nurture'
      ) THEN
        PERFORM public.spawn_nurture_followup(NEW.id, v_owner, CURRENT_DATE, 'nurture');
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $function$;

NOTIFY pgrst, 'reload schema';

-- VERIFY (read-only): all TRUE.
-- SELECT
--   pg_get_functiondef(p.oid) LIKE '%closed: auto follow-ups paused%'          AS pause_close_note,
--   pg_get_functiondef(p.oid) LIKE '%OLD.cadence_paused IS DISTINCT FROM TRUE%' AS pause_on_edge,
--   pg_get_functiondef(p.oid) LIKE '%PHASE-129%'                                AS resume_branch,
--   pg_get_functiondef(p.oid) LIKE '%NEW.stage = ''Nurture''%'                 AS resume_nurture_only,
--   pg_get_functiondef(p.oid) LIKE '%spawn_nurture_followup%'                  AS resume_spawns_nurture
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = 'lead_pause_close_auto_followups';
