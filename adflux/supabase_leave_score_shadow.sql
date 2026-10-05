-- supabase_leave_score_shadow.sql
-- B-ops shadow-compare (CLAUDE.md 304 #3, owner "go" 2026-10-05). READ-ONLY. Safe any time.
--
-- WHAT THIS CHECKS: before the compute_daily_score change goes in, how many people already have
-- "damaged" daily_performance rows - a score row that compute_daily_score wrote for someone who is
-- NOT meeting/call scored:
--   * hr / accounts / office_staff / staff : they should have NO counted score rows at all
--     (0 counted days = full salary). Any counted row drags their average to ~0 and wipes variable.
--   * operation_executive / operation_head : their score must come ONLY from real uptime
--     (ops_uptime_daily). A counted row with no uptime row behind it was written by compute_daily_score
--     (leave action or the nightly recompute) and overwrites the uptime score.
--
-- The function change only protects the FUTURE. This grid shows whether any PAST/current rows need a
-- one-time heal (the commented UPDATE at the bottom - current month only, never a paid month).
--
-- HOW TO READ: ONE grid, columns  step | who | item | reading | verdict.
--   PASS = nothing damaged   FIX = damaged rows found (see the heal at the bottom)   INFO = just context

WITH nonscored AS (
  SELECT u.id, u.name, u.role
    FROM public.users u
   WHERE COALESCE(u.is_active, true)
     AND u.role IN ('operation_executive','operation_head','hr','accounts','office_staff','staff')
), months AS (
  SELECT g::date AS m
    FROM generate_series(date_trunc('month', current_date - interval '2 months')::date,
                         date_trunc('month', current_date)::date,
                         interval '1 month') g
), dp AS (
  SELECT n.id, n.name, n.role, mo.m, d.work_date, d.score_pct, d.is_excluded,
         CASE WHEN n.role IN ('hr','accounts','office_staff','staff') THEN true
              ELSE NOT EXISTS (SELECT 1 FROM public.ops_uptime_daily o
                                WHERE o.user_id = d.user_id AND o.work_date = d.work_date
                                  AND o.screens_total > 0)
         END AS suspect
    FROM nonscored n
   CROSS JOIN months mo
    JOIN public.daily_performance d
      ON d.user_id = n.id
     AND d.work_date >= mo.m
     AND d.work_date <  (mo.m + interval '1 month')::date
), agg AS (
  SELECT id, name, role, m,
         count(*) FILTER (WHERE NOT is_excluded)                         AS counted_now,
         round(avg(score_pct) FILTER (WHERE NOT is_excluded), 1)         AS avg_now,
         count(*) FILTER (WHERE NOT is_excluded AND suspect)             AS suspect_counted,
         count(*) FILTER (WHERE NOT is_excluded AND NOT suspect)         AS good_counted,
         round(avg(score_pct) FILTER (WHERE NOT is_excluded AND NOT suspect), 1) AS avg_clean
    FROM dp
   GROUP BY id, name, role, m
), rows_out AS (
  SELECT 20 AS ord,
         'B - damaged rows'::text AS step,
         a.name::text AS who,
         to_char(a.m, 'Mon YYYY') || ' (' || a.role || ')' AS item,
         'counted_days_now=' || a.counted_now
           || '; avg_now=' || COALESCE(a.avg_now::text, '-')
           || '; damaged_counted_rows=' || a.suspect_counted
           || '; real_rows=' || a.good_counted
           || '; avg_if_cleaned=' || COALESCE(a.avg_clean::text, '- (0 days)')
           || '; variable_now=' || COALESCE(ms.variable_earned::text, '?')
           || ' of cap ' || COALESCE(ms.variable_cap::text, '?') AS reading,
         CASE WHEN a.suspect_counted = 0
              THEN 'PASS - no damaged rows'
              ELSE 'FIX - ' || a.suspect_counted || ' damaged counted row(s); heal below clears them'
         END AS verdict
    FROM agg a
    LEFT JOIN LATERAL public.monthly_score(a.id, a.m) ms ON true
   WHERE a.suspect_counted > 0 OR a.counted_now > 0
)
SELECT step, who, item, reading, verdict FROM (
  SELECT 0 AS ord, 'A - live nightly job'::text AS step, 'recompute_all_scores_today'::text AS who,
         'which roles the 23:45 job scores'::text AS item,
         COALESCE(substring(pg_get_functiondef(p.oid) from 'role IN \([^)]*\)'), 'filter not found')::text AS reading,
         CASE WHEN substring(pg_get_functiondef(p.oid) from 'role IN \([^)]*\)') ~ 'operation_'
              THEN 'INFO - the nightly job also feeds non-scored roles; the early return stops that'
              ELSE 'INFO - the nightly job is sales/agency/telecaller only; leave actions were the other writer' END AS verdict
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'recompute_all_scores_today'
  UNION ALL
  SELECT 10, 'A - people checked', 'non-scored roles (active)', 'headcount and months',
         (SELECT count(*) FROM nonscored)::text || ' people; months checked: ' ||
           (SELECT string_agg(to_char(m,'Mon YYYY'), ', ' ORDER BY m) FROM months),
         'INFO - ops tech/head, hr, accounts, office_staff, staff'
  UNION ALL
  SELECT ord, step, who, item, reading, verdict FROM rows_out
  UNION ALL
  SELECT 90, 'C - summary', '(all)', 'totals',
         'people with a damaged counted row: ' ||
           (SELECT count(DISTINCT id) FROM agg WHERE suspect_counted > 0)::text ||
         '; damaged rows in total: ' || COALESCE((SELECT sum(suspect_counted) FROM agg), 0)::text,
         CASE WHEN COALESCE((SELECT sum(suspect_counted) FROM agg), 0) = 0
              THEN 'PASS - nothing to heal. Run the function change; it only protects the future.'
              ELSE 'FIX - run the function change, then the commented heal below (current month only).' END
) x
ORDER BY ord, who, item;

-- ----------------------------------------------------------------------------------------------
-- ONE-TIME HEAL - COMMENTED OUT. Only if the grid above shows FIX. Run it AFTER the function change.
-- CURRENT MONTH ONLY (never touches a month that may already be paid). It does not delete anything:
-- it marks the damaged rows excluded, so they stop counting. A real uptime row is never touched.
-- To run: select the lines below and press Cmd+/ , then Run. Re-run the grid to see it clear.
--
-- UPDATE public.daily_performance d
--    SET is_excluded     = true,
--        excluded_reason = 'B-ops: not a scored role - cleared by owner decision 2026-10-05'
--   FROM public.users u
--  WHERE u.id = d.user_id
--    AND NOT d.is_excluded
--    AND d.work_date >= date_trunc('month', current_date)::date
--    AND ( u.role IN ('hr','accounts','office_staff','staff')
--       OR ( u.role IN ('operation_executive','operation_head')
--            AND NOT EXISTS (SELECT 1 FROM public.ops_uptime_daily o
--                             WHERE o.user_id = d.user_id AND o.work_date = d.work_date
--                               AND o.screens_total > 0) ) )
-- RETURNING d.user_id, d.work_date, d.score_pct, d.is_excluded;
