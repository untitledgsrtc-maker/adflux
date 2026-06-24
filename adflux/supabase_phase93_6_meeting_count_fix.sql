-- =====================================================================
-- Phase 93.6 — meeting count excludes "I'm here · auto-check-in" rows
-- 25 May 2026
--
-- WHY
--
-- Owner reported (25 May 2026): "kirti did only 3 meeting but still
-- showing 6". /admin/gps/<kirti> KPI + /team-dashboard tile both
-- doubled. Audit found every real meeting save spawns a companion
-- "I'm here · auto-check-in (Xm at location)" row in lead_activities
-- with activity_type='meeting' + gps_lat populated. Two paths bump
-- the count:
--
--   1. JS filters on GpsTrackV2 / TeamDashboard counters card —
--      fixed in JSX (Phase 93.6 frontend commit).
--   2. The bump_meeting_counter trigger increments
--      work_sessions.daily_counters.meetings on EVERY meeting INSERT,
--      including the companion rows. TeamDashboard rep card reads
--      from that JSONB, so it inflates too.
--
-- This file fixes path 2 + backfills the JSONB counter for the last
-- 7 days so existing rep tiles drop from inflated → real count
-- without waiting for the next day.
--
-- =====================================================================

-- ─── 1. Update bump_meeting_counter to skip auto-check-in rows ──────
-- -------------------------------------------------------------------------
-- bump_meeting_counter REMOVED (Phase 178) — DEAD CODE, NOT consolidated.
-- Its trigger was dropped in Phase 32N; the live meeting counter is
-- lead_activity_bump_counter (db/functions/). DROP it from the live DB via
-- supabase_phase178_drop_dead_bump_meeting_counter.sql. Do NOT re-create it
-- or its trigger — re-wiring re-introduces the §33 meeting double-count.
-- -------------------------------------------------------------------------


-- ─── 2. Backfill daily_counters.meetings for last 7 days ────────────
-- Recompute the JSONB counter from the source-of-truth lead_activities
-- table, EXCLUDING companion rows. Limited to last 7 days so we don't
-- thrash history; admin / KPI tiles only render today + recent dates.
UPDATE public.work_sessions ws
   SET daily_counters = jsonb_set(
         COALESCE(ws.daily_counters, '{}'::jsonb),
         '{meetings}',
         to_jsonb((
           SELECT count(*) FROM public.lead_activities la
           WHERE la.created_by   = ws.user_id
             AND la.created_at::date = ws.work_date
             AND la.activity_type IN ('meeting', 'site_visit')
             AND (la.notes IS NULL OR la.notes NOT LIKE 'I''m here · auto-check-in%')
         ))
       )
 WHERE ws.work_date >= CURRENT_DATE - interval '7 days';


NOTIFY pgrst, 'reload schema';


-- ─── VERIFY ─────────────────────────────────────────────────────────
-- Compare counter vs source-of-truth count per rep for today IST.
-- After running this file, the two columns should match.
WITH today AS (
  SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS d
)
SELECT
  ws.user_id,
  (ws.daily_counters->>'meetings')::int  AS jsonb_counter,
  (
    SELECT count(*) FROM public.lead_activities la
    WHERE la.created_by   = ws.user_id
      AND la.created_at::date = ws.work_date
      AND la.activity_type IN ('meeting', 'site_visit')
      AND (la.notes IS NULL OR la.notes NOT LIKE 'I''m here · auto-check-in%')
  )                                       AS real_meetings_today
FROM public.work_sessions ws, today
WHERE ws.work_date = today.d
  AND (ws.daily_counters->>'meetings')::int > 0
ORDER BY jsonb_counter DESC;
