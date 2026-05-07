-- supabase_phase27_team_role_backfill.sql
--
-- Phase 27 — backfill users.team_role from users.role.
--
-- Owner spec: when adding a team member via the modal, only `role` is
-- set. Reassign / Default-Assignee dropdowns filter on `team_role`,
-- so anyone created through the modal (Dhara — telecaller, etc.)
-- becomes invisible to those queries.
--
-- The fix in TeamMemberModal.jsx now writes both columns going
-- forward. This SQL backfills the existing rows so the live data
-- catches up.
--
-- Idempotent.

UPDATE public.users
SET team_role = role
WHERE team_role IS NULL
  AND role IS NOT NULL
  AND role IN (
    'admin', 'sales', 'agency', 'telecaller', 'office_staff',
    'co_owner', 'owner', 'sales_manager'
  );

-- Verify:
-- SELECT name, role, team_role FROM users WHERE is_active = true ORDER BY name;
