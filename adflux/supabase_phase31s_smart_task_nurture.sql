-- supabase_phase31s_smart_task_nurture.sql
--
-- Phase 31S (10 May 2026) — wire the Phase 31N `revisit_date` column
-- into the smart-task generator.
--
-- Background:
-- Phase 19 (smart tasks) had a `nurture_revisit` rule that read
-- `leads.nurture_revisit_date`. Phase 30A killed the Nurture stage
-- and repurposed `nurture_revisit_date` as a "long-tail revisit" hint
-- on Lost rows. Phase 31N restored Nurture as its own stage and added
-- a NEW column `leads.revisit_date` for it. The Phase 19 rule still
-- reads the legacy column, so new Nurture leads NEVER surface in
-- TodayTasksPanel. The owner's audit caught this.
--
-- Fix: rewrite Rule 5 to read `revisit_date` for stage='Nurture'.
-- Also keep firing for Lost-with-`nurture_revisit_date` so the legacy
-- "revisit this dead deal" hint survives.
--
-- The generator function is dropped + recreated; only Rule 5 changed.
-- All other rules (sla_breach, hot_idle, follow_up_due, sales_ready,
-- new_untouched, quote_stale) untouched.
--
-- Owner needs to paste this into Supabase Studio after pulling the
-- code change. Idempotent — safe to re-run.

-- -------------------------------------------------------------------------
-- generate_lead_tasks REMOVED from this file (Phase 178 consolidation).
-- The ONE canonical version now lives in: db/functions/generate_lead_tasks.sql
-- Do NOT re-add it here. To change it, edit the canonical file only (§71).
-- -------------------------------------------------------------------------

NOTIFY pgrst, 'reload schema';

-- VERIFY:
-- SELECT public.generate_lead_tasks(CURRENT_DATE);
--   should return an integer count of rows inserted.
-- SELECT count(*) FROM public.lead_tasks
--  WHERE kind='nurture_revisit' AND status='open';
--   should be > 0 if any Nurture lead's revisit_date has hit today.
