-- =====================================================================
-- Phase 103.E.2 — scheduled (future) meetings must not count as DONE
-- 2026-05-31 (Brijesh Solanki)
-- =====================================================================
--
-- BUG (diagnosed 31 May, Dixita — follow-up to 103.E.1):
--   She did 2 real field meetings, but the MEET KPI showed 3. The 3rd
--   row:
--       16:15  "Meeting scheduled · 2026-06-01"  (no GPS, lead exists)
--   is a FUTURE appointment she booked for tomorrow — logged by
--   PostCallOutcomeModal.jsx:697 as activity_type='meeting' with the
--   note "Meeting scheduled · <date>". It is NOT a meeting that
--   happened. It was inflating the done-meeting count by 1.
--
-- ROOT CAUSE:
--   The meeting KPI counts every activity_type IN ('meeting','site_visit')
--   row except auto-check-in companions. Scheduled-future meetings share
--   activity_type='meeting', so they leaked into the DONE count. The
--   "Meeting scheduled · " note prefix is the discriminator (only
--   PostCallOutcomeModal writes it — confirmed single source).
--
-- FIX (mirror the existing auto-check-in exclusion, everywhere meetings
--      are counted):
--   1. lead_activity_bump_counter (insert trigger) — skip the bump for
--      "Meeting scheduled%" rows, exactly like the auto-check-in skip.
--      Full Phase 98.H body reproduced VERBATIM with ONLY the new skip
--      added (calls branch + 93.7 revisit dedup byte-identical).
--   2. recompute_daily_meetings (103.E.1) — add the same exclusion so
--      the recompute + insert agree.
--   3. Re-heal last 7 days -> Dixita 3 -> 2.
--   (Frontend GpsTrackV2 uniqueMeetingCount gets the same exclusion in
--    the JS commit that ships alongside this.)
--
-- The scheduled row STAYS in the lead timeline (the rep still sees
-- "meeting booked for tomorrow") — it just stops counting as done.
--
-- NOTE (unchanged from 103.E.1): a day whose meetings were inflated may
--   have an inflated SCORE (compute_daily_score, 34Z.66) — that reads
--   meeting activities too and would also count scheduled rows. Flagged;
--   score recompute is a separate ask.
-- =====================================================================

-- ── 1. Insert trigger: skip scheduled-future meetings ────────────────
-- -------------------------------------------------------------------------
-- lead_activity_bump_counter REMOVED from this file (Phase 178).
-- Canonical: db/functions/lead_activity_bump_counter.sql
-- Do NOT re-add it here. Edit the canonical file only (§71). Trigger wiring
-- (trg_lead_activity_bump_counter) stays in phase12_m1_m7_foundation.
-- -------------------------------------------------------------------------

-- ── 2. Recompute: same exclusion (insert + recompute must agree) ─────
-- -------------------------------------------------------------------------
-- recompute_daily_meetings REMOVED from this file (Phase 178).
-- Canonical: db/functions/recompute_daily_meetings.sql
-- Do NOT re-add it here. Edit the canonical file only (§71). Trigger wiring
-- (trg_lead_activity_meeting_recount_del) stays in phase103_e1.
-- -------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.recompute_daily_meetings(uuid, date) FROM PUBLIC;

-- ── 3. Re-heal last 7 days (now drops scheduled rows) ────────────────
DO $heal$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT user_id, work_date
      FROM public.work_sessions
     WHERE work_date >= CURRENT_DATE - 6
  LOOP
    PERFORM public.recompute_daily_meetings(r.user_id, r.work_date);
  END LOOP;
END
$heal$;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- VERIFY
-- =====================================================================
-- V1: Dixita now = 2 (the 2 real field meetings; scheduled-tomorrow drops)
--   SELECT (daily_counters->>'meetings') AS counter_now
--     FROM work_sessions
--    WHERE user_id = 'caa6236a-844b-4097-8d93-f71d9b28ffae'
--      AND work_date = CURRENT_DATE;
--   Expected: 2.
--
-- V2: the insert trigger now skips scheduled rows — the live function
--     body contains the new guard.
--   SELECT pg_get_functiondef('public.lead_activity_bump_counter()'::regprocedure)
--     LIKE '%Meeting scheduled%%' AS skips_scheduled;
--   Expected: true.
-- =====================================================================
