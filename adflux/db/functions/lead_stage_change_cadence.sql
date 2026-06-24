-- ============================================================================
-- db/functions/lead_stage_change_cadence.sql — CANONICAL HOME (Phase 178 / Stage 2)
-- ============================================================================
--
-- ⭐ The ONE place lead_stage_change_cadence is allowed to live. EDIT THIS FILE to
--    change it; never re-paste it into a new phaseN file (§71). It lived in 2 files
--    (phase128_3_nurture_pause_close, phase33d6_full_cadence).
--
-- WHAT IT DOES: AFTER-UPDATE trigger on leads. On a STAGE change it cancels the
--    follow-up cadences that no longer apply and (re)spawns the one for the new
--    stage. The cadence stage-machine.
--
-- 🔒 §128.3 LOCKED CONTRACT (a diff that breaks any is a BLOCK):
--    • CANCELS run FIRST, UNCONDITIONALLY — BEFORE the `IF NEW.cadence_paused
--      RETURN NEW` gate. A paused lead must NEVER preserve stale chase rows (the
--      §128.3 fix). Do NOT move the cancel block below the pause gate.
--    • SPAWNS stay pause-gated (the 33D.6 contract) — only after the cadence_paused
--      early-return.
--    • Stage branches (cancel set + spawn): Won → cancel ALL cadences (no spawn);
--      QuoteSent ← New/Working → cancel lead_intro, spawn quote_chase; Nurture →
--      cancel lead_intro/quote_chase/lost_nurture, spawn nurture; Lost → cancel
--      lead_intro/quote_chase/nurture, spawn lost_nurture; New/Working ← Nurture/Lost
--      → cancel nurture/lost_nurture, spawn lead_intro.
--    • Cadence types: lead_intro | quote_chase | nurture | lost_nurture (§28 frozen
--      set — do not add/rename).
--
-- PROVENANCE: captured byte-for-byte from the LIVE DB 2026-06-24 (the phase128_3
--    body). Single signature (trigger fn). Running this file is a NO-OP.
--
-- HELPERS it calls (cancel_lead_cadence, spawn_quote_chase_cadence,
--    spawn_nurture_followup, spawn_lead_intro_cadence) are themselves the cadence
--    family — some still multi-copy (future Stage-2 candidates). Keep this caller in
--    step with whatever they become.
--
-- TRIGGER WIRING (AFTER UPDATE OF stage on leads) lives in
--    supabase_phase33d6_full_cadence.sql — NOT here. Canonical owns the body only.
--
-- SUPERSEDES (Phase 178 removed the body from both; phase33d6 keeps its 7 other
--    cadence functions + the trigger):
--      supabase_phase128_3_nurture_pause_close.sql
--      supabase_phase33d6_full_cadence.sql
--
-- REVERT: re-run this file. TRIPWIRE: VERIFY block at the bottom.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lead_stage_change_cadence()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_owner uuid := COALESCE(NEW.assigned_to, NEW.created_by);
BEGIN
  IF NEW.stage = OLD.stage THEN RETURN NEW; END IF;
  IF v_owner IS NULL THEN RETURN NEW; END IF;

  IF NEW.stage = 'Won' THEN
    PERFORM public.cancel_lead_cadence(NEW.id,
      ARRAY['lead_intro','quote_chase','nurture','lost_nurture']);
    RETURN NEW;
  END IF;

  -- PHASE-128.3: cleanup first, unconditionally (pause must never
  -- preserve stale chase rows).
  IF NEW.stage = 'QuoteSent' AND OLD.stage IN ('New','Working') THEN
    PERFORM public.cancel_lead_cadence(NEW.id, ARRAY['lead_intro']);
  ELSIF NEW.stage = 'Nurture' AND OLD.stage <> 'Nurture' THEN
    PERFORM public.cancel_lead_cadence(NEW.id,
      ARRAY['lead_intro','quote_chase','lost_nurture']);
  ELSIF NEW.stage = 'Lost' AND OLD.stage <> 'Lost' THEN
    PERFORM public.cancel_lead_cadence(NEW.id,
      ARRAY['lead_intro','quote_chase','nurture']);
  ELSIF NEW.stage IN ('New','Working') AND OLD.stage IN ('Nurture','Lost') THEN
    PERFORM public.cancel_lead_cadence(NEW.id, ARRAY['nurture','lost_nurture']);
  END IF;

  -- Spawns stay pause-gated (33D.6 contract).
  IF NEW.cadence_paused THEN RETURN NEW; END IF;

  IF NEW.stage = 'QuoteSent' AND OLD.stage IN ('New','Working') THEN
    PERFORM public.spawn_quote_chase_cadence(NEW.id, v_owner, CURRENT_DATE);
  ELSIF NEW.stage = 'Nurture' AND OLD.stage <> 'Nurture' THEN
    PERFORM public.spawn_nurture_followup(NEW.id, v_owner, CURRENT_DATE, 'nurture');
  ELSIF NEW.stage = 'Lost' AND OLD.stage <> 'Lost' THEN
    PERFORM public.spawn_nurture_followup(NEW.id, v_owner, CURRENT_DATE, 'lost_nurture');
  ELSIF NEW.stage IN ('New','Working') AND OLD.stage IN ('Nurture','Lost') THEN
    PERFORM public.spawn_lead_intro_cadence(NEW.id, v_owner, CURRENT_DATE);
  END IF;

  RETURN NEW;
END $function$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY / TRIPWIRE — read-only. All six must be TRUE.
-- ============================================================================
-- SELECT
--   pg_get_functiondef(p.oid) LIKE '%cancel_lead_cadence%'                AS has_cancels,
--   pg_get_functiondef(p.oid) LIKE '%cleanup first, unconditionally%'     AS p128_3_cancel_before_pause,
--   pg_get_functiondef(p.oid) LIKE '%IF NEW.cadence_paused THEN RETURN NEW%' AS spawns_pause_gated,
--   pg_get_functiondef(p.oid) LIKE '%spawn_quote_chase_cadence%'          AS quote_chase_spawn,
--   pg_get_functiondef(p.oid) LIKE '%lost_nurture%'                       AS lost_nurture_branch,
--   pg_get_functiondef(p.oid) LIKE '%spawn_lead_intro_cadence%'           AS lead_intro_spawn
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = 'lead_stage_change_cadence';
