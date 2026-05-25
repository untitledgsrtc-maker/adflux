-- =====================================================================
-- Phase 93.2c — call_logs data integrity: backfill + CHECK constraint
-- 24 May 2026
--
-- WHY
--
-- Owner reported (24 May 2026): Rima TeamDashboard showed 2/50 qualified
-- calls but /admin/gps drill-down showed qualified=1. Audit found a
-- call_logs row with direction='missed' AND outcome='connected' — a
-- combination that contradicts the data model.
--
-- Root cause: PostCallOutcomeModal.handleSave patched call_logs rows
-- by (user_id, lead_id, call_at >= now-10min) without filtering on
-- direction. When a rep returned a missed inbound within 10 minutes
-- of the original missed call, the modal save UPDATE caught the
-- missed-inbound row too and stamped outcome='connected'. Frontend
-- fix landed in commit 031ef4e (93.1) at read-time and current
-- 93.2c commit fixes the write-time path.
--
-- This file handles the DB side:
--
-- 1. Backfill — repair existing mis-tagged rows.
-- 2. CHECK constraint — block direction='missed' + outcome='connected'
--    at the DB layer so any future regression fails loudly instead
--    of silently overstating KPIs.
-- =====================================================================

-- ─── 1. Backfill — repair existing mis-tagged rows ──────────────────
-- Set outcome back to 'no_answer' on any row where direction='missed'
-- but outcome='connected'. Inbound missed = no human conversation.
-- Print the count for audit.
DO $$
DECLARE
  v_repaired int;
BEGIN
  UPDATE public.call_logs
     SET outcome = 'no_answer'
   WHERE direction = 'missed'
     AND outcome   = 'connected';
  GET DIAGNOSTICS v_repaired = ROW_COUNT;
  RAISE NOTICE '[Phase 93.2c] repaired % missed+connected rows', v_repaired;
END $$;


-- ─── 2. CHECK constraint — prevent recurrence ───────────────────────
-- direction='missed' must NEVER pair with outcome='connected'. Allow
-- 'no_answer' (default), 'callback_requested' (rep schedules return
-- call), NULL (legacy). Block 'connected' explicitly.
--
-- DROP first so re-runs are idempotent.
ALTER TABLE public.call_logs
  DROP CONSTRAINT IF EXISTS call_logs_missed_outcome_chk;

ALTER TABLE public.call_logs
  ADD CONSTRAINT call_logs_missed_outcome_chk
  CHECK (
    direction <> 'missed'
    OR outcome IS NULL
    OR outcome IN ('no_answer', 'callback_requested')
  );

COMMENT ON CONSTRAINT call_logs_missed_outcome_chk ON public.call_logs IS
  'Phase 93.2c — prevents direction=missed + outcome=connected combos. '
  'Missed inbound calls have no human conversation, so cannot be '
  '''connected''. Allowed outcomes for missed: NULL, no_answer, '
  'callback_requested.';


NOTIFY pgrst, 'reload schema';


-- ─── VERIFY ─────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM public.call_logs
    WHERE direction = 'missed' AND outcome = 'connected')
    AS bad_rows_remaining,
  (SELECT count(*) FROM pg_constraint
    WHERE conname = 'call_logs_missed_outcome_chk')
    AS constraint_present,
  -- Spot-check: 7-day audit of remaining inbound rows by outcome
  (SELECT json_object_agg(outcome, n) FROM (
     SELECT outcome, count(*) AS n
       FROM public.call_logs
      WHERE direction = 'missed'
        AND call_at >= now() - interval '7 days'
      GROUP BY outcome
   ) t)
    AS missed_outcome_distribution_7d;
