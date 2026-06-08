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
CREATE OR REPLACE FUNCTION public.lead_activity_bump_counter()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_already_today int;
  v_sibling_call  int;
BEGIN
  -- ── Calls branch (Phase 98.H) — byte-identical ──
  IF NEW.activity_type = 'call' THEN
    SELECT count(*)
      INTO v_sibling_call
      FROM public.call_logs cl
     WHERE cl.lead_id = NEW.lead_id
       AND cl.user_id = NEW.created_by
       AND abs(extract(epoch FROM (cl.created_at - NEW.created_at))) < 5;

    IF v_sibling_call = 0 THEN
      PERFORM public.bump_daily_counter(
        NEW.created_by,
        'calls',
        1,
        (COALESCE(NEW.created_at, now())
           AT TIME ZONE 'Asia/Kolkata')::date
      );
    END IF;
    RETURN NEW;
  END IF;

  -- ── Meeting / site_visit branch ──
  IF NEW.activity_type IN ('meeting', 'site_visit') THEN
    -- Phase 93.6 — skip "I'm here · auto-check-in" companion rows.
    IF NEW.notes IS NOT NULL
       AND NEW.notes LIKE 'I''m here · auto-check-in%' THEN
      RETURN NEW;
    END IF;

    -- Phase 103.E.2 — skip SCHEDULED FUTURE meetings. PostCallOutcomeModal
    -- logs "Meeting scheduled · <date>" as activity_type='meeting'; it is
    -- an appointment, not a done meeting, so it must not bump the KPI.
    IF NEW.notes IS NOT NULL
       AND NEW.notes LIKE 'Meeting scheduled%' THEN
      RETURN NEW;
    END IF;

    -- Phase 93.7 — revisit detection. Walk-ins (lead_id IS NULL) always
    -- bump (can't be dedupe'd).
    IF NEW.lead_id IS NOT NULL THEN
      SELECT count(*)
        INTO v_already_today
        FROM public.lead_activities prev
       WHERE prev.created_by      = NEW.created_by
         AND prev.lead_id         = NEW.lead_id
         AND prev.activity_type   IN ('meeting', 'site_visit')
         AND prev.created_at::date = NEW.created_at::date
         AND prev.id              <> NEW.id
         -- Phase 127 — a "prior visit" that makes THIS row a revisit must
         -- itself be a DONE meeting. A booking ("Meeting scheduled%") or
         -- an auto-check-in companion is NOT a done meeting, so it must
         -- not suppress a real meeting (the kirti 0-bug: a 10:48 booking
         -- ate the 13:00 real meeting's bump). Exclude BOTH.
         AND (prev.notes IS NULL
              OR (prev.notes NOT LIKE 'I''m here · auto-check-in%'
                  AND prev.notes NOT LIKE 'Meeting scheduled%'));

      IF v_already_today > 0 THEN
        RETURN NEW;
      END IF;
    END IF;

    PERFORM public.bump_daily_counter(NEW.created_by, 'meetings', 1);
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

-- ── 2. Score: dedupe meetings by lead (revisit = 1) ──────────────────
CREATE OR REPLACE FUNCTION public.compute_daily_score(p_user_id uuid, p_date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_role       text;
  v_targets    jsonb;
  v_target     int;
  v_done       int;
  v_pct        numeric;
  v_excluded   boolean := false;
  v_reason     text    := NULL;
  v_off_day    boolean := false;
  v_dow        int;
  v_activity   text;
BEGIN
  -- Phase 97.2 F-102 — caller may only compute their own score (admin/
  -- co_owner exempt). PRESERVED.
  PERFORM public._assert_self_or_admin(p_user_id);

  v_dow := EXTRACT(ISODOW FROM p_date);

  IF v_dow = 7 THEN
    v_excluded := true;
    v_reason   := 'Sunday';
  END IF;

  IF NOT v_excluded AND EXISTS (
    SELECT 1 FROM holidays WHERE holiday_date = p_date AND is_active = true
  ) THEN
    v_excluded := true;
    SELECT name INTO v_reason FROM holidays
      WHERE holiday_date = p_date AND is_active = true LIMIT 1;
    v_reason := COALESCE('Holiday: ' || v_reason, 'Holiday');
  END IF;

  IF NOT v_excluded THEN
    SELECT COALESCE(is_off_day, false), COALESCE(off_reason, '')
      INTO v_off_day, v_reason
      FROM work_sessions
     WHERE user_id = p_user_id AND work_date = p_date;
    IF v_off_day THEN
      v_excluded := true;
      v_reason   := COALESCE(NULLIF(v_reason, ''), 'Approved leave');
    END IF;
  END IF;

  SELECT role, daily_targets
    INTO v_role, v_targets
    FROM users
   WHERE id = p_user_id;

  IF v_role = 'telecaller' THEN
    -- Phase 113 (#1) — read the SAME target the rep's screen shows: the
    -- daily_targets TABLE min_calls (active row, effective_to IS NULL),
    -- NOT the abandoned users.daily_targets JSONB. NULLIF(min_calls,0)
    -- mirrors the screen's `min_calls || 50` so 0/blank → 50, never the
    -- v_target=0 → 100% guard. No JSONB fallback (screen has none).
    SELECT NULLIF(dt.min_calls, 0)
      INTO v_target
      FROM daily_targets dt
     WHERE dt.user_id = p_user_id AND dt.effective_to IS NULL
     LIMIT 1;
    v_target   := COALESCE(v_target, 50);
    v_activity := 'call';
  ELSE
    v_target   := COALESCE((v_targets->>'meetings')::int, 5);
    v_activity := 'meeting';
  END IF;

  -- Phase 110 (#5) — gate the CALL count so a tapped-but-not-dialed call
  -- never earns score. PRESERVED byte-identical.
  IF v_activity = 'call' THEN
    SELECT COUNT(*)
      INTO v_done
      FROM lead_activities la
     WHERE la.created_by    = p_user_id
       AND la.activity_type = 'call'
       AND (la.created_at AT TIME ZONE 'Asia/Kolkata')::date = p_date
       AND (
         la.outcome IS NOT NULL
         OR EXISTS (
           SELECT 1 FROM call_logs cl
            WHERE cl.user_id = p_user_id
              AND cl.lead_id = la.lead_id
              AND (cl.call_at AT TIME ZONE 'Asia/Kolkata')::date = p_date
              AND cl.duration_seconds >= 10
              AND (cl.direction IS NULL OR cl.direction <> 'missed')
         )
       );
  ELSE
    -- Phase 113 (#2) — apply the §33 done-meeting exclusions so the
    -- SCORE matches the live counter + GPS-track + evening-report
    -- counts. Scheduled future meetings ("Meeting scheduled · <date>")
    -- and auto-check-in companion rows ("I'm here · auto-check-in…")
    -- are NOT done meetings → must not earn score → incentive. The
    -- (notes IS NULL OR …) guard keeps null-note real meetings counted.
    --
    -- Phase 127 — DEDUPE by lead. A rep who meets the SAME lead twice in
    -- a day = 1 done meeting (owner rule: a revisit is not a new meeting),
    -- matching recompute_daily_meetings + the GPS-track headline + the
    -- evening report. COUNT(*) over-counted revisits → inflated score →
    -- inflated incentive. COALESCE(lead_id,id) keeps walk-ins unique.
    SELECT COUNT(DISTINCT COALESCE(la.lead_id::text, la.id::text))
      INTO v_done
      FROM lead_activities la
     WHERE la.created_by    = p_user_id
       AND la.activity_type = v_activity
       AND (la.created_at AT TIME ZONE 'Asia/Kolkata')::date = p_date
       AND (la.notes IS NULL OR la.notes NOT LIKE 'Meeting scheduled%')
       AND (la.notes IS NULL OR la.notes NOT LIKE 'I''m here · auto-check-in%');
  END IF;

  IF v_target = 0 THEN
    v_pct := 100;
  ELSE
    v_pct := LEAST(100, (v_done::numeric / v_target::numeric) * 100);
  END IF;

  INSERT INTO daily_performance (
    user_id, work_date, meetings_done, meetings_target,
    score_pct, is_excluded, excluded_reason, calculated_at
  ) VALUES (
    p_user_id, p_date, v_done, v_target,
    v_pct, v_excluded, v_reason, now()
  )
  ON CONFLICT (user_id, work_date) DO UPDATE
    SET meetings_done   = EXCLUDED.meetings_done,
        meetings_target = EXCLUDED.meetings_target,
        score_pct       = EXCLUDED.score_pct,
        is_excluded     = EXCLUDED.is_excluded,
        excluded_reason = EXCLUDED.excluded_reason,
        calculated_at   = now();
END $function$;

GRANT EXECUTE ON FUNCTION public.compute_daily_score(uuid, date) TO authenticated;

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
