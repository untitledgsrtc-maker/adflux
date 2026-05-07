-- supabase_phase26_designation.sql
--
-- Phase 26 — add 'designation' column to users.
--
-- Owner spec: when adding a team member, admin can't enter a job
-- title beyond the system role (sales/agency/admin). E.g. "Senior
-- Sales Manager", "BDM Surat", "Account Executive". This is a
-- free-text label distinct from the role enum — purely for display
-- on team list, lead detail "assigned to" stamps, and proposal
-- signer blocks.
--
-- Idempotent.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS designation text;

COMMENT ON COLUMN public.users.designation IS
  'Free-text job title. Distinct from role (admin/sales/agency/telecaller). Used on team list + lead assignments + signer blocks.';

NOTIFY pgrst, 'reload schema';

-- VERIFY:
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_name = 'users' AND column_name = 'designation';
