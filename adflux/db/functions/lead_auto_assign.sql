-- ============================================================================
-- db/functions/lead_auto_assign.sql — CANONICAL HOME (Phase 178 / Stage 2)
-- ============================================================================
-- ⭐ The ONE place lead_auto_assign lives (§71). Was in phase34 + phase99_b1.
-- WHAT: BEFORE-INSERT trigger on leads. Round-robin assigns assigned_to by segment
--   when both owner columns are blank.
-- 🔒 LOCKED: §99.B.1 TC-intent guard — if NEW.telecaller_id IS NOT NULL, routing is
--   already decided (TC import) → RETURN NEW, leave assigned_to NULL (do NOT stamp a
--   phantom sales rep). Only when assigned_to IS NULL does §34 round-robin fire via
--   assign_lead_round_robin(NEW.segment). Do NOT remove the telecaller_id guard.
-- PROVENANCE: live dump 2026-06-24 (phase99_b1 body). Trigger wiring in phase files.
-- SUPERSEDES: supabase_phase34_followup_consolidation.sql · supabase_phase99_b1_lead_auto_assign_tc_guard.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lead_auto_assign()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Phase 99.B.1 (2026-05-29) — TC-intent guard. If the inserting
  -- code path explicitly set telecaller_id, routing has already
  -- been decided; skip round-robin so assigned_to stays NULL.
  -- Without this guard, LeadUploadV2's new "Default telecaller"
  -- pick (Phase 99.B) would get a phantom sales rep stamped on
  -- every TC-only import.
  IF NEW.telecaller_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Phase 34 — original behaviour for paths that leave both
  -- columns NULL: round-robin assignment by segment.
  IF NEW.assigned_to IS NULL THEN
    NEW.assigned_to := public.assign_lead_round_robin(NEW.segment);
  END IF;

  RETURN NEW;
END;
$function$;

NOTIFY pgrst, 'reload schema';
-- VERIFY: pg_get_functiondef LIKE '%NEW.telecaller_id IS NOT NULL%' (tc_guard)
--         AND LIKE '%assign_lead_round_robin%' (round_robin) — both TRUE.
