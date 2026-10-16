-- OPS PAY readiness — ONE grid, one row per ops user (read-only).
-- salary = current monthly_salary (blank = not set)
-- uptime_days / avg_uptime = uptime rows landing (last 14 IST days)  ← the gate
-- perf_days / avg_score     = pay-trigger writing score_pct
WITH d AS (SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date - 14) AS since)
SELECT
  u.name, u.role,
  sip.monthly_salary AS salary,
  (SELECT count(*)                    FROM public.ops_uptime_daily x, d WHERE x.user_id=u.id AND x.work_date>=d.since) AS uptime_days,
  (SELECT round(avg(x.uptime_pct),1)  FROM public.ops_uptime_daily x, d WHERE x.user_id=u.id AND x.work_date>=d.since) AS avg_uptime,
  (SELECT max(x.work_date)            FROM public.ops_uptime_daily x        WHERE x.user_id=u.id)                        AS last_uptime,
  (SELECT count(*)                    FROM public.daily_performance p, d WHERE p.user_id=u.id AND p.work_date>=d.since) AS perf_days,
  (SELECT round(avg(p.score_pct),1)   FROM public.daily_performance p, d WHERE p.user_id=u.id AND p.work_date>=d.since) AS avg_score
FROM public.users u
LEFT JOIN public.staff_incentive_profiles sip ON sip.user_id = u.id
WHERE u.role IN ('operation_executive','operation_head') AND u.is_active
ORDER BY u.role, u.name;
