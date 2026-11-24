-- supabase_phase677_proprietor_team_role.sql (24-11-2026)
-- Owner 24-11-2026. The "Proprietor" designation still carried team_role 'owner', which
-- users_team_role_check no longer accepts (owner role removed, Phase 97.E), so creating a login
-- from it failed for everyone. Point it at 'admin'.
UPDATE public.designations SET team_role = 'admin' WHERE team_role = 'owner';

-- VERIFY: expect owner_team_roles = 0
SELECT count(*) AS owner_team_roles FROM public.designations WHERE team_role = 'owner';
