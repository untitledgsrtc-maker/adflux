-- supabase_phase88_4_trigger_consolidation.sql
--
-- Phase 88.4 — consolidate 3 AFTER INSERT triggers on
-- lead_activities into a single combined function. Same business
-- logic, fewer SELECT + UPDATE round-trips per row insert.
--
-- Owner directive 23 May 2026 (afternoon sprint): 'feely like its
-- done in milisecons'. Phase 88.1 cut JS-side wait; this commit
-- cuts SQL-side wait on the activity insert path.
--
-- BEFORE
--   AFTER INSERT fires 3 triggers serially:
--     1. trg_lead_first_engagement_advance   → SELECT stage + UPDATE
--     2. trg_lead_auto_heat_from_outcome     → SELECT stage,heat + UPDATE
--     3. trg_lead_activity_sync_followup     → SELECT assigned_to + UPDATE/INSERT follow_ups
--   Each trigger does its own row lookup. ~3 SELECT + 1-3 UPDATE
--   per insert. Combined cost in production ~80-200ms warm,
--   ~500ms cold.
--
-- AFTER
--   ONE consolidated trigger fires lead_activity_aftermath()
--   which:
--     - Reads the lead row ONCE (stage, heat, assigned_to).
--     - Runs all 3 decisions in PL/pgSQL locals.
--     - Issues a SINGLE UPDATE on leads with a combined SET clause.
--     - Then handles the follow_ups upsert (separate table).
--   Saved: 2 redundant SELECTs + up to 2 redundant UPDATEs per row.
--
-- The auto_heat UPDATE-of-outcome path stays a separate, dedicated
-- trigger because the INSERT path is the hot one — rep saves
-- outcome at insert time (Phase 88.1 optimistic save). The UPDATE
-- path is rare (admin manually edits a past activity).
--
-- Idempotent. Re-running is safe. ROLLBACK at the bottom.

-- ─────────────────────────────────────────────────────────────────
-- Consolidated function
-- ─────────────────────────────────────────────────────────────────
-- ⛔ PHASE 334: the body of public.lead_activity_aftermath() was REMOVED from this file (§71/§72).
--    CANONICAL: db/functions/lead_activity_aftermath.sql — edit THAT file, never re-paste a copy here.
--    The old body resolved the follow-up owner as COALESCE(assigned_to, author) — wrong for telecaller-owned leads.
--    (Re-running this file can no longer revert the function. On a FRESH database run db/functions/lead_activity_aftermath.sql BEFORE this file.)

-- ─────────────────────────────────────────────────────────────────
-- Swap the 3 individual triggers for 1 consolidated trigger.
-- Original functions are NOT dropped — left in place so re-running
-- the source SQL files works + admin can attach them again
-- manually for a rollback.
-- ─────────────────────────────────────────────────────────────────

-- Drop the 3 redundant AFTER INSERT triggers.
DROP TRIGGER IF EXISTS trg_lead_first_engagement_advance
  ON public.lead_activities;
DROP TRIGGER IF EXISTS trg_lead_activity_sync_followup
  ON public.lead_activities;
-- Note: trg_lead_auto_heat_from_outcome covers BOTH INSERT + UPDATE.
-- Drop ONLY the INSERT side via DROP + CREATE pattern below.
DROP TRIGGER IF EXISTS trg_lead_auto_heat_from_outcome
  ON public.lead_activities;

-- ─── New consolidated INSERT trigger ─────────────────────────────
DROP TRIGGER IF EXISTS trg_lead_activity_aftermath
  ON public.lead_activities;
CREATE TRIGGER trg_lead_activity_aftermath
AFTER INSERT ON public.lead_activities
FOR EACH ROW
EXECUTE FUNCTION public.lead_activity_aftermath();

-- ─── Re-attach UPDATE-only auto_heat trigger ─────────────────────
-- The INSERT path is now in the consolidated function. The UPDATE
-- path (admin manually edits outcome on a past activity) needs its
-- own trigger.
--
-- Phase 88.4.1 (hotfix 2026-05-23): the original
-- lead_auto_heat_from_outcome() function from Phase 47.4 wasn't
-- deployed on this database. Inline the definition here so the
-- SQL file is self-contained — no dependency on Phase 47.4 source
-- ever having been run.
-- -------------------------------------------------------------------------
-- lead_auto_heat_from_outcome REMOVED from this file (Phase 178). Canonical: db/functions/lead_auto_heat_from_outcome.sql
-- Do NOT re-add (§71). Trigger wiring stays.
-- -------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_lead_auto_heat_on_update
  ON public.lead_activities;
CREATE TRIGGER trg_lead_auto_heat_on_update
AFTER UPDATE OF outcome ON public.lead_activities
FOR EACH ROW
EXECUTE FUNCTION public.lead_auto_heat_from_outcome();

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────
-- Expected rows after run:
--   • trg_lead_activity_aftermath           = 1
--   • trg_lead_auto_heat_on_update          = 1
--   • trg_lead_first_engagement_advance     = 0 (dropped)
--   • trg_lead_activity_sync_followup       = 0 (dropped)
--   • trg_lead_auto_heat_from_outcome       = 0 (dropped — INSERT
--                                                 path now in
--                                                 aftermath)
SELECT tgname, tgenabled FROM pg_trigger
  WHERE tgrelid = 'public.lead_activities'::regclass
    AND tgname IN (
      'trg_lead_activity_aftermath',
      'trg_lead_auto_heat_on_update',
      'trg_lead_first_engagement_advance',
      'trg_lead_activity_sync_followup',
      'trg_lead_auto_heat_from_outcome'
    )
  ORDER BY tgname;

-- ─── ROLLBACK (paste manually if Phase 88.4 misbehaves) ──────────
-- DROP TRIGGER IF EXISTS trg_lead_activity_aftermath ON public.lead_activities;
-- DROP TRIGGER IF EXISTS trg_lead_auto_heat_on_update ON public.lead_activities;
-- CREATE TRIGGER trg_lead_first_engagement_advance
--   AFTER INSERT ON public.lead_activities
--   FOR EACH ROW EXECUTE FUNCTION public.lead_first_engagement_advance();
-- CREATE TRIGGER trg_lead_activity_sync_followup
--   AFTER INSERT ON public.lead_activities
--   FOR EACH ROW EXECUTE FUNCTION public.lead_activity_sync_followup();
-- CREATE TRIGGER trg_lead_auto_heat_from_outcome
--   AFTER INSERT OR UPDATE OF outcome ON public.lead_activities
--   FOR EACH ROW EXECUTE FUNCTION public.lead_auto_heat_from_outcome();
-- NOTIFY pgrst, 'reload schema';
