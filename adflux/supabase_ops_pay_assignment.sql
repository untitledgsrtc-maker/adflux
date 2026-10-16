-- Why is ops uptime 0%/low? Check depot + screen assignment per ops exec.
-- A tech with 0 assigned screens should NOT be scored 0 (that unfairly zeroes pay).
SELECT
  u.name,
  (SELECT count(*) FROM public.ops_depots dp
     WHERE dp.assigned_to = u.id AND dp.is_active)                                        AS depots,
  (SELECT count(*) FROM public.ops_screens s JOIN public.ops_depots dp ON dp.id = s.depot_id
     WHERE dp.assigned_to = u.id AND s.is_active)                                         AS screens,
  (SELECT count(*) FROM public.ops_screens s JOIN public.ops_depots dp ON dp.id = s.depot_id
     WHERE dp.assigned_to = u.id AND s.is_active AND s.status = 'online')                 AS screens_online
FROM public.users u
WHERE u.role IN ('operation_executive','operation_head') AND u.is_active
ORDER BY u.name;

-- Today's actual uptime rows (what the pay-trigger saw)
SELECT u.name, d.work_date, d.screens_total, d.uptime_pct
FROM public.ops_uptime_daily d JOIN public.users u ON u.id = d.user_id
WHERE u.role IN ('operation_executive','operation_head')
  AND d.work_date >= ((now() AT TIME ZONE 'Asia/Kolkata')::date - 3)
ORDER BY u.name, d.work_date;
