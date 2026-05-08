-- supabase_phase30d_morning_plan.sql
--
-- Phase 30D — morning check-in gate + plan→tasks.
--
-- Owner spec (7 May 2026):
--   • Reps must check in by 9:30 AM. Late check-in requires a "Late
--     reason" (doctor appointment, traffic, etc). Soft gate, not a
--     punishment — admin sees the reason in the daily report.
--   • After check-in, rep submits "plan of the day" via voice or
--     typed text. Claude parses the description into discrete
--     actionable tasks the rep can tick off as they go.
--   • Check-out is locked until the evening report is submitted —
--     enforced both client-side (UI) and server-side (trigger).
--
-- Schema additions (all to work_sessions, all nullable):
--   check_in_late_reason      text   — explanation when check-in
--                                       past 9:30 AM. Null = on-time.
--   morning_plan_text         text   — raw description from rep
--                                       (Gujarati / Hindi / English).
--   morning_plan_tasks        jsonb  — Claude-extracted task list:
--                                       [{ id, title, type, due_time, done }]
--   morning_plan_submitted_at timestamptz — when they hit submit.
--
-- Trigger: prevent check_out_at from being stamped while
-- evening_report_submitted_at is null. Admin can still override by
-- setting evening_report_submitted_at directly.
--
-- Idempotent.

ALTER TABLE public.work_sessions
  ADD COLUMN IF NOT EXISTS check_in_late_reason      text,
  ADD COLUMN IF NOT EXISTS morning_plan_text         text,
  ADD COLUMN IF NOT EXISTS morning_plan_tasks        jsonb,
  ADD COLUMN IF NOT EXISTS morning_plan_submitted_at timestamptz;

-- ─────────────────────────────────────────────────────────────────
-- Trigger: lock check-out until evening report submitted
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_evening_before_checkout()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only fire when check_out_at is being SET (was null, becoming non-null).
  IF NEW.check_out_at IS NOT NULL
     AND (OLD.check_out_at IS NULL OR OLD.check_out_at IS DISTINCT FROM NEW.check_out_at)
     AND NEW.evening_report_submitted_at IS NULL
  THEN
    RAISE EXCEPTION 'Cannot check out before submitting evening report. Submit the evening summary first.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS work_sessions_evening_gate ON public.work_sessions;
CREATE TRIGGER work_sessions_evening_gate
  BEFORE UPDATE ON public.work_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_evening_before_checkout();

NOTIFY pgrst, 'reload schema';

-- VERIFY:
-- \d public.work_sessions
--   should show the 4 new columns.
--
-- SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.work_sessions'::regclass;
--   should include 'work_sessions_evening_gate'.
--
-- Test (as a rep): try setting check_out_at while
-- evening_report_submitted_at is null → expect 'Cannot check out
-- before submitting evening report'.
