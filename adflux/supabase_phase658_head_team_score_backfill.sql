-- Phase 658 (23 Nov 2026) - sales head scored on his team's average.
-- STEP 1: run db/functions/compute_daily_score.sql (the canonical function; carries the change).
-- STEP 2: run this file. Re-scores every active sales head (team_role 'sales_manager') for
--         1 Nov 2026 -> today with the team-average rule. Owner chose to re-score all of
--         November (no November salary paid to the head). Idempotent: re-running recomputes
--         the same numbers. October and earlier are not touched (function gate = 2026-11-01).
DO $$
DECLARE h uuid; x date;
BEGIN
  FOR h IN SELECT id FROM public.users WHERE team_role = 'sales_manager' AND COALESCE(is_active, true) LOOP
    FOR x IN SELECT generate_series(DATE '2026-11-01', (now() AT TIME ZONE 'Asia/Kolkata')::date, interval '1 day')::date LOOP
      PERFORM public.compute_daily_score(h, x);
    END LOOP;
  END LOOP;
END $$;

-- VERIFY: one row per head; nov_avg = team average over counted days, counted_days > 0.
SELECT u.name,
       COUNT(*) FILTER (WHERE NOT d.is_excluded)                           AS counted_days,
       ROUND(AVG(d.score_pct) FILTER (WHERE NOT d.is_excluded), 1)         AS nov_avg,
       COUNT(*) FILTER (WHERE d.excluded_reason = 'No team score yet')     AS no_team_days
  FROM public.users u
  JOIN public.daily_performance d ON d.user_id = u.id AND d.work_date >= DATE '2026-11-01'
 WHERE u.team_role = 'sales_manager' AND COALESCE(u.is_active, true)
 GROUP BY u.name;
