-- Tidy: align ops execs' stale team_role ('sales', a leftover from the old
-- convert flow) to 'ops_execution' (a valid team_role, same as testope1).
-- Cosmetic only — the app gates ops on ROLE, not team_role. Owner runs in Studio.

-- BEFORE
SELECT name, role, team_role FROM public.users
WHERE role IN ('operation_executive','operation_head') ORDER BY name;

-- FIX
UPDATE public.users
SET team_role = 'ops_execution'
WHERE role IN ('operation_executive','operation_head')
  AND team_role IS DISTINCT FROM 'ops_execution';

-- AFTER (expect all ops rows → ops_execution)
SELECT name, role, team_role FROM public.users
WHERE role IN ('operation_executive','operation_head') ORDER BY name;
