-- supabase_phase113_score_target_and_meeting_fix.sql
-- Phase 113 (2026-06-05) — TWO score/incentive corrections in ONE
-- CREATE OR REPLACE of compute_daily_score. Owner decision: FUNCTION
-- ONLY, NO BACKFILL (past scores left as-is; from the next activity
-- insert each rep's TODAY self-corrects via the AFTER-INSERT trigger).
--
-- ─── BUG #1 — Telecaller calls-target read from the WRONG store ───
-- The score read the TC calls-target from users.daily_targets JSONB
-- (->>'calls'), seeded to 20 in Phase 32m and NEVER maintained — while
-- every screen + the evening report read the daily_targets TABLE
-- min_calls (default 50). Result: a TC doing 20 real calls scored
-- 100% (20/20) while their ring showed 40% (20/50) → score → incentive
-- inflated ~2.5×.
-- FIX: the TC branch now reads the SAME daily_targets TABLE min_calls
-- the rep's screen shows (active row, effective_to IS NULL). NULLIF(
-- min_calls,0) mirrors the screen's `min_calls || 50` truthiness so a
-- 0/blank target falls to 50 — NOT to the v_target=0 → 100% guard.
-- No JSONB middle fallback: the screen never reads JSONB, so a TC with
-- no table row gets 50 on BOTH the screen and the score (not 20).
--
-- ─── BUG #2 — Sales meeting branch ignored the §33 exclusions ─────
-- The meeting count (sales/agency) counted EVERY activity_type='meeting'
-- row — including scheduled future meetings ("Meeting scheduled · …",
-- PostCallOutcomeModal) and auto-check-in companion rows ("I'm here ·
-- auto-check-in…"). The live counter (lead_activity_bump_counter,
-- phase103_e2), the GPS-track page, and the evening report (phase110 #2)
-- all EXCLUDE these; the score function was the one surface that didn't
-- → sales score on those days was inflated. Closes the §44.8 KNOWN-OPEN
-- gap and brings the score into §33 lockstep with the other surfaces.
-- FIX: add the two §33 notes exclusions to the meeting branch ONLY.
--
-- ⚠ BASE = the LIVE Phase 110 body (supabase_phase110_score_real_calls
--   .sql). Phase 110's TC call-count gate (outcome IS NOT NULL OR a
--   ≥10s call_logs row) is PRESERVED byte-identical — Bug #1 changes
--   the TARGET, not the count. The Phase 97.2 security gates
--   (_assert_self_or_admin + SET search_path = public, pg_temp) are
--   PRESERVED. The Sunday/holiday/leave exclusion block, the
--   v_target=0 guard, the LEAST cap, and the daily_performance upsert
--   are PRESERVED.
--
-- Idempotent (CREATE OR REPLACE). Trigger DDL untouched — the existing
-- AFTER-INSERT trigger trg_recompute_score_on_activity picks up the new
-- body automatically. No schema change beyond the function body; NOTIFY
-- pgrst reloads the API.
--
-- PERF (§45 no-slowdown): Bug #1 adds ONE single-row indexed probe on
-- daily_targets (covered by the partial unique index
-- daily_targets_one_active_per_user ON (user_id) WHERE effective_to IS
-- NULL) inside the score function, which runs in an AFTER-INSERT trigger
-- on lead_activities. One extra index lookup per scored insert —
-- negligible, and it only runs for telecaller-role inserts.

-- -------------------------------------------------------------------------
-- compute_daily_score REMOVED from this file (Phase 178 consolidation).
-- The ONE canonical version now lives in: db/functions/compute_daily_score.sql
-- Do NOT re-add it here. To change the score, edit the canonical file only (§71).
-- -------------------------------------------------------------------------

NOTIFY pgrst, 'reload schema';


-- ─── VERIFY — all five must be true ──────────────────────────────────
SELECT
  (def ILIKE '%_assert_self_or_admin%')   AS security_gate_present,     -- F-102 preserved
  (def ILIKE '%call_logs%')               AS call_gate_present,         -- Phase 110 preserved
  (def ILIKE '%public, pg_temp%')         AS pg_temp_hardening,         -- F-104 preserved
  (def ILIKE '%Meeting scheduled%')       AS meeting_exclusion_present, -- Phase 113 #2 applied
  (def ILIKE '%daily_targets dt%')        AS tc_target_from_table       -- Phase 113 #1 applied
FROM (
  SELECT pg_get_functiondef('public.compute_daily_score(uuid,date)'::regprocedure) AS def
) s;


-- ════════════════════════════════════════════════════════════════════
-- BEFORE / AFTER — READ-ONLY. Zero writes. Run to SEE the impact of both
-- fixes for TODAY (IST) before relying on the corrected scores.
-- ════════════════════════════════════════════════════════════════════
-- (1) Telecaller target source — OLD JSONB target vs NEW table target.
WITH d AS (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS today)
SELECT
  u.name,
  COALESCE((u.daily_targets->>'calls')::int, 50)                          AS old_target_jsonb,
  COALESCE(NULLIF((SELECT dt.min_calls FROM daily_targets dt
                    WHERE dt.user_id = u.id AND dt.effective_to IS NULL
                    LIMIT 1), 0), 50)                                     AS new_target_table,
  (SELECT COUNT(*) FROM lead_activities la, d
     WHERE la.created_by = u.id AND la.activity_type = 'call'
       AND (la.created_at AT TIME ZONE 'Asia/Kolkata')::date = d.today
       AND ( la.outcome IS NOT NULL
          OR EXISTS (SELECT 1 FROM call_logs cl, d d2
                      WHERE cl.user_id = u.id AND cl.lead_id = la.lead_id
                        AND (cl.call_at AT TIME ZONE 'Asia/Kolkata')::date = d2.today
                        AND cl.duration_seconds >= 10
                        AND (cl.direction IS NULL OR cl.direction <> 'missed')) )) AS real_calls_today
  FROM public.users u
 WHERE u.role = 'telecaller' AND u.is_active = true
 ORDER BY u.name;

-- (2) Sales meeting exclusions — OLD count (all meetings) vs NEW count
--     (done meetings only) for TODAY.
WITH d AS (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS today)
SELECT
  u.name,
  (SELECT COUNT(*) FROM lead_activities la, d
     WHERE la.created_by = u.id AND la.activity_type = 'meeting'
       AND (la.created_at AT TIME ZONE 'Asia/Kolkata')::date = d.today)            AS old_meetings,
  (SELECT COUNT(*) FROM lead_activities la, d
     WHERE la.created_by = u.id AND la.activity_type = 'meeting'
       AND (la.created_at AT TIME ZONE 'Asia/Kolkata')::date = d.today
       AND (la.notes IS NULL OR la.notes NOT LIKE 'Meeting scheduled%')
       AND (la.notes IS NULL OR la.notes NOT LIKE 'I''m here · auto-check-in%'))   AS new_meetings
  FROM public.users u
 WHERE u.role IN ('sales','agency') AND u.is_active = true
 ORDER BY u.name;


-- ════════════════════════════════════════════════════════════════════
-- OPTIONAL BACKFILL — NOT RUN per owner decision (2026-06-05): "function
-- only, no backfill." Past stored scores stay as-is. Each rep's TODAY
-- self-corrects on the next call/meeting insert (the AFTER-INSERT
-- trigger recomputes). The block below is kept, commented, for the
-- record only — DO NOT run without explicit owner sign-off, as it would
-- LOWER some already-computed scores (and the incentive they feed).
-- ════════════════════════════════════════════════════════════════════
-- DO $$
-- DECLARE r record; d date;
--   m_start date := date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata')::date)::date;
--   m_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
-- BEGIN
--   FOR r IN SELECT id FROM public.users
--             WHERE role IN ('telecaller','sales','agency') LOOP
--     d := m_start;
--     WHILE d <= m_today LOOP
--       PERFORM public.compute_daily_score(r.id, d);
--       d := d + 1;
--     END LOOP;
--   END LOOP;
-- END $$;
