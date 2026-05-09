-- supabase_phase31j_action_time.sql
--
-- Phase 31J — capture *time* on next-action / follow-up rows.
--
-- Owner reported (10 May 2026): "no time schedule assigned while
-- saying meeting tomorrow 12 o'clock". The voice classifier extracts
-- next_action ("Attend meeting") + next_action_date ("2026-05-10")
-- but there's no column for the time, so "12 o'clock" was lost. Same
-- problem on follow_ups — only follow_up_date, no time.
--
-- Fix: add nullable `time` columns to both tables. Existing rows keep
-- working; new voice / manual entries can carry a time. UI surfaces
-- the field so reps can edit if AI misheard.
--
-- Idempotent.

ALTER TABLE public.lead_activities
  ADD COLUMN IF NOT EXISTS next_action_time time;

ALTER TABLE public.follow_ups
  ADD COLUMN IF NOT EXISTS follow_up_time time;

-- Reload PostgREST so the new columns are immediately exposed via the
-- REST API without waiting for the auto-reload window.
NOTIFY pgrst, 'reload schema';

-- VERIFY:
-- SELECT column_name, data_type
--   FROM information_schema.columns
--  WHERE table_schema='public'
--    AND table_name IN ('lead_activities','follow_ups')
--    AND column_name IN ('next_action_time','follow_up_time');
--   should return 2 rows.
