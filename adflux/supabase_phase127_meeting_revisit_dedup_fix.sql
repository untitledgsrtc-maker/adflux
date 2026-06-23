-- =====================================================================
-- Phase 127 — meeting count: a BOOKING must not eat a real meeting,
--             and REVISITS must dedupe everywhere (rep + admin + score)
-- 2026-06-08 (Brijesh Solanki)
-- =====================================================================
--
-- BUG (kirti kotak, 8 Jun — three surfaces disagreed on ONE meeting):
--   rep /work hero = 0 · admin day-track = 2 · real = 1.
--   kirti's 4 meeting rows on the Devam lead (edf779a3) that day:
--     10:48  "Meeting scheduled · 12:00"   (a BOOKING for later)
--     13:00  "Demo done · awaiting approval" (the REAL done meeting)
--     14:38  "Demo done · awaiting approval" (the SAME lead again — revisit)
--     + a Coral "Meeting scheduled · 06-10" booking.
--   After the §33 rules (drop "scheduled", count a lead once/day) the
--   truth is 1.
--
-- TWO root causes, both "a non-done row is treated like a done meeting":
--
--   A) BUMP TRIGGER (rep hero = 0). lead_activity_bump_counter's revisit
--      check (Phase 93.7) excluded auto-check-in companions but NOT
--      "Meeting scheduled%" rows. So the 10:48 BOOKING counted as a
--      "prior visit" → the 13:00 real meeting looked like a revisit →
--      no bump → daily_counters.meetings stuck at 0.
--      The recompute (103.E.2) was already correct (DISTINCT lead, both
--      exclusions) — it just never re-ran for kirti, so the bad 0 stuck.
--
--   B) SCORE (compute_daily_score, 34Z.66 / Phase 113). The meeting
--      branch used COUNT(*), not COUNT(DISTINCT lead) → the 2 Devam
--      "demo done" rows scored as 2. (The §33 scheduled + auto-check-in
--      exclusions were already applied in Phase 113 #2 — kept.)
--
--   (C — admin day-track = 2 — is the FRONTEND bug, fixed in the JS
--    commit shipping alongside: uniqueMeetingCount read a.lead_id but
--    the SELECT aliases it to a.lead.id, so the lead-dedup never ran.)
--
-- OWNER RULE (8 Jun, locked): a meeting = a DISTINCT lead with >=1 DONE
--   meeting that day. A revisit — a 2nd done meeting OR an auto-check-in
--   on the same lead/day — is NOT a new meeting. A booking ("scheduled")
--   isn't a visit at all (doesn't count, doesn't suppress). Auto-check-in
--   ALONE = 0.
--
-- FIX (this file):
--   1. lead_activity_bump_counter — the revisit "prior visit" probe now
--      ignores BOTH auto-check-in AND scheduled rows, so only a prior
--      DONE meeting can mark a revisit. Full 103.E.2 body reproduced
--      VERBATIM; ONLY the revisit WHERE-clause gains the scheduled skip.
--   2. compute_daily_score — meeting branch COUNT(*) -> COUNT(DISTINCT
--      COALESCE(lead_id,id)). Full Phase 113 body reproduced VERBATIM;
--      ONLY that one aggregate changes. All security gates
--      (_assert_self_or_admin, pg_temp), the Phase 110 call gate, and the
--      Phase 113 #1 TC target + #2 exclusions are byte-preserved.
--   3. Re-heal the COUNTER for the last 7 days (recompute_daily_meetings
--      is already correct) → kirti 0 -> 1, everyone self-heals.
--
-- NO SCORE BACKFILL (owner precedent, Phase 113): past daily_performance
--   rows are NOT rewritten — incentive already paid stays. Today's scores
--   self-correct on each rep's next call/meeting insert (the AFTER-INSERT
--   trg_recompute_score_on_activity picks up the new body). A one-line
--   "recompute today only" is offered to the owner separately.
--
-- KNOWN, FLAGGED (NOT changed here — separate owner decision): the score
--   counts activity_type='meeting' only; the counter/track/report count
--   meeting + site_visit. kirti is unaffected (all 'meeting'). Adding
--   site_visit to the score would RAISE pay for site-visit reps, so it
--   needs explicit sign-off — left for a separate change.
--
-- §33 CANONICAL UPDATE: this file SUPERSEDES 103.E.2 as the canonical
--   lead_activity_bump_counter. If an OLDER meeting SQL is ever re-run,
--   re-run THIS file (127) AFTER it.
--
-- §45 / no-slowdown: both functions run the SAME number of probes as
--   before (one extra NOT LIKE on an already-scanned row set; the score
--   aggregate is DISTINCT over the same rows). No new index, no new join,
--   no extra round-trip on any rep save path. FROZEN call chain untouched.
-- =====================================================================

-- ── 1. Bump trigger: a booking is NOT a "prior visit" ────────────────
-- -------------------------------------------------------------------------
-- lead_activity_bump_counter REMOVED from this file (Phase 178).
-- Canonical: db/functions/lead_activity_bump_counter.sql
-- Do NOT re-add it here. Edit the canonical file only (§71). Trigger wiring
-- (trg_lead_activity_bump_counter) stays in phase12_m1_m7_foundation.
-- -------------------------------------------------------------------------

-- ── 2. Score: dedupe meetings by lead (revisit = 1) ──────────────────
-- -------------------------------------------------------------------------
-- compute_daily_score REMOVED from this file (Phase 178 consolidation).
-- The ONE canonical version now lives in: db/functions/compute_daily_score.sql
-- Do NOT re-add it here. To change the score, edit the canonical file only (§71).
-- -------------------------------------------------------------------------

-- ── 3. Re-heal the COUNTER for the last 7 days (no score backfill) ───
-- recompute_daily_meetings (103.E.2) is already correct (DISTINCT lead +
-- both exclusions); it just needs to re-run so the bump-bug zeros heal.
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
-- V1: the revisit probe now excludes scheduled bookings. The top skip-
--     guard uses `LIKE 'Meeting scheduled%'`; only the revisit probe uses
--     `NOT LIKE 'Meeting scheduled%'`, so finding that substring proves
--     the Phase 127 change landed. Expect TRUE.
SELECT position('NOT LIKE ''Meeting scheduled%''' IN
                pg_get_functiondef('public.lead_activity_bump_counter()'::regprocedure)) > 0
    AS revisit_excludes_scheduled;

-- V2: score now dedupes meetings by lead.
SELECT position('COUNT(DISTINCT COALESCE(la.lead_id::text, la.id::text))' IN
                pg_get_functiondef('public.compute_daily_score(uuid,date)'::regprocedure)) > 0
    AS score_dedupes_by_lead;        -- expect TRUE

-- V3: kirti's counter today should now read 1 (Devam, deduped; 2 bookings
--     dropped). Replace the id if needed.
-- SELECT (daily_counters->>'meetings') AS counter_now
--   FROM work_sessions
--  WHERE user_id = '421693b4-e03e-41dc-aa41-2d1f0c151716'
--    AND work_date = CURRENT_DATE;   -- expect 1

-- V4 (optional, owner-run if he wants TODAY's scores corrected now instead
--     of waiting for each rep's next activity insert — NOT historical):
-- DO $now$
-- DECLARE r record;
-- BEGIN
--   FOR r IN SELECT DISTINCT created_by FROM lead_activities
--             WHERE created_at::date = CURRENT_DATE AND created_by IS NOT NULL
--   LOOP PERFORM public.compute_daily_score(r.created_by, CURRENT_DATE); END LOOP;
-- END $now$;

SELECT 'Phase 127 meeting revisit + dedup fix applied' AS status;
