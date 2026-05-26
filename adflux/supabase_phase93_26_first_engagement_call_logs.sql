-- =====================================================================
-- Phase 93.26 — auto-advance lead stage on first call_logs engagement
-- 26 May 2026
--
-- WHY
--
-- Owner reported (2026-05-26): lead "best advice" assigned to Nikhil
-- shows 2 outgoing connected calls (45 sec each) in /telecaller call
-- history but lead.stage = 'New'. Activity timeline is empty.
--
-- Root cause: Nikhil dialed from his native dialer / contacts app,
-- NOT via the in-app Call button. callHistoryIngest read the native
-- log + wrote call_logs row, but no lead_activities row was inserted.
-- Phase 45.2 trigger (`trg_lead_first_engagement_advance`) only fires
-- on lead_activities INSERT, so native-dialed calls never trigger the
-- stage advance.
--
-- Fix: parallel trigger on call_logs INSERT. Fires when:
--   • lead_id IS NOT NULL (call matched to a lead by phone)
--   • duration_seconds >= 10 (qualified call, not misdial)
--   • direction != 'missed' (rep actually placed/answered, not missed)
--
-- These mirror the read-time filter used by every KPI counter post
-- Phase 93.24, so any tel-tap that counts toward "Calls today" also
-- counts toward the stage advance.
--
-- Same function body as Phase 45.2 — single source of truth for
-- "first engagement advances New → Working" semantic.
--
-- Backfill at the end: any lead currently stage='New' that has a
-- qualified lead-tied connected call_logs row gets flipped to
-- 'Working' so the historical data lines up.
--
-- Idempotent. Safe to re-run.
-- =====================================================================


-- ─── 1. Function ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lead_first_engagement_from_call_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_current_stage text;
BEGIN
  -- Only act on qualified lead-tied calls. Missed inbounds / sub-10s
  -- hangups / unmatched calls don't count.
  IF NEW.lead_id IS NULL
     OR COALESCE(NEW.duration_seconds, 0) < 10
     OR NEW.direction = 'missed' THEN
    RETURN NEW;
  END IF;

  -- Read current stage of the parent lead.
  SELECT stage INTO v_current_stage
    FROM public.leads
   WHERE id = NEW.lead_id;

  -- Only flip when stage is exactly 'New'. Working / QuoteSent /
  -- Won / Lost / Nurture all left alone.
  IF v_current_stage = 'New' THEN
    UPDATE public.leads
       SET stage      = 'Working',
           updated_at = now()
     WHERE id = NEW.lead_id;
  END IF;

  RETURN NEW;
END;
$$;


-- ─── 2. Trigger ──────────────────────────────────────────────────────
-- AFTER INSERT so the call row exists when the lead update runs.
-- DROP first so re-running this file replaces cleanly. Trigger name
-- prefix 'trg_' matches Phase 45.2's convention.
DROP TRIGGER IF EXISTS trg_lead_first_engagement_from_call_log
  ON public.call_logs;

CREATE TRIGGER trg_lead_first_engagement_from_call_log
AFTER INSERT ON public.call_logs
FOR EACH ROW
EXECUTE FUNCTION public.lead_first_engagement_from_call_log();


-- ─── 3. Backfill ─────────────────────────────────────────────────────
-- Every lead currently stage='New' that already has a qualified
-- lead-tied connected call_logs row (which the trigger would have
-- caught if it had existed at insert-time) gets flipped to 'Working'.
DO $$
DECLARE
  v_advanced int;
BEGIN
  UPDATE public.leads l
     SET stage      = 'Working',
         updated_at = now()
   WHERE l.stage = 'New'
     AND EXISTS (
       SELECT 1
         FROM public.call_logs cl
        WHERE cl.lead_id          = l.id
          AND cl.duration_seconds >= 10
          -- direction <> 'missed' with NULL evaluates to NULL → excluded,
          -- so this filter implicitly drops NULL-direction rows AND
          -- explicit missed rows. Defensive against legacy direction=NULL
          -- patched audit rows where the lead_activities INSERT already
          -- fired Phase 45.2 (which would have flipped stage already, so
          -- backfilling them is a no-op anyway).
          AND cl.direction <> 'missed'
     );
  GET DIAGNOSTICS v_advanced = ROW_COUNT;
  RAISE NOTICE '[Phase 93.26] backfilled % New → Working leads', v_advanced;
END $$;


NOTIFY pgrst, 'reload schema';


-- ─── VERIFY ──────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM pg_proc
    WHERE proname = 'lead_first_engagement_from_call_log'
      AND pronamespace = 'public'::regnamespace)                AS fn_present,
  (SELECT count(*) FROM pg_trigger
    WHERE tgname = 'trg_lead_first_engagement_from_call_log')   AS trigger_present,
  -- Any remaining 'New' leads that already have a qualified call?
  -- Should be 0 after backfill.
  (SELECT count(*) FROM public.leads l
    WHERE l.stage = 'New'
      AND EXISTS (
        SELECT 1 FROM public.call_logs cl
         WHERE cl.lead_id = l.id
           AND cl.duration_seconds >= 10
           AND (cl.direction IS NULL OR cl.direction <> 'missed')
      ))                                                        AS unflipped_new_leads_should_be_zero,
  -- Total Working leads (for owner reference).
  (SELECT count(*) FROM public.leads WHERE stage = 'Working')   AS total_working_after_backfill;
