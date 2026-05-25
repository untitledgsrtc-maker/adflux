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

CREATE OR REPLACE FUNCTION public.push_followup_due_reminders()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_today_ist     date;
  v_now_ist       timestamp;
  v_window_lower  timestamp;
  v_window_upper  timestamp;
  v_count         int := 0;
  r               record;
BEGIN
  v_now_ist      := (now() AT TIME ZONE 'Asia/Kolkata')::timestamp;
  v_today_ist    := v_now_ist::date;
  v_window_lower := v_now_ist - interval '5 minutes';
  v_window_upper := v_now_ist;

  FOR r IN
    SELECT fu.id, fu.assigned_to, fu.lead_id, fu.note, fu.follow_up_time,
           l.name AS lead_name, l.company AS lead_company
      FROM public.follow_ups fu
      LEFT JOIN public.leads l ON l.id = fu.lead_id
     WHERE fu.is_done           = false
       AND fu.reminder_sent_at  IS NULL
       AND fu.follow_up_date    = v_today_ist
       AND fu.follow_up_time    IS NOT NULL
       AND (v_today_ist::timestamp + fu.follow_up_time::interval) >= v_window_lower
       AND (v_today_ist::timestamp + fu.follow_up_time::interval) <= v_window_upper
       AND fu.assigned_to       IS NOT NULL
  LOOP
    PERFORM public.enqueue_push(
      r.assigned_to,
      'Follow-up due now',
      COALESCE(r.lead_name, r.lead_company, 'Lead')
        || ' · ' || to_char(r.follow_up_time, 'HH24:MI')
        || COALESCE(' · ' || r.note, ''),
      CASE WHEN r.lead_id IS NOT NULL
           THEN '/leads/' || r.lead_id::text
           ELSE '/follow-ups'
      END,
      'followup_due'
    );
    UPDATE public.follow_ups SET reminder_sent_at = now() WHERE id = r.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

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
