-- supabase_ops_exec_nodata_diagnostic.sql — READ-ONLY. Why does the ops
-- executive see no data? Run each block in Supabase Studio, paste results back.
-- Diagnosis (2026-08-27): the exec is scoped to the stations assigned to them
-- (ops_depots.assigned_to = the exec); nothing auto-assigns that, so an exec
-- with no assigned station sees zero of everything.

-- ============================================================================
-- 1) WHO OWNS WHICH STATIONS?  ← the decisive check.
-- If '(( UNASSIGNED ))' holds all/most active_depots AND no
-- operation_executive row shows active_depots > 0, THAT is why the module is
-- empty. screens_covered = how many live screens each tech would see.
SELECT
  CASE WHEN d.assigned_to IS NULL THEN '(( UNASSIGNED ))'
       ELSE COALESCE(u.name, u.email, d.assigned_to::text) END AS tech,
  u.role                                          AS tech_role,
  count(DISTINCT d.id) FILTER (WHERE d.is_active) AS active_depots,
  count(s.id)          FILTER (WHERE s.is_active) AS screens_covered
FROM public.ops_depots d
LEFT JOIN public.users       u ON u.id = d.assigned_to
LEFT JOIN public.ops_screens s ON s.depot_id = d.id
GROUP BY (d.assigned_to IS NULL), d.assigned_to, u.name, u.email, u.role
ORDER BY (d.assigned_to IS NULL) DESC, active_depots DESC;

-- ============================================================================
-- 2) DO THE OPS USERS EVEN EXIST?  (only a 'testope' placeholder so far?)
SELECT id, name, email, role
  FROM public.users
 WHERE role IN ('operation_executive','operation_head')
 ORDER BY role, name;

-- ============================================================================
-- 3) IS THE SCREEN DATA REAL + LINKED TO A STATION?
-- total should be ~265; screens_with_NO_station should be 0. If > 0, the
-- aiadflux sync's depot-link step is silently failing (a real bug to fix) —
-- then even an assigned tech would see 0 screens.
SELECT
  count(*)                                  AS total_active_screens,
  count(*) FILTER (WHERE status = 'online')  AS online,
  count(*) FILTER (WHERE status = 'offline') AS offline,
  count(*) FILTER (WHERE depot_id IS NULL)   AS screens_with_NO_station
FROM public.ops_screens
WHERE is_active;

-- ============================================================================
-- 4) UPTIME-PAY (p4) STATUS — 0 rows = the uptime/salary card correctly shows
-- "no uptime data yet". Run supabase_ops_p4_uptime_pay.sql to start recording.
SELECT count(*)                                          AS uptime_rows,
       max(work_date)                                    AS latest_uptime_day
  FROM public.ops_uptime_daily;
