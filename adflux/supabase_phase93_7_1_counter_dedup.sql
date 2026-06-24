-- =====================================================================
-- Phase 93.7.1 + 93.7.2 — fix meeting-counter + drop duplicate score trigger
-- 26 May 2026
--
-- WHY (93.7.1)
--
-- Diagnosis (25 May 2026 session): Phase 93.6 + 93.7 SQL updated a
-- function called `bump_meeting_counter()`. That function is DEAD —
-- no trigger references it. The LIVE counter trigger
-- `trg_lead_activity_bump_counter` calls a different function:
-- `lead_activity_bump_counter()`. That live function lacks the
-- auto-check-in + revisit guards we shipped in 93.6/93.7. Net
-- effect: every meeting INSERT bumps daily_counters.meetings,
-- including companion "I'm here · auto-check-in" rows and revisits
-- to the same lead.
--
-- Owner saw: Kirti = 5 meetings on /team-dashboard, but only 2
-- unique non-companion lead_ids in lead_activities for today.
-- 3-row inflation matches the 2 companion rows + 1 revisit.
--
-- WHY (93.7.2)
--
-- Same session also revealed duplicate score triggers:
--   tg_score_on_activity            → tg_recompute_score_on_activity()
--   trg_recompute_score_on_activity → tg_recompute_score_on_activity()
-- Both fire on every lead_activities INSERT. Score recomputes
-- twice per row. Keep tg_score_on_activity (original Phase 34Z.66
-- name), drop trg_recompute_score_on_activity (duplicate).
--
-- WHAT
--
-- 1. CREATE OR REPLACE lead_activity_bump_counter() with the
--    Phase 93.6 + 93.7 guards inlined into the meeting branch.
--    Also: include 'site_visit' in the meeting bump (was missed —
--    only 'meeting' bumped before; site_visits never counted).
-- 2. Backfill daily_counters.meetings for the last 7 days using
--    COUNT DISTINCT COALESCE(lead_id::text, 'walkin_' || id::text)
--    so revisits + walk-ins resolve correctly.
-- 3. COMMENT on the DEAD bump_meeting_counter() function so future
--    grep doesn't waste time on it. Function body NOT dropped per
--    owner's "don't change anything beyond fix scope" rule.
-- 4. DROP trg_recompute_score_on_activity (duplicate). Score now
--    fires once per activity.
--
-- Idempotent. CREATE OR REPLACE + DROP TRIGGER IF EXISTS.
-- =====================================================================

-- ─── 93.7.1 — Re-target the LIVE counter function ───────────────────
-- -------------------------------------------------------------------------
-- lead_activity_bump_counter REMOVED from this file (Phase 178).
-- Canonical: db/functions/lead_activity_bump_counter.sql
-- Do NOT re-add it here. Edit the canonical file only (§71). Trigger wiring
-- (trg_lead_activity_bump_counter) stays in phase12_m1_m7_foundation.
-- -------------------------------------------------------------------------

-- Phase 93.7.1 marked bump_meeting_counter DEAD via a COMMENT here; Phase 178 then
-- DROPPED the function (supabase_phase178_drop_dead_bump_meeting_counter.sql). The
-- COMMENT ON FUNCTION statement was removed because it would now error (42883
-- function does not exist) on re-run. The live meeting counter is
-- lead_activity_bump_counter() (db/functions/lead_activity_bump_counter.sql).


-- ─── Backfill daily_counters.meetings for last 7 days ───────────────
-- Recompute from source-of-truth. Walk-ins keyed by activity id so
-- each is unique.
UPDATE public.work_sessions ws
   SET daily_counters = jsonb_set(
         COALESCE(ws.daily_counters, '{}'::jsonb),
         '{meetings}',
         to_jsonb((
           SELECT count(DISTINCT COALESCE(la.lead_id::text, 'walkin_' || la.id::text))
             FROM public.lead_activities la
            WHERE la.created_by      = ws.user_id
              AND la.created_at::date = ws.work_date
              AND la.activity_type   IN ('meeting', 'site_visit')
              AND (la.notes IS NULL
                   OR la.notes NOT LIKE 'I''m here · auto-check-in%')
         ))
       )
 WHERE ws.work_date >= CURRENT_DATE - interval '7 days';


-- ─── 93.7.2 — Drop duplicate score trigger ──────────────────────────
DROP TRIGGER IF EXISTS trg_recompute_score_on_activity ON public.lead_activities;
-- Keep tg_score_on_activity (original Phase 34Z.66 name). Score will
-- now fire once per activity instead of twice.


NOTIFY pgrst, 'reload schema';


-- ─── VERIFY ─────────────────────────────────────────────────────────
-- After this runs:
--   * jsonb_counter and unique_meetings_today should match per rep
--   * Only 1 score trigger should remain on lead_activities
WITH today AS (
  SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS d
)
SELECT
  u.name,
  (ws.daily_counters->>'meetings')::int  AS jsonb_counter,
  (
    SELECT count(DISTINCT COALESCE(la.lead_id::text, 'walkin_' || la.id::text))
      FROM public.lead_activities la
     WHERE la.created_by      = ws.user_id
       AND la.created_at::date = ws.work_date
       AND la.activity_type   IN ('meeting', 'site_visit')
       AND (la.notes IS NULL
            OR la.notes NOT LIKE 'I''m here · auto-check-in%')
  )                                       AS unique_meetings_today
FROM public.work_sessions ws
JOIN public.users u ON u.id = ws.user_id, today
WHERE ws.work_date = today.d
  AND (ws.daily_counters->>'meetings')::int > 0
ORDER BY jsonb_counter DESC;

-- Score trigger count (should be 1).
SELECT count(*) AS score_trigger_count
  FROM pg_trigger
 WHERE tgrelid = 'public.lead_activities'::regclass
   AND tgfoid = 'public.tg_recompute_score_on_activity'::regproc
   AND NOT tgisinternal;
