-- supabase_phase33t_smart_task_fix.sql
--
-- Phase 33T — fix generate_lead_tasks RPC that's been broken since
-- Phase 31S shipped. Owner caught it in Chrome console:
--   POST /rest/v1/rpc/generate_lead_tasks 400 (Bad Request)
--   column l.next_follow_up_at does not exist
--
-- Root cause: Rule 3 ("follow_up_due") joins leads with itself and
-- reads leads.next_follow_up_at — a column that was never added.
-- Leads has next_action_time (TIME, hour-minute only, Phase 31J)
-- but actual follow-up dates live in the separate follow_ups table.
--
-- Effect: every call to generate_lead_tasks raises 42703, useLeadTasks
-- hook catches the error, no tasks ever generate. /work TodayTasksPanel
-- has been silently empty for everyone since 31S.
--
-- Fix: rewrite Rule 3 to read from the follow_ups table (join on
-- lead_id, take the earliest pending follow_up). Phase 33Q's
-- suggested-tasks fallback already covers this surface from the UI
-- side; this fixes the underlying engine.

-- -------------------------------------------------------------------------
-- generate_lead_tasks REMOVED from this file (Phase 178 consolidation).
-- The ONE canonical version now lives in: db/functions/generate_lead_tasks.sql
-- Do NOT re-add it here. To change it, edit the canonical file only (§71).
-- -------------------------------------------------------------------------

NOTIFY pgrst, 'reload schema';

-- VERIFY:
--   SELECT generate_lead_tasks(auth.uid());
--   Should return a non-negative int, no error.
