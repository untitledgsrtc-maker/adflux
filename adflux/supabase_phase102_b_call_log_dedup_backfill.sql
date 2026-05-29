-- =====================================================================
-- ADFLUX → UNTITLED OS  •  PHASE 102.B SQL
-- call_logs duration zero-floor + per-minute dup cleanup
-- 2026-05-29 (Brijesh Solanki)
-- =====================================================================
--
-- WHY (Phase 102.B audit, 2026-05-29):
--   Owner screenshots show:
--   (a) LeadCallHistory rows tagged 'Missed' with duration "34 sec",
--       making missed calls look connected.
--   (b) Two identical rows at 12:36 and 12:04 for 7016696909 and
--       6353355811, both outcome='no_answer', both 0s.
--
--   Audit found:
--   (a) Android OEMs (Vivo / OPPO / Realme) return ring time in
--       CallLog.Calls.DURATION for type=MISSED. callHistoryIngest.js
--       passed that value verbatim into call_logs.duration_seconds.
--       Phase 102.B JS (callHistoryIngest.safeDuration +
--       callLogReader outcome filter) blocks NEW writes. This SQL
--       backfills historical rows so they don't look connected on
--       LeadCallHistory or inflate WorkV2 qualified-call counts.
--   (b) Two callHistoryIngest poll cycles raced past the dedupe
--       SELECT (lookup + insert is not atomic), inserting twin rows.
--       Phase 102.B JS scanInFlight mutex prevents future races.
--       Display-side dedupe in LeadCallHistory.mergeRows hides the
--       existing rows immediately. This SQL deletes the underlying
--       duplicates per Phase 93.25 part 2 pattern.
--
-- WHAT THIS FILE DOES (idempotent, re-runnable):
--   STEP 1 — probe-only counters (owner reads + decides)
--   STEP 2 — UPDATE duration_seconds=0 where outcome is non-talk
--   STEP 3 — DELETE per-minute duplicates per (user_id, client_phone)
--   STEP 4 — VERIFY counts
--
-- WHAT THIS FILE DOES NOT TOUCH:
--   - call_logs schema (no column add / drop / rename)
--   - call_logs RLS policies
--   - lead_activities (no historical fix on the activity side; the
--     timeline already reads call_logs duration via mergeRows fallback)
--   - call_logs_missed_outcome_chk CHECK constraint (Phase 93.2c)
--   - call_logs unique index (Phase 93.25.2 deferred — IMMUTABLE
--     function issue)
--
-- DEPENDENCY:
--   - call_logs.direction (Phase 56l)
--   - call_logs.outcome enum (Phase 12 + Phase 93.2c)
-- =====================================================================


-- =====================================================================
-- STEP 1 — Probe (run + read before STEP 2 / STEP 3)
-- =====================================================================
-- Paste these one-by-one. Decide whether to proceed.

-- 1.1 How many historical rows would STEP 2 zero out?
--   SELECT count(*)
--     FROM public.call_logs
--    WHERE duration_seconds IS NOT NULL
--      AND duration_seconds > 0
--      AND (direction = 'missed'
--           OR outcome IN ('no_answer','busy','wrong_number'));

-- 1.2 Per-rep breakdown of the above (sanity check Dhara / Rima):
--   SELECT user_id, count(*) AS bad_rows
--     FROM public.call_logs
--    WHERE duration_seconds > 0
--      AND (direction = 'missed'
--           OR outcome IN ('no_answer','busy','wrong_number'))
--    GROUP BY user_id ORDER BY bad_rows DESC LIMIT 10;

-- 1.3 How many per-minute duplicates would STEP 3 delete?
--   SELECT count(*) AS dup_groups
--     FROM (
--       SELECT user_id, client_phone, DATE_TRUNC('minute', call_at), count(*) AS n
--         FROM public.call_logs
--        WHERE client_phone IS NOT NULL
--        GROUP BY 1, 2, 3
--       HAVING count(*) > 1
--     ) g;

-- 1.4 Eyeball top 20 duplicate groups (last 7 days):
--   SELECT user_id, client_phone,
--          DATE_TRUNC('minute', call_at) AS minute,
--          count(*) AS n,
--          array_agg(direction)         AS directions,
--          array_agg(outcome)           AS outcomes,
--          array_agg(duration_seconds)  AS durs
--     FROM public.call_logs
--    WHERE client_phone IS NOT NULL
--      AND call_at > now() - interval '7 days'
--    GROUP BY 1, 2, 3
--   HAVING count(*) > 1
--    ORDER BY n DESC, minute DESC LIMIT 20;


-- =====================================================================
-- STEP 2 — Zero-floor duration on non-talk rows
-- =====================================================================
-- !! GUARD: STEP 2 and STEP 3 are wrapped in /* */ block comments so a
-- whole-file paste does NOT auto-execute the destructive DML. Read the
-- STEP 1 probe results first, then REMOVE the /* and */ around STEP 2
-- (and optionally STEP 3) and re-paste. Phase 102.B audit F-R203.
--
-- Re-running STEP 2 is a no-op once clean.

/* === UNCOMMENT TO RUN STEP 2 ===

DO $$
DECLARE
  v_updated int;
BEGIN
  UPDATE public.call_logs
     SET duration_seconds = 0
   WHERE duration_seconds IS NOT NULL
     AND duration_seconds > 0
     AND (direction = 'missed'
          OR outcome IN ('no_answer','busy','wrong_number'));
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE '[Phase 102.B] zeroed % non-talk call_logs rows', v_updated;
END $$;

NOTIFY pgrst, 'reload schema';

=== END STEP 2 === */


-- =====================================================================
-- STEP 3 — Delete per-minute duplicates
-- =====================================================================
-- Group rows into 60-second buckets per (user_id, client_phone).
-- Keep the row that scores highest (direction set > duration > id).
-- Mirrors Phase 93.25 part 2 — same logic, re-run safe.
-- !! GUARD: same as STEP 2 — uncomment after reading STEP 1.3 probe.

/* === UNCOMMENT TO RUN STEP 3 ===

DO $$
DECLARE
  v_deleted int;
BEGIN
  WITH dupes AS (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY
               user_id,
               client_phone,
               ROUND(EXTRACT(EPOCH FROM call_at) / 60)
             ORDER BY
               -- direction-set rows beat NULL-direction (audit) rows
               (direction IS NOT NULL) DESC,
               -- real durations beat 0 (so a real ingest row wins
               -- over an audit row that never got patched)
               (duration_seconds IS NOT NULL AND duration_seconds > 0) DESC,
               duration_seconds DESC NULLS LAST,
               id ASC
           ) AS rn
      FROM public.call_logs
     WHERE client_phone IS NOT NULL
  )
  DELETE FROM public.call_logs
   WHERE id IN (SELECT id FROM dupes WHERE rn > 1);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RAISE NOTICE '[Phase 102.B] deleted % duplicate call_logs rows', v_deleted;
END $$;

NOTIFY pgrst, 'reload schema';

=== END STEP 3 === */


-- =====================================================================
-- STEP 4 — VERIFY (paste after STEP 2 + STEP 3)
-- =====================================================================

SELECT
  -- Non-talk rows that still carry a positive duration. Should be 0.
  (SELECT count(*) FROM public.call_logs
    WHERE duration_seconds > 0
      AND (direction = 'missed'
           OR outcome IN ('no_answer','busy','wrong_number')))
    AS non_talk_with_duration_should_be_zero,
  -- Same-minute duplicates after dedup. Should be 0.
  (SELECT count(*) FROM (
     SELECT user_id, client_phone, DATE_TRUNC('minute', call_at), count(*) AS n
       FROM public.call_logs
      WHERE client_phone IS NOT NULL
      GROUP BY 1, 2, 3
     HAVING count(*) > 1
   ) dup_check)
    AS remaining_per_minute_dupes_should_be_zero,
  -- Total surviving rows (for owner reference).
  (SELECT count(*) FROM public.call_logs)
    AS total_call_logs_after_cleanup;


-- =====================================================================
-- ROLLBACK
-- =====================================================================
--
-- STEP 2 is non-destructive — historical positive durations on non-
--   talk rows are lost. There is no rollback. (Phase 93.2c CHECK
--   already prevents direction='missed' + outcome='connected'.)
--
-- STEP 3 deletions are not restorable without a backup. If a real
--   call was dedup-killed, restore via Supabase point-in-time recovery.
--
-- For future regressions, re-run STEP 2 + STEP 3 — both are idempotent.
-- =====================================================================
