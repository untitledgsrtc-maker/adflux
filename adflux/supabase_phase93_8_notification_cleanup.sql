-- =====================================================================
-- Phase 93.8 — notification panel cleanup + follow-up due-time push
-- 25 May 2026
--
-- WHY
--
-- Owner reported (25 May 2026): bell badge stuck at 30 with SLA-breach
-- rows from 21-23 May that don't auto-clear when the lead is re-engaged.
-- Also asked: "if i have foloup call at 5:40 pm push notification is
-- there or not?" — answer was no, today push only fires on creation,
-- not at due time. Build both.
--
-- WHAT
--
-- 1. Phase 93.8a — clear leads.handoff_sla_due_at on any
--    lead_activities INSERT. Sales acting on a handed-off lead = SLA
--    resolved. Backfill existing leads with activity history.
--
-- 2. Phase 93.8e — add follow_ups.reminder_sent_at + new
--    push_followup_due_reminders() + 5-min cron. Each open follow_up
--    with a follow_up_time fires ONE push when due time falls inside
--    the past 5-min cron window. reminder_sent_at marks fired so the
--    next tick doesn't double-fire.
--
-- Idempotent. Re-runnable.
-- =====================================================================

-- ─── 93.8a — Auto-dismiss SLA on activity ───────────────────────────
CREATE OR REPLACE FUNCTION public.clear_handoff_sla_on_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Any non-auto-check-in activity on a lead clears its handoff SLA.
  IF NEW.lead_id IS NOT NULL THEN
    UPDATE public.leads
       SET handoff_sla_due_at = NULL
     WHERE id = NEW.lead_id
       AND handoff_sla_due_at IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clear_handoff_sla ON public.lead_activities;
CREATE TRIGGER trg_clear_handoff_sla
  AFTER INSERT ON public.lead_activities
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_handoff_sla_on_activity();

-- Backfill: clear SLA on leads that already have at least one activity.
UPDATE public.leads l
   SET handoff_sla_due_at = NULL
 WHERE handoff_sla_due_at IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM public.lead_activities la
     WHERE la.lead_id = l.id
   );


-- ─── 93.8e — Follow-up due-time push ────────────────────────────────
ALTER TABLE public.follow_ups
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;

COMMENT ON COLUMN public.follow_ups.reminder_sent_at IS
  'Phase 93.8e — set by push_followup_due_reminders() cron when the '
  '5-min window crosses follow_up_time. Prevents double-push.';

-- -------------------------------------------------------------------------
-- push_followup_due_reminders REMOVED from this file (Phase 178).
-- Canonical: db/functions/push_followup_due_reminders.sql (cron; quiet-hours + per-row tag).
-- Do NOT re-add it here. Edit the canonical file only (§71).
-- -------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.push_followup_due_reminders() TO authenticated;

-- Schedule every 5 min. Re-runnable: unschedule then schedule.
DO $$
BEGIN
  PERFORM cron.unschedule('untitled-followup-due-reminders');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'untitled-followup-due-reminders',
  '*/5 * * * *',
  $$ SELECT public.push_followup_due_reminders(); $$
);


NOTIFY pgrst, 'reload schema';


-- ─── VERIFY ─────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM pg_trigger
    WHERE tgname = 'trg_clear_handoff_sla')                       AS sla_trigger,
  (SELECT count(*) FROM public.leads
    WHERE handoff_sla_due_at IS NOT NULL
      AND id IN (SELECT DISTINCT lead_id FROM public.lead_activities
                 WHERE lead_id IS NOT NULL))                       AS sla_leftover_with_activity,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'follow_ups' AND column_name = 'reminder_sent_at') AS reminder_col,
  (SELECT count(*) FROM pg_proc
    WHERE proname = 'push_followup_due_reminders')                AS fn_present,
  (SELECT count(*) FROM cron.job
    WHERE jobname = 'untitled-followup-due-reminders')            AS cron_present;
