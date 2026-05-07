-- supabase_phase26b_extra_roles.sql
--
-- Phase 26b — extend users.role enum to support telecaller + office_staff.
--
-- Owner spec: when adding a team member, only sales/agency/admin
-- show up in the role dropdown. Need telecaller (already a real
-- routed user — /telecaller queue page exists) and a generic
-- 'office_staff' bucket for back-office people (accounts, HR,
-- ops, admin staff) so the admin can register them in the system
-- without making them salespeople.
--
-- Existing constraint (Phase 8E):
--   role IN ('admin', 'sales', 'owner', 'co_owner', 'agency')
--
-- After this migration:
--   role IN ('admin', 'sales', 'owner', 'co_owner', 'agency',
--            'telecaller', 'office_staff')
--
-- Idempotent.

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role IN (
    'admin', 'sales', 'owner', 'co_owner', 'agency',
    'telecaller', 'office_staff'
  ));

-- public.get_my_role() returns the role string and is used by RLS
-- across leads, work_sessions, lead_activities, voice_logs, etc.
-- Telecaller already has explicit RLS (Phase 12 telecaller_id chain).
-- office_staff has no special RLS — they see only what's open to
-- everyone (their own profile, their own work_session). No access
-- to leads, quotes, payments. This is intentional: 'office_staff'
-- is a HR/attendance bucket, not a sales role.
NOTIFY pgrst, 'reload schema';

-- VERIFY:
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
--  WHERE conname = 'users_role_check';
