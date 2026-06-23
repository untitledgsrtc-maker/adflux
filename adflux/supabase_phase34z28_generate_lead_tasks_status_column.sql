-- =====================================================================
-- Phase 34Z.28 — fix generate_lead_tasks body: use status text, not bool
-- 15 May 2026
--
-- WHY
--
-- Phase 34Z.19 reinstated the (p_user_id uuid) signature using the
-- Phase 33T body. That body's DELETE step reads `AND NOT done AND NOT
-- skipped`, but the actual lead_tasks schema (Phase 19) has:
--   status text CHECK (status IN ('open','done','snoozed','skipped'))
-- and no boolean `done` column. PostgREST surfaces:
--   42703 column "done" does not exist
-- on every /work mount.
--
-- WHAT
--
-- Re-create generate_lead_tasks with the correct WHERE — `status NOT
-- IN ('done','skipped')` — and idempotent ON CONFLICT inserts.
-- Body otherwise identical to Phase 34Z.19.
--
-- Idempotent. Re-runnable.
-- =====================================================================

-- -------------------------------------------------------------------------
-- generate_lead_tasks REMOVED from this file (Phase 178 consolidation).
-- The ONE canonical version now lives in: db/functions/generate_lead_tasks.sql
-- Do NOT re-add it here. To change it, edit the canonical file only (§71).
-- -------------------------------------------------------------------------

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────────
-- Expect:
--   • uses_status      = 1   (new function checks `status NOT IN`)
--   • legacy_NOT_done  = 0   (old boolean reference gone)
SELECT
  (SELECT regexp_count(pg_get_functiondef(p.oid), 'status NOT IN')
     FROM pg_proc p WHERE p.proname = 'generate_lead_tasks')   AS uses_status,
  (SELECT regexp_count(pg_get_functiondef(p.oid), 'NOT done')
     FROM pg_proc p WHERE p.proname = 'generate_lead_tasks')   AS legacy_NOT_done;
