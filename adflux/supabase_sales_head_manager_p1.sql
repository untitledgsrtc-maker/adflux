-- =====================================================================
-- Sales Head — MANAGER module, P1 foundation (the grant)
-- Owner-approved 2026-08-07. Spec: docs/SALES_HEAD_MANAGER_SPEC.md
-- =====================================================================
-- Adds the reusable `is_sales_head` grant + a fail-closed helper, exactly
-- mirroring the shipped `is_team_viewer()` (supabase_phase193). ADDITIVE:
-- no existing code reads the new column, default false → §45-safe, nothing
-- changes for anyone until a user is granted + the P1 code deploys.
--
-- GRANT MODEL (P1): a WRITE-capable Sales Head carries BOTH flags —
--   can_view_team_dashboard = true  (v1 read-only team visibility, already set for Jayna)
--   is_sales_head           = true  (the NEW write powers: reassign / edit quote / reply)
-- So reads keep flowing through the existing is_team_viewer() RPCs unchanged
-- (no churn on the canonical team-read RPCs); is_sales_head() gates only the
-- new WRITE paths. A pure watcher = can_view_team_dashboard only.
-- =====================================================================

-- (1) The grant column — additive, NOT NULL DEFAULT false (idempotent)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_sales_head boolean NOT NULL DEFAULT false;

-- (2) Fail-closed helper — byte-mirrors public.is_team_viewer():
--     NULL role / no auth.uid() / missing row → false (§41/§83 3VL-safe).
CREATE OR REPLACE FUNCTION public.is_sales_head()
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE((SELECT is_sales_head FROM public.users WHERE id = auth.uid()), false)
$$;
GRANT EXECUTE ON FUNCTION public.is_sales_head() TO authenticated;

-- (3) F-100 SELF-GRANT LOCKDOWN — CANONICAL users_self_update_avatar policy.
-- ⚠ SECURITY: the self-update policy is a BLOCKLIST (pins listed columns, allows
-- the rest), so EVERY new privileged `users` column must be pinned here or a rep
-- can self-grant it (Phase 97.1 F-100 class). This module adds a WRITE grant
-- (is_sales_head) AND the pre-existing §84 READ grant (can_view_team_dashboard)
-- was never pinned — both are now pinned. This block is the SINGLE CANONICAL
-- definition (Phase 97.1 + 87.5b copies neutralized to pointers — do NOT redefine
-- the policy elsewhere; add any future privileged column's pin HERE).
DROP POLICY IF EXISTS users_self_update_avatar ON public.users;
CREATE POLICY users_self_update_avatar ON public.users
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND role                    IS NOT DISTINCT FROM (SELECT u.role                    FROM public.users u WHERE u.id = auth.uid())
    AND team_role               IS NOT DISTINCT FROM (SELECT u.team_role               FROM public.users u WHERE u.id = auth.uid())
    AND segment_access          IS NOT DISTINCT FROM (SELECT u.segment_access          FROM public.users u WHERE u.id = auth.uid())
    AND manager_id              IS NOT DISTINCT FROM (SELECT u.manager_id              FROM public.users u WHERE u.id = auth.uid())
    AND is_active               IS NOT DISTINCT FROM (SELECT u.is_active               FROM public.users u WHERE u.id = auth.uid())
    AND email                   IS NOT DISTINCT FROM (SELECT u.email                   FROM public.users u WHERE u.id = auth.uid())
    AND signing_authority       IS NOT DISTINCT FROM (SELECT u.signing_authority       FROM public.users u WHERE u.id = auth.uid())
    AND hr_accepted_at          IS NOT DISTINCT FROM (SELECT u.hr_accepted_at          FROM public.users u WHERE u.id = auth.uid())
    AND hr_accepted_by          IS NOT DISTINCT FROM (SELECT u.hr_accepted_by          FROM public.users u WHERE u.id = auth.uid())
    AND hr_acceptance_note      IS NOT DISTINCT FROM (SELECT u.hr_acceptance_note      FROM public.users u WHERE u.id = auth.uid())
    -- NEW pins (Sales Head P1) — a rep cannot self-grant the team-read or the
    -- manager-write grant:
    AND can_view_team_dashboard IS NOT DISTINCT FROM (SELECT u.can_view_team_dashboard FROM public.users u WHERE u.id = auth.uid())
    AND is_sales_head           IS NOT DISTINCT FROM (SELECT u.is_sales_head           FROM public.users u WHERE u.id = auth.uid())
  );

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- GRANT a person Sales Head (run once per head; Jayna already carries
-- can_view_team_dashboard=true from §84, so this adds the write layer):
--   UPDATE public.users SET is_sales_head = true
--    WHERE email = '<jayna-email>';   -- or WHERE name ILIKE '%jayna%'
-- Revoke = set false.
-- =====================================================================

-- VERIFY:
--   column present + helper present + fail-closed shape + both new pins live
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema='public' AND table_name='users' AND column_name='is_sales_head') AS col_present,
  (SELECT to_regprocedure('public.is_sales_head()') IS NOT NULL)                          AS fn_present,
  (SELECT pg_get_functiondef('public.is_sales_head()'::regprocedure) LIKE '%COALESCE%false%') AS fail_closed,
  (SELECT pg_get_expr(polwithcheck, polrelid) LIKE '%is_sales_head%'
     FROM pg_policy WHERE polname='users_self_update_avatar')                             AS pins_is_sales_head,
  (SELECT pg_get_expr(polwithcheck, polrelid) LIKE '%can_view_team_dashboard%'
     FROM pg_policy WHERE polname='users_self_update_avatar')                             AS pins_team_view;
