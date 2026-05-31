-- =====================================================================
-- Phase 103.E DIAGNOSTIC — meeting KPI shows 4, Dixita did 2 (2× bug)
-- 2026-05-31 — READ-ONLY. Inserts/updates NOTHING. Run all 4 blocks,
-- paste the results back. They pinpoint WHICH double-count path is
-- live so the fix is exact (no guess → no re-break).
--
-- Dixita user_id = caa6236a-844b-4097-8d93-f71d9b28ffae
-- (from the Phase 103.D.6 calibration — same rep).
-- =====================================================================

-- D1 — actual meeting/site_visit activities Dixita logged TODAY.
--      The truth. If this = 2 but D2 says 4 → counter is double-bumped
--      (trigger problem). If this = 4 → each save wrote TWO rows
--      (double-insert / double-submit).
SELECT id, activity_type, lead_id, created_at, left(notes, 40) AS note
  FROM public.lead_activities
 WHERE created_by = 'caa6236a-844b-4097-8d93-f71d9b28ffae'
   AND activity_type IN ('meeting', 'site_visit')
   AND created_at >= CURRENT_DATE
 ORDER BY created_at;

-- D2 — the cached counter the dashboard reads.
SELECT daily_counters
  FROM public.work_sessions
 WHERE user_id = 'caa6236a-844b-4097-8d93-f71d9b28ffae'
   AND work_date = CURRENT_DATE;

-- D3 — THE SMOKING GUN: every trigger that fires on lead_activities.
--      Look for MORE THAN ONE trigger whose function bumps
--      daily_counters.meetings. Phase 93.7's is bump_meeting_counter.
--      If a second one (e.g. an old Phase 32M trigger) is also here,
--      that's the 2×.
SELECT tgname AS trigger_name,
       pg_get_triggerdef(oid) AS definition
  FROM pg_trigger
 WHERE tgrelid = 'public.lead_activities'::regclass
   AND NOT tgisinternal
 ORDER BY tgname;

-- D4 — leads Dixita created today (her "Leads today" / new_leads also
--      looked like 4 in the screenshot; this checks if new_leads is
--      doubled too, which would point at the SAME duplicate-trigger
--      root rather than a meeting-only bug).
SELECT count(*) AS leads_created_today
  FROM public.leads
 WHERE created_by = 'caa6236a-844b-4097-8d93-f71d9b28ffae'
   AND created_at >= CURRENT_DATE;

-- =====================================================================
-- HOW TO READ IT
--   • D1 = 2  AND D2 meetings = 4  → DUPLICATE TRIGGER. D3 shows two
--     bump triggers. Fix = DROP the old one + recompute. (Phase 32n
--     redux — clean, no data loss.)
--   • D1 = 4 (four rows for two real meetings) → DOUBLE-INSERT. Fix =
--     dedupe the rows + stop the double-submit in LogMeetingModal.
--   • D4 also doubled → confirms a shared duplicate-trigger root.
-- =====================================================================
