-- ============================================================================
-- Phase 192 — per-user "team dashboard viewer" grant (ADDITIVE)
-- ============================================================================
-- Owner (3 Jul 2026): give ONE telecaller (Jayna) read access to
-- /team-dashboard — the live field map + all reps' calls / meetings / leads /
-- revenue — WITHOUT making her an admin and WITHOUT affecting any other rep.
--
-- Mechanism = a per-user boolean flag `users.can_view_team_dashboard`. It is a
-- pure ACCESS grant, NOT a role: her role/team_role stay 'telecaller', her
-- pay/score/nav as a rep are untouched, and no other telecaller is affected
-- (default false). The dashboard reads 13 tables for EVERY rep; a telecaller's
-- normal RLS only returns her own rows, so the flag also opens SELECT-only
-- read on those 13 tables — gated on the flag via is_team_viewer().
--
-- RLS is OR/permissive → these ADD policies. Every existing admin / co_owner /
-- self / manager / govt_partner policy is UNTOUCHED, so admin access stays
-- byte-identical (§45). SELECT-only — the viewer can never WRITE (no reassign,
-- no push): those need write policies she doesn't get + enqueue_push is REVOKED
-- from authenticated (§97.A2). Idempotent (§8).
--
-- TO GRANT a user: UPDATE public.users SET can_view_team_dashboard = true
--                    WHERE email = '<their login email>';  (see bottom)
-- TO REVOKE: set it back to false. No other change needed.
-- ============================================================================

-- ---- 1) the flag ------------------------------------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS can_view_team_dashboard boolean NOT NULL DEFAULT false;

-- ---- 2) helper (SECURITY DEFINER so the policy can read the flag without
--          recursing through users RLS; STABLE for planner caching) ----------
CREATE OR REPLACE FUNCTION public.is_team_viewer()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT can_view_team_dashboard FROM public.users WHERE id = auth.uid()),
    false)
$function$;

GRANT EXECUTE ON FUNCTION public.is_team_viewer() TO authenticated;

-- ---- 3) additive SELECT policies on the 13 dashboard tables -----------------
-- gps_pings (live map) · gps_off_events · users (rep list) · work_sessions ·
-- call_logs · leads · quotes · voice_logs · daily_targets · follow_ups ·
-- payments · lead_activities · push_subscriptions.
DO $$
DECLARE t text;
  tbls text[] := ARRAY[
    'gps_pings','gps_off_events','users','work_sessions','call_logs','leads',
    'quotes','voice_logs','daily_targets','follow_ups','payments',
    'lead_activities','push_subscriptions'];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_team_viewer_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT USING (public.is_team_viewer())',
      t||'_team_viewer_read', t);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- GRANT JAYNA (owner: confirm her exact login email, then run ONE of these).
-- ============================================================================
-- UPDATE public.users SET can_view_team_dashboard = true WHERE email = 'jayna@untitledad.in';
--   -- or, if unsure of the email, by name (verify it returns exactly 1 row FIRST):
--   -- SELECT id, name, email, role FROM public.users WHERE name ILIKE '%jayna%';
--   -- UPDATE public.users SET can_view_team_dashboard = true WHERE id = '<her uuid>';

-- ============================================================================
-- VERIFY — expect 13 policies + the helper + the column + exactly the granted users.
-- ============================================================================
-- SELECT count(*) AS policies FROM pg_policies
--   WHERE schemaname='public' AND policyname LIKE '%\_team\_viewer\_read';                 -- 13
-- SELECT to_regprocedure('public.is_team_viewer()') IS NOT NULL AS helper_present;         -- t
-- SELECT column_name FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='users' AND column_name='can_view_team_dashboard';
-- SELECT name, email, role FROM public.users WHERE can_view_team_dashboard = true;         -- just Jayna
