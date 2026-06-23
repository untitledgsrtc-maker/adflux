-- =====================================================================
-- Phase 34Z.42 — drop l.last_outcome reference from generate_lead_tasks
-- 15 May 2026
--
-- WHY
--
-- Console 400 on /work:
--   POST /rest/v1/rpc/generate_lead_tasks 400
--   42703 column "l.last_outcome" does not exist
--
-- Phase 33T's body had:
--   'Hot lead — ' || COALESCE(NULLIF(l.last_outcome, ''), 'follow up')
--
-- but leads.last_outcome was never a column. It was probably copy-paste
-- from an earlier draft. Phase 34Z.19 + 34Z.28 carried the bug forward.
--
-- WHAT
--
-- Re-create generate_lead_tasks with the Hot-rule reason simplified to
-- a static string. Everything else identical to Phase 34Z.28.
-- =====================================================================

-- -------------------------------------------------------------------------
-- generate_lead_tasks REMOVED from this file (Phase 178 consolidation).
-- The ONE canonical version now lives in: db/functions/generate_lead_tasks.sql
-- Do NOT re-add it here. To change it, edit the canonical file only (§71).
-- -------------------------------------------------------------------------

NOTIFY pgrst, 'reload schema';

-- VERIFY (expect 0)
SELECT regexp_count(pg_get_functiondef(p.oid), 'last_outcome') AS bad_refs
  FROM pg_proc p WHERE p.proname = 'generate_lead_tasks';
