-- Phase 607 — Fix "infinite recursion detected in policy for relation users" on photo upload
-- (owner report 18-11-2026, Devang /my-offer Upload photo).
-- CAUSE: users_self_update_avatar WITH CHECK reads public.users inside a users policy
--   (12 pin subqueries). Postgres RLS refuses any self-read inside the table's own policy.
-- FIX: same pattern as the quotes P1c hotfix — read the stored row in a SECURITY DEFINER
--   helper (bypasses RLS, so no recursion) and compare the NEW values passed in. Same 12 pins.
CREATE OR REPLACE FUNCTION public.users_self_pins_unchanged(
  p_role text, p_team_role text, p_segment_access text, p_manager_id uuid, p_is_active boolean,
  p_email text, p_signing_authority boolean, p_hr_accepted_at timestamptz, p_hr_accepted_by uuid,
  p_hr_acceptance_note text, p_can_view_team_dashboard boolean, p_is_sales_head boolean
) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((
    SELECT p_role IS NOT DISTINCT FROM u.role
       AND p_team_role IS NOT DISTINCT FROM u.team_role
       AND p_segment_access IS NOT DISTINCT FROM u.segment_access
       AND p_manager_id IS NOT DISTINCT FROM u.manager_id
       AND p_is_active IS NOT DISTINCT FROM u.is_active
       AND p_email IS NOT DISTINCT FROM u.email
       AND p_signing_authority IS NOT DISTINCT FROM u.signing_authority
       AND p_hr_accepted_at IS NOT DISTINCT FROM u.hr_accepted_at
       AND p_hr_accepted_by IS NOT DISTINCT FROM u.hr_accepted_by
       AND p_hr_acceptance_note IS NOT DISTINCT FROM u.hr_acceptance_note
       AND p_can_view_team_dashboard IS NOT DISTINCT FROM u.can_view_team_dashboard
       AND p_is_sales_head IS NOT DISTINCT FROM u.is_sales_head
    FROM public.users u WHERE u.id = auth.uid()
  ), false)
$$;
REVOKE ALL ON FUNCTION public.users_self_pins_unchanged(text,text,text,uuid,boolean,text,boolean,timestamptz,uuid,text,boolean,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.users_self_pins_unchanged(text,text,text,uuid,boolean,text,boolean,timestamptz,uuid,text,boolean,boolean) TO authenticated, service_role;

DROP POLICY IF EXISTS users_self_update_avatar ON public.users;
CREATE POLICY users_self_update_avatar ON public.users
  FOR UPDATE
  USING (id = (SELECT auth.uid()))
  WITH CHECK (
    id = (SELECT auth.uid())
    AND public.users_self_pins_unchanged(role, team_role, segment_access, manager_id, is_active,
          email, signing_authority, hr_accepted_at, hr_accepted_by, hr_acceptance_note,
          can_view_team_dashboard, is_sales_head)
  );

NOTIFY pgrst, 'reload schema';

-- VERIFY: no self-read left in the policy (must be true)
SELECT position('FROM users' in with_check) = 0 AND position('users_self_pins_unchanged' in with_check) > 0 AS no_self_ref
  FROM pg_policies WHERE tablename='users' AND policyname='users_self_update_avatar';
