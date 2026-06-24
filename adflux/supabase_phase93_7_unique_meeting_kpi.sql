-- =====================================================================
-- Phase 93.7 — meeting KPI = unique lead per day (revisits don't count)
-- 25 May 2026
--
-- WHY
--
-- Owner directive (25 May 2026): "only unique meeting can be count in
-- KPI, revisit dont count in KPi". Phase 93.6 stopped auto-check-in
-- companion rows from inflating the counter. This phase further
-- ensures a second/third visit to the SAME lead on the same day adds
-- only 1 to the rep's meeting KPI.
--
-- Walk-in meetings (lead_id IS NULL) — each counts as unique by
-- definition (no lead to dedupe against).
--
-- WHAT
--
-- 1. Replace bump_meeting_counter trigger function:
--    - Drop auto-check-in rows (already in 93.6).
--    - NEW: if this rep already has a non-companion meeting/site_visit
--      row TODAY for the same lead_id (and NEW.lead_id is not null),
--      skip the bump — it's a revisit.
--    - If NEW.lead_id IS NULL (walk-in), always bump.
--
-- 2. Backfill daily_counters.meetings for last 7 days using
--    unique-key dedupe (lead_id when present, else activity_id as
--    surrogate so walk-ins each count).
-- =====================================================================

-- -------------------------------------------------------------------------
-- bump_meeting_counter REMOVED (Phase 178) — DEAD CODE, NOT consolidated.
-- Its trigger was dropped in Phase 32N; the live meeting counter is
-- lead_activity_bump_counter (db/functions/). DROP it from the live DB via
-- supabase_phase178_drop_dead_bump_meeting_counter.sql. Do NOT re-create it
-- or its trigger — re-wiring re-introduces the §33 meeting double-count.
-- -------------------------------------------------------------------------


-- ─── Backfill daily_counters.meetings for last 7 days ───────────────
-- Unique meeting count = distinct lead_id (when present) + every
-- walk-in row (lead_id NULL). Use COUNT(DISTINCT ...) on a surrogate
-- key that's lead_id::text when set, else 'walkin_' || activity_id.
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


NOTIFY pgrst, 'reload schema';


-- ─── VERIFY ─────────────────────────────────────────────────────────
WITH today AS (
  SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS d
)
SELECT
  u.name,
  ws.user_id,
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
