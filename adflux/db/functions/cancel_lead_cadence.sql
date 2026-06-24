-- ============================================================================
-- db/functions/cancel_lead_cadence.sql — CANONICAL HOME (Phase 178 / Stage 2)
-- ============================================================================
--
-- ⭐ The ONE place cancel_lead_cadence is allowed to live. EDIT THIS FILE to change
--    it; never re-paste it into a new phaseN file (§71). It lived in 2 files
--    (phase128_3_nurture_pause_close, phase33d6_full_cadence).
--
-- WHAT IT DOES: a LANGUAGE sql helper. Closes (is_done=true) the OPEN follow_ups on
--    a lead for the given cadence types — used by lead_stage_change_cadence (#20),
--    lead_pause_close_auto_followups, and the Won/Lost terminal paths to cancel
--    cadences that no longer apply.
--
-- 🔒 LOCKED CONTRACTS (a diff that breaks any is a BLOCK):
--    • only OPEN rows (is_done=false) for the lead, whose cadence_type = ANY(p_types).
--    • §128.3 LEGACY CLOSE — when 'lead_intro' is in p_types, ALSO close the legacy
--      33D.4 rows (cadence_type IS NULL AND auto_generated=true AND note LIKE
--      'Auto-scheduled:%'). Those predate the cadence_type column; without this they
--      leak as zombie open follow-ups. Keep this OR-branch.
--    • note marker ' [cancelled by stage change]' — matched by §175 isSystemClose(),
--      so these count as SYSTEM closes (not rep-done) in the report + rep card.
--      Keep the 'cancelled by stage' text.
--
-- PROVENANCE: captured byte-for-byte from the LIVE DB 2026-06-24 (the phase128_3
--    body). Single signature (uuid, text[]). LANGUAGE sql (not plpgsql) — preserved.
--    Running this file is a NO-OP.
--
-- SUPERSEDES (Phase 178 removed the body from both):
--      supabase_phase128_3_nurture_pause_close.sql
--      supabase_phase33d6_full_cadence.sql
--
-- REVERT: re-run this file. TRIPWIRE: VERIFY block at the bottom.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cancel_lead_cadence(p_lead_id uuid, p_types text[])
 RETURNS void
 LANGUAGE sql
AS $function$
  UPDATE public.follow_ups
     SET is_done = true,
         note = COALESCE(note, '') || ' [cancelled by stage change]'
   WHERE lead_id = p_lead_id
     AND is_done = false
     AND (
       cadence_type = ANY(p_types)
       OR ('lead_intro' = ANY(p_types)
           AND cadence_type IS NULL
           AND auto_generated = true
           AND note LIKE 'Auto-scheduled:%')
     );
$function$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY / TRIPWIRE — read-only. All five must be TRUE.
-- legacy_33d4_close is the §128.3 lock — must stay TRUE.
-- ============================================================================
-- SELECT
--   pg_get_functiondef(p.oid) LIKE '%cancelled by stage change%'  AS system_close_note,
--   pg_get_functiondef(p.oid) LIKE '%cadence_type = ANY(p_types)%' AS type_match,
--   pg_get_functiondef(p.oid) LIKE '%Auto-scheduled:%%'           AS legacy_33d4_close,
--   pg_get_functiondef(p.oid) LIKE '%auto_generated = true%'      AS legacy_auto_gen_guard,
--   pg_get_functiondef(p.oid) LIKE '%is_done = false%'            AS open_only
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = 'cancel_lead_cadence';
