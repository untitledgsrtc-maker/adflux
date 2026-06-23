-- =====================================================================
-- Phase 34Z.48 — generate_lead_tasks kinds must match lead_tasks_kind_chk
-- 15 May 2026
--
-- WHY
--
-- Console 400 on /work:
--   POST /rest/v1/rpc/generate_lead_tasks 400
--   23514 new row for relation "lead_tasks" violates check constraint
--   "lead_tasks_kind_chk"
--
-- Phase 34Z.42 inserted kind='hot' and kind='new_lead', but the
-- schema (Phase 19) constraint only accepts:
--   ('sla_breach','follow_up_due','hot_idle','qualified_no_quote',
--    'nurture_revisit','new_untouched')
--
-- WHAT
--
-- Re-create generate_lead_tasks with valid kinds:
--   Rule 1: 'hot'      → 'hot_idle'
--   Rule 2: 'new_lead' → 'new_untouched'
--   Rule 3: 'follow_up_due' (already valid)
-- Body otherwise identical to Phase 34Z.42.
-- =====================================================================

-- -------------------------------------------------------------------------
-- generate_lead_tasks REMOVED from this file (Phase 178 consolidation).
-- The ONE canonical version now lives in: db/functions/generate_lead_tasks.sql
-- Do NOT re-add it here. To change it, edit the canonical file only (§71).
-- -------------------------------------------------------------------------

NOTIFY pgrst, 'reload schema';

-- VERIFY: expect 0 invalid kind refs.
SELECT
  (SELECT regexp_count(pg_get_functiondef(p.oid), '''hot''[^_]'))
    + (SELECT regexp_count(pg_get_functiondef(p.oid), '''new_lead'''))
  AS bad_kind_refs
  FROM pg_proc p WHERE p.proname = 'generate_lead_tasks';
