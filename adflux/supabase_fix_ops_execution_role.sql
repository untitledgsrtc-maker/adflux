-- FIX: "Operation Execution" designation mints role='staff' (wrong).
-- HRNewUserV2 sets a new user's role = designations.auth_role. The ops
-- designations were seeded auth_role='staff', but the app gates ALL ops access
-- on role IN ('operation_executive','operation_head') → ops hires land as 'staff'.
-- Fixes the master (future hires) AND heals existing users.
-- team_role is LEFT UNTOUCHED: nothing reads it for ops, and 'operation_executive'
-- is NOT an allowed team_role (users_team_role_check). The existing 'ops_execution'
-- team_role is already valid. Only role / auth_role change.
-- Owner runs top-to-bottom in Supabase Studio.

-- ==== PART 1 · BEFORE (read-only) ====
SELECT id, name, auth_role, team_role, is_active
FROM public.designations
WHERE name ILIKE '%operation%'
ORDER BY name;

SELECT name, email, role, team_role, designation
FROM public.users
WHERE designation ILIKE '%operation%' OR team_role IN ('ops_execution','ops_head');

-- ==== PART 2 · FIX THE DESIGNATION MASTER (future hires) — role only ====
UPDATE public.designations
SET auth_role = 'operation_executive'
WHERE name ILIKE 'Operation Execution%';

UPDATE public.designations
SET auth_role = 'operation_head'
WHERE name ILIKE 'Operation Head%';

-- ==== PART 3 · HEAL EXISTING MIS-MINTED USERS — role only ====
UPDATE public.users
SET role = 'operation_executive'
WHERE role = 'staff'
  AND (designation ILIKE 'Operation Execution%' OR team_role = 'ops_execution');

UPDATE public.users
SET role = 'operation_head'
WHERE role = 'staff'
  AND (designation ILIKE 'Operation Head%' OR team_role = 'ops_head');

-- ==== PART 4 · VERIFY (expect operation_executive / operation_head) ====
SELECT name, email, role, team_role, designation
FROM public.users
WHERE designation ILIKE '%operation%' OR role IN ('operation_executive','operation_head');

SELECT name, auth_role, team_role FROM public.designations WHERE name ILIKE '%operation%';
