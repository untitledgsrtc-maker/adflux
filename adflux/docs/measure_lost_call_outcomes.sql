-- ============================================================================
-- MEASURE ONLY — "the post-call popup never appeared" (Dhara / kirti)
-- READ-ONLY. Every statement is a SELECT. Nothing is created, updated, dropped.
-- Paste into Supabase Studio one block at a time.
--
-- Column provenance (all verified against the repo, none guessed):
--   call_logs        supabase_phase12_m1_m7_foundation.sql:229
--                    + direction        supabase_phase56l_call_direction.sql:30
--                    + language         supabase_phase47_8_call_language.sql:15
--   lead_activities  supabase_phase12_m1_m7_foundation.sql:151
--                    + outcome widened  supabase_phase45_3_outcome_callback.sql
--   call_capture_log supabase_phase138_call_capture_log.sql:21
--   daily_targets    supabase_phase9_m1_daily_targets.sql
--   users            .name .role .is_active .app_version .app_version_code
--                    (supabase_phase208_app_version_report.sql:31-33)
--
-- THE SIGNAL (from the code, not a guess):
--   tel-tap  -> call_logs row, notes 'tel-tap audit...', outcome 'no_answer'
--               (src/utils/callAudit.js)
--            -> lead_activities row, activity_type 'call', OUTCOME NULL
--               (TelecallerV2.jsx:467, WorkV2.jsx:696)
--   modal save -> that same activity row is UPDATEd with a real outcome
--               (PostCallOutcomeModal.jsx:449)
--   => "modal never appeared / never saved" == lead_activities.outcome IS NULL
--      on an activity_type='call' row.
--   NOTE: call_logs.outcome is NOT a usable signal - the Phase 173 dedup
--   trigger can upgrade a tel-tap row to 'connected' from a device scan even
--   when the rep never saw the modal.
-- ============================================================================


-- ============================================================================
-- Q0  RESOLVE THE PEOPLE FIRST (do not assume roles or spellings)
-- Matters because the pay math differs: the score CALL branch only applies to
-- role='telecaller'. A role='sales' rep is scored on MEETINGS, so lost call
-- outcomes cost them nothing in pay (db/functions/compute_daily_score.sql:112).
-- ============================================================================
SELECT id, name, email, role, team_role, is_active,
       app_version, app_version_code, app_version_at
  FROM public.users
 WHERE name ILIKE '%dhara%'
    OR name ILIKE '%kirti%'
    OR role IN ('telecaller', 'sales')
 ORDER BY role, name;


-- ============================================================================
-- Q1  PER REP PER DAY, LAST 14 DAYS
--     tel-taps  ->  how many produced a lead_activities call row
--               ->  how many of those still have outcome IS NULL
-- The last column is the "modal never appeared" population.
-- ============================================================================
WITH bounds AS (
  SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date - 13) AS from_day,
         ( now() AT TIME ZONE 'Asia/Kolkata')::date       AS to_day
),
taps AS (
  SELECT cl.id, cl.user_id, cl.lead_id, cl.call_at,
         cl.duration_seconds, cl.outcome,
         (cl.call_at AT TIME ZONE 'Asia/Kolkata')::date AS ist_day
    FROM public.call_logs cl
    CROSS JOIN bounds b
   WHERE cl.direction = 'outgoing'
     AND cl.notes LIKE 'tel-tap audit%'          -- the rep physically tapped Call
     AND (cl.call_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN b.from_day AND b.to_day
),
tap_match AS (
  SELECT t.*,
         la.id               AS activity_id,
         la.outcome          AS activity_outcome,
         la.duration_seconds AS activity_seconds
    FROM taps t
    LEFT JOIN LATERAL (
      SELECT a.id, a.outcome, a.duration_seconds
        FROM public.lead_activities a
       WHERE a.created_by     = t.user_id
         AND a.lead_id        = t.lead_id
         AND a.activity_type  = 'call'
         AND a.created_at    >= t.call_at - INTERVAL '2 minutes'
         AND a.created_at    <= t.call_at + INTERVAL '10 minutes'
       ORDER BY abs(EXTRACT(EPOCH FROM (a.created_at - t.call_at)))
       LIMIT 1
    ) la ON TRUE
)
SELECT u.name AS rep,
       u.role,
       m.ist_day,
       count(*)                                                              AS tel_taps,
       count(*) FILTER (WHERE m.lead_id IS NULL)                             AS taps_with_no_lead,
       count(m.activity_id)                                                  AS taps_with_activity_row,
       count(*) FILTER (WHERE m.lead_id IS NOT NULL AND m.activity_id IS NULL)
                                                                             AS taps_missing_activity_row,
       count(*) FILTER (WHERE m.activity_id IS NOT NULL AND m.activity_outcome IS NULL)
                                                                             AS outcome_null_modal_lost,
       round(100.0 * count(*) FILTER (WHERE m.activity_id IS NOT NULL AND m.activity_outcome IS NULL)
             / NULLIF(count(m.activity_id), 0), 1)                           AS pct_lost_of_logged
  FROM tap_match m
  JOIN public.users u ON u.id = m.user_id
 GROUP BY 1, 2, 3, u.id
 ORDER BY 3 DESC, 1;
-- Reading it:
--   outcome_null_modal_lost / taps_with_activity_row = the miss rate.
--   taps_missing_activity_row is a DIFFERENT failure (the activity insert
--   itself never landed, or the Phase 68.2 same-minute unique index collapsed
--   a re-tap). Two taps on one lead inside 10 min both match the same activity
--   row, so this column is a ceiling, not an exact count.


-- ============================================================================
-- Q2  IS IT DEVICE-SPECIFIC OR UNIVERSAL?
--     Dhara + kirti vs every other rep, 14-day totals, with the reported
--     app version on each rep's phone.
-- ============================================================================
WITH bounds AS (
  SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date - 13) AS from_day,
         ( now() AT TIME ZONE 'Asia/Kolkata')::date       AS to_day
),
taps AS (
  SELECT cl.id, cl.user_id, cl.lead_id, cl.call_at,
         (cl.call_at AT TIME ZONE 'Asia/Kolkata')::date AS ist_day
    FROM public.call_logs cl
    CROSS JOIN bounds b
   WHERE cl.direction = 'outgoing'
     AND cl.notes LIKE 'tel-tap audit%'
     AND (cl.call_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN b.from_day AND b.to_day
),
tap_match AS (
  SELECT t.*, la.id AS activity_id, la.outcome AS activity_outcome
    FROM taps t
    LEFT JOIN LATERAL (
      SELECT a.id, a.outcome
        FROM public.lead_activities a
       WHERE a.created_by    = t.user_id
         AND a.lead_id       = t.lead_id
         AND a.activity_type = 'call'
         AND a.created_at   >= t.call_at - INTERVAL '2 minutes'
         AND a.created_at   <= t.call_at + INTERVAL '10 minutes'
       ORDER BY abs(EXTRACT(EPOCH FROM (a.created_at - t.call_at)))
       LIMIT 1
    ) la ON TRUE
)
SELECT CASE WHEN u.name ILIKE '%dhara%' OR u.name ILIKE '%kirti%'
            THEN 'A. reported (Dhara / kirti)' ELSE 'B. everyone else' END AS cohort,
       u.name AS rep,
       u.role,
       COALESCE(u.app_version, '(never reported)')      AS app_version,
       u.app_version_code,
       count(DISTINCT m.ist_day)                        AS active_days,
       count(*)                                         AS tel_taps_14d,
       count(m.activity_id)                             AS activity_rows,
       count(*) FILTER (WHERE m.activity_id IS NOT NULL AND m.activity_outcome IS NULL)
                                                        AS outcome_null,
       round(100.0 * count(*) FILTER (WHERE m.activity_id IS NOT NULL AND m.activity_outcome IS NULL)
             / NULLIF(count(m.activity_id), 0), 1)      AS pct_lost
  FROM tap_match m
  JOIN public.users u ON u.id = m.user_id
 GROUP BY 1, 2, 3, 4, 5, u.id
 ORDER BY 10 DESC NULLS LAST;
-- Reading it:
--   Every rep in a narrow band (e.g. all 30-50%)  -> UNIVERSAL app bug.
--   Dhara + kirti far above everyone else         -> device / OEM / app-version
--                                                    specific (check app_version).
--   Only reps on one app_version_code are high    -> a build regression.


-- ============================================================================
-- Q3A  DOES IT CLUSTER BY TIME OF DAY?  (IST hour)
-- ============================================================================
WITH bounds AS (
  SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date - 13) AS from_day,
         ( now() AT TIME ZONE 'Asia/Kolkata')::date       AS to_day
),
taps AS (
  SELECT cl.user_id, cl.lead_id, cl.call_at
    FROM public.call_logs cl
    CROSS JOIN bounds b
   WHERE cl.direction = 'outgoing'
     AND cl.notes LIKE 'tel-tap audit%'
     AND (cl.call_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN b.from_day AND b.to_day
),
tap_match AS (
  SELECT t.*, la.id AS activity_id, la.outcome AS activity_outcome
    FROM taps t
    LEFT JOIN LATERAL (
      SELECT a.id, a.outcome
        FROM public.lead_activities a
       WHERE a.created_by    = t.user_id
         AND a.lead_id       = t.lead_id
         AND a.activity_type = 'call'
         AND a.created_at   >= t.call_at - INTERVAL '2 minutes'
         AND a.created_at   <= t.call_at + INTERVAL '10 minutes'
       ORDER BY abs(EXTRACT(EPOCH FROM (a.created_at - t.call_at)))
       LIMIT 1
    ) la ON TRUE
)
SELECT u.name                                                          AS rep,
       EXTRACT(HOUR FROM (m.call_at AT TIME ZONE 'Asia/Kolkata'))::int  AS ist_hour,
       count(m.activity_id)                                            AS logged_calls,
       count(*) FILTER (WHERE m.activity_id IS NOT NULL AND m.activity_outcome IS NULL)
                                                                       AS outcome_null,
       round(100.0 * count(*) FILTER (WHERE m.activity_id IS NOT NULL AND m.activity_outcome IS NULL)
             / NULLIF(count(m.activity_id), 0), 1)                     AS pct_lost
  FROM tap_match m
  JOIN public.users u ON u.id = m.user_id
 GROUP BY 1, 2, u.id
 ORDER BY 1, 2;
-- Drop "u.name AS rep" + the GROUP BY/ORDER BY 1 to see the fleet-wide curve.


-- ============================================================================
-- Q3B  DOES IT CLUSTER BY CALL LENGTH?  (the "long call = app killed" test)
-- Duration source, best first:
--   lead_activities.duration_seconds  - written by the 60s auto-patch with NO
--     outcome filter (callLogReader.js:249), so it exists on lost calls too.
--   call_logs.duration_seconds        - on a tel-tap row this is usually the
--     device value folded in by the Phase 173 dedup trigger (also no outcome
--     filter), so it is available on lost calls as well.
-- Rows where BOTH are NULL are reported as their own bucket - do not silently
-- drop them, that bucket is itself evidence (see Q3C).
-- ============================================================================
WITH bounds AS (
  SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date - 13) AS from_day,
         ( now() AT TIME ZONE 'Asia/Kolkata')::date       AS to_day
),
taps AS (
  SELECT cl.user_id, cl.lead_id, cl.call_at, cl.duration_seconds AS cl_secs
    FROM public.call_logs cl
    CROSS JOIN bounds b
   WHERE cl.direction = 'outgoing'
     AND cl.notes LIKE 'tel-tap audit%'
     AND (cl.call_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN b.from_day AND b.to_day
),
tap_match AS (
  SELECT t.*, la.id AS activity_id, la.outcome AS activity_outcome,
         COALESCE(la.duration_seconds, t.cl_secs) AS secs
    FROM taps t
    LEFT JOIN LATERAL (
      SELECT a.id, a.outcome, a.duration_seconds
        FROM public.lead_activities a
       WHERE a.created_by    = t.user_id
         AND a.lead_id       = t.lead_id
         AND a.activity_type = 'call'
         AND a.created_at   >= t.call_at - INTERVAL '2 minutes'
         AND a.created_at   <= t.call_at + INTERVAL '10 minutes'
       ORDER BY abs(EXTRACT(EPOCH FROM (a.created_at - t.call_at)))
       LIMIT 1
    ) la ON TRUE
)
SELECT u.name AS rep,
       CASE
         WHEN m.secs IS NULL   THEN '0 unknown (no duration captured at all)'
         WHEN m.secs < 10      THEN '1 under 10s'
         WHEN m.secs < 30      THEN '2 10-29s'
         WHEN m.secs < 60      THEN '3 30-59s'
         WHEN m.secs < 120     THEN '4 1-2 min'
         WHEN m.secs < 300     THEN '5 2-5 min'
         ELSE                       '6 over 5 min'
       END                                                              AS duration_bucket,
       count(m.activity_id)                                             AS logged_calls,
       count(*) FILTER (WHERE m.activity_id IS NOT NULL AND m.activity_outcome IS NULL)
                                                                        AS outcome_null,
       round(100.0 * count(*) FILTER (WHERE m.activity_id IS NOT NULL AND m.activity_outcome IS NULL)
             / NULLIF(count(m.activity_id), 0), 1)                      AS pct_lost
  FROM tap_match m
  JOIN public.users u ON u.id = m.user_id
 GROUP BY 1, 2, u.id
 ORDER BY 1, 2;
-- Reading it: if pct_lost RISES with duration (worst in the 2-5 min / 5 min+
-- buckets) the "long call, app killed" story holds. If pct_lost is FLAT across
-- buckets, call length is not the driver.


-- ============================================================================
-- Q3C  THE DIRECT "WAS THE APP STILL ALIVE?" PROBE   <-- strongest single test
--
-- After every tel-tap the page sets a 60-second timer (TelecallerV2.jsx:502,
-- WorkV2 same pattern). When it fires it writes ONE diagnostic row into
-- call_capture_log with patch_path='auto60'. That timer lives in the page's
-- JS: if the OS killed the app during the call, the timer NEVER fires and
-- NO auto60 row exists for that call.
--
-- So, for calls where the modal outcome was lost:
--   no auto60 row  -> the app was dead within 60s  -> APP-KILLED CONFIRMED
--   auto60 row present -> the app was alive at T+60s -> app-kill REFUTED for
--                         that call; the modal opened and was dismissed, or
--                         the rep navigated away, or the modal never rendered.
-- The saved-calls row is the control group. Compare the two percentages.
--
-- CAVEAT: call_capture_log only started 12 Jun 2026 (Phase 138) and only the
-- native app writes it. If BOTH columns are ~0 for a rep, that rep's phone is
-- not writing the diagnostic at all - that is inconclusive, NOT a confirmation.
-- Run Q3D first to see whether the rep is producing capture rows at all.
-- ============================================================================
WITH bounds AS (
  SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date - 13) AS from_day,
         ( now() AT TIME ZONE 'Asia/Kolkata')::date       AS to_day
),
taps AS (
  SELECT cl.user_id, cl.lead_id, cl.call_at
    FROM public.call_logs cl
    CROSS JOIN bounds b
   WHERE cl.direction = 'outgoing'
     AND cl.notes LIKE 'tel-tap audit%'
     AND cl.lead_id IS NOT NULL
     AND (cl.call_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN b.from_day AND b.to_day
),
tap_match AS (
  SELECT t.*, la.id AS activity_id, la.outcome AS activity_outcome
    FROM taps t
    LEFT JOIN LATERAL (
      SELECT a.id, a.outcome
        FROM public.lead_activities a
       WHERE a.created_by    = t.user_id
         AND a.lead_id       = t.lead_id
         AND a.activity_type = 'call'
         AND a.created_at   >= t.call_at - INTERVAL '2 minutes'
         AND a.created_at   <= t.call_at + INTERVAL '10 minutes'
       ORDER BY abs(EXTRACT(EPOCH FROM (a.created_at - t.call_at)))
       LIMIT 1
    ) la ON TRUE
),
probe AS (
  SELECT m.*,
         EXISTS (
           SELECT 1
             FROM public.call_capture_log c
            WHERE c.user_id    = m.user_id
              AND c.lead_id    = m.lead_id
              AND c.patch_path = 'auto60'
              AND c.created_at >= m.call_at + INTERVAL '45 seconds'
              AND c.created_at <= m.call_at + INTERVAL '15 minutes'
         ) AS app_alive_at_60s
    FROM tap_match m
   WHERE m.activity_id IS NOT NULL
)
SELECT u.name AS rep,
       CASE WHEN p.activity_outcome IS NULL
            THEN 'LOST (no outcome saved)' ELSE 'saved (control group)' END AS call_group,
       count(*)                                                    AS calls,
       count(*) FILTER (WHERE p.app_alive_at_60s)                  AS app_alive_at_60s,
       count(*) FILTER (WHERE NOT p.app_alive_at_60s)              AS no_auto60_row,
       round(100.0 * count(*) FILTER (WHERE NOT p.app_alive_at_60s)
             / NULLIF(count(*), 0), 1)                             AS pct_app_probably_killed
  FROM probe p
  JOIN public.users u ON u.id = p.user_id
 GROUP BY 1, 2, u.id
 ORDER BY 1, 2;


-- ============================================================================
-- Q3D  THE RAW CAPTURE LOG (Phase 138 instrumentation, per rep)
-- Use this to (a) confirm each rep's phone is writing capture rows at all, and
-- (b) read the backgrounding signal directly.
-- app_backgrounded FALSE / bg_signal 'none' = the dialer handoff never
-- backgrounded the WebView, the documented root of the away-timer never firing.
-- ============================================================================
SELECT u.name                                            AS rep,
       c.patch_path,
       c.device_permission,
       c.app_backgrounded,
       c.bg_signal,
       count(*)                                          AS attempts,
       count(*) FILTER (WHERE c.final_seconds IS NULL)   AS saved_null_duration,
       count(*) FILTER (WHERE c.counted)                 AS counted_10s_plus
  FROM public.call_capture_log c
  LEFT JOIN public.users u ON u.id = c.user_id
 WHERE c.created_at >= now() - INTERVAL '14 days'
 GROUP BY 1, 2, 3, 4, 5, c.user_id
 ORDER BY 1, 6 DESC;


-- ============================================================================
-- Q3E  OPTIONAL CORROBORATION - did the OS actually kill the app that day?
-- force_stop_events is written by the native heartbeat (Phase 76.1 / 76.2).
-- If this returns 0 rows the watcher is not running on those phones -> the
-- result is INCONCLUSIVE, it does not refute anything. Q3C is the real test.
-- ============================================================================
SELECT u.name AS rep,
       (f.relaunched_at AT TIME ZONE 'Asia/Kolkata')::date AS ist_day,
       count(*)                                            AS force_stops,
       round(avg(f.gap_seconds) / 60.0, 1)                 AS avg_gap_minutes,
       count(*) FILTER (WHERE f.during_work_hours)         AS during_work_hours
  FROM public.force_stop_events f
  JOIN public.users u ON u.id = f.user_id
 WHERE f.relaunched_at >= now() - INTERVAL '14 days'
 GROUP BY 1, 2, u.id
 ORDER BY 2 DESC, 1;


-- ============================================================================
-- Q4A  PAY IMPACT - how many calls would have counted toward score but did not
--
-- This mirrors db/functions/compute_daily_score.sql:132-149 exactly.
-- A call activity earns score when:
--     outcome IS NOT NULL
--  OR a call_logs row exists for the same rep + lead + IST day with
--     duration_seconds >= 10 and direction <> 'missed'.
--
-- So a lost-modal call is NOT automatically lost pay - if the device duration
-- landed and is >= 10s it still counts. The genuine pay hole is:
--     outcome IS NULL  AND  no >=10s call_logs proof.
--
-- Only role='telecaller' is scored on calls. Sales reps are scored on meetings,
-- so their lost outcomes cost zero pay (they still distort call KPIs).
-- ============================================================================
WITH bounds AS (
  SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date - 13) AS from_day,
         ( now() AT TIME ZONE 'Asia/Kolkata')::date       AS to_day
),
acts AS (
  SELECT a.id,
         a.created_by AS user_id,
         a.lead_id,
         a.outcome,
         (a.created_at AT TIME ZONE 'Asia/Kolkata')::date AS ist_day
    FROM public.lead_activities a
    CROSS JOIN bounds b
   WHERE a.activity_type = 'call'
     AND (a.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN b.from_day AND b.to_day
),
scored AS (
  SELECT x.*,
         EXISTS (
           SELECT 1
             FROM public.call_logs cl
            WHERE cl.user_id = x.user_id
              AND cl.lead_id = x.lead_id
              AND (cl.call_at AT TIME ZONE 'Asia/Kolkata')::date = x.ist_day
              AND cl.duration_seconds >= 10
              AND (cl.direction IS NULL OR cl.direction <> 'missed')
         ) AS has_10s_proof
    FROM acts x
),
per_day AS (
  SELECT user_id,
         ist_day,
         count(*)                                                          AS call_activities,
         count(*) FILTER (WHERE outcome IS NOT NULL OR has_10s_proof)      AS counts_now,
         count(*) FILTER (WHERE outcome IS NULL)                           AS outcome_null_total,
         count(*) FILTER (WHERE outcome IS NULL AND NOT has_10s_proof)     AS lost_to_score,
         count(*) FILTER (WHERE outcome IS NULL AND has_10s_proof)         AS rescued_by_duration
    FROM scored
   GROUP BY 1, 2
),
tgt AS (
  -- DISTINCT ON so a rep with two open target rows cannot multiply the join.
  -- compute_daily_score itself uses LIMIT 1 on the same filter.
  SELECT DISTINCT ON (dt.user_id)
         dt.user_id, COALESCE(NULLIF(dt.min_calls, 0), 50) AS target
    FROM public.daily_targets dt
   WHERE dt.effective_to IS NULL
   ORDER BY dt.user_id, dt.effective_from DESC
)
SELECT u.name AS rep,
       u.role,
       p.ist_day,
       COALESCE(t.target, 50)                                              AS target,
       p.call_activities,
       p.counts_now                                                        AS scored_now,
       p.rescued_by_duration,
       p.lost_to_score,
       LEAST(100, round(100.0 * p.counts_now / COALESCE(t.target, 50), 1))                   AS score_pct_now,
       LEAST(100, round(100.0 * (p.counts_now + p.lost_to_score) / COALESCE(t.target, 50), 1)) AS score_pct_if_none_lost,
       LEAST(100, round(100.0 * (p.counts_now + p.lost_to_score) / COALESCE(t.target, 50), 1))
       - LEAST(100, round(100.0 * p.counts_now / COALESCE(t.target, 50), 1))                  AS score_points_lost,
       dp.score_pct                                                        AS stored_score_pct,
       dp.is_excluded
  FROM per_day p
  JOIN public.users u        ON u.id = p.user_id
  LEFT JOIN tgt t            ON t.user_id = p.user_id
  LEFT JOIN public.daily_performance dp
                             ON dp.user_id = p.user_id AND dp.work_date = p.ist_day
 WHERE u.role = 'telecaller'
 ORDER BY 3 DESC, 1;
-- stored_score_pct should equal score_pct_now. If it does not, the stored
-- daily_performance row is stale (compute_daily_score only reruns on the next
-- activity insert) - that is a separate finding worth reporting.


-- ============================================================================
-- Q4B  PAY IMPACT IN RUPEES (current month, telecallers)
-- Conversion is exactly db/functions/monthly_score.sql:
--     variable_cap    = monthly_salary * 0.30
--     variable_earned = (avg_score_pct / 100) * variable_cap
--                       ... but 0 when avg < 50, and the full cap when the rep
--                       did 3x their salary in business (Phase 184 Rule 1).
-- The rupee column below is therefore an UPPER BOUND on the loss: it is void
-- if the rep is already at 100% or already hit the 3x-business override.
-- ============================================================================
WITH month AS (
  SELECT date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))::date AS m_start
),
acts AS (
  SELECT a.created_by AS user_id,
         a.lead_id,
         a.outcome,
         (a.created_at AT TIME ZONE 'Asia/Kolkata')::date AS ist_day
    FROM public.lead_activities a
    CROSS JOIN month mo
   WHERE a.activity_type = 'call'
     AND (a.created_at AT TIME ZONE 'Asia/Kolkata')::date >= mo.m_start
),
scored AS (
  SELECT x.*,
         EXISTS (
           SELECT 1 FROM public.call_logs cl
            WHERE cl.user_id = x.user_id
              AND cl.lead_id = x.lead_id
              AND (cl.call_at AT TIME ZONE 'Asia/Kolkata')::date = x.ist_day
              AND cl.duration_seconds >= 10
              AND (cl.direction IS NULL OR cl.direction <> 'missed')
         ) AS has_10s_proof
    FROM acts x
),
per_day AS (
  SELECT user_id, ist_day,
         count(*) FILTER (WHERE outcome IS NOT NULL OR has_10s_proof)      AS counts_now,
         count(*) FILTER (WHERE outcome IS NULL AND NOT has_10s_proof)     AS lost_to_score
    FROM scored GROUP BY 1, 2
),
tgt AS (
  SELECT DISTINCT ON (dt.user_id)
         dt.user_id, COALESCE(NULLIF(dt.min_calls, 0), 50) AS target
    FROM public.daily_targets dt WHERE dt.effective_to IS NULL
   ORDER BY dt.user_id, dt.effective_from DESC
),
salary AS (
  SELECT DISTINCT ON (sip.user_id) sip.user_id, sip.monthly_salary
    FROM public.staff_incentive_profiles sip
   ORDER BY sip.user_id
),
day_scores AS (
  SELECT p.user_id, p.ist_day,
         LEAST(100, 100.0 * p.counts_now / COALESCE(t.target, 50))                     AS pct_now,
         LEAST(100, 100.0 * (p.counts_now + p.lost_to_score) / COALESCE(t.target, 50)) AS pct_healed,
         p.lost_to_score
    FROM per_day p
    LEFT JOIN tgt t ON t.user_id = p.user_id
    LEFT JOIN public.daily_performance dp
           ON dp.user_id = p.user_id AND dp.work_date = p.ist_day
   WHERE COALESCE(dp.is_excluded, false) = false      -- monthly_score ignores excluded days
)
SELECT u.name AS rep,
       count(*)                                            AS scored_days,
       sum(d.lost_to_score)                                AS calls_lost_this_month,
       round(avg(d.pct_now), 1)                            AS avg_score_now,
       round(avg(d.pct_healed), 1)                         AS avg_score_if_none_lost,
       s.monthly_salary,
       round(s.monthly_salary * 0.30, 0)                   AS variable_cap,
       round((avg(d.pct_now)    / 100.0) * s.monthly_salary * 0.30, 0) AS variable_now,
       round((avg(d.pct_healed) / 100.0) * s.monthly_salary * 0.30, 0) AS variable_if_none_lost,
       round(((avg(d.pct_healed) - avg(d.pct_now)) / 100.0) * s.monthly_salary * 0.30, 0)
                                                           AS rupees_at_risk_upper_bound
  FROM day_scores d
  JOIN public.users u ON u.id = d.user_id
  LEFT JOIN salary s ON s.user_id = d.user_id
 WHERE u.role = 'telecaller'
 GROUP BY u.id, u.name, s.monthly_salary
 ORDER BY 10 DESC NULLS LAST;
