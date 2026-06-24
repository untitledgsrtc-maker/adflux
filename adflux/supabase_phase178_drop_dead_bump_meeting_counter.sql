-- ============================================================================
-- supabase_phase178_drop_dead_bump_meeting_counter.sql — DEAD-CODE REMOVAL
-- ============================================================================
--
-- Run this once in Supabase Studio. It DROPs the dead bump_meeting_counter
-- function (and re-asserts its trigger is gone).
--
-- WHY: bump_meeting_counter() is the OLD meeting counter. Its trigger
--   trg_bump_meeting_counter on lead_activities was DROPPED in Phase 32N
--   (supabase_phase32n_undo_duplicate_triggers.sql — the "÷2" fix when two
--   counters were double-bumping). Phases 93.6 / 93.7 later re-defined the
--   FUNCTION (adding auto-check-in + revisit skips) but never re-wired a trigger,
--   so the function has been DEAD ever since.
--
-- Confirmed dead 2026-06-24: pg_trigger has NO trigger referencing it. The LIVE
--   meeting counter is lead_activity_bump_counter (db/functions/lead_activity_bump_counter.sql),
--   which carries ALL the §33 exclusions bump_meeting_counter is MISSING — it has
--   no 'Meeting scheduled%' skip and no Phase 127 prior-must-be-done refinement.
--   So if it were ever re-wired it would re-inflate the meeting KPI (§33).
--
-- Phase 178 also neutralized the CREATE TRIGGER trg_bump_meeting_counter in
--   supabase_phase32m_field_meeting.sql (the re-wire landmine) and removed the
--   stale function copies from phase32m / phase93_6 / phase93_7. This migration
--   removes the dead function from the LIVE DB. Idempotent + safe (nothing calls it).
-- ============================================================================

DROP TRIGGER IF EXISTS trg_bump_meeting_counter ON public.lead_activities;
DROP FUNCTION IF EXISTS public.bump_meeting_counter();

NOTIFY pgrst, 'reload schema';

-- VERIFY: both must return 0.
-- SELECT count(*) AS fn_should_be_0
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public' AND p.proname = 'bump_meeting_counter';
-- SELECT count(*) AS trg_should_be_0
--   FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
--  WHERE p.proname = 'bump_meeting_counter' AND NOT t.tgisinternal;
