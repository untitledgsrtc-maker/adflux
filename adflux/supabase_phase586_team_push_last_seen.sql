-- =====================================================================
-- Phase 586 — sales manager sees his reps' real Online / Push status
-- =====================================================================
-- Team Live's "Online" and "Push" pills read push_subscriptions, which only
-- self + admin may read (ps_self / ps_admin). A sales manager therefore saw
-- every rep as Online OFF / Push OFF. push_subscriptions also holds each
-- device's push keys (endpoint, p256dh, auth, fcm_token), so the table is NOT
-- opened to him. Instead this function returns ONLY user_id + latest
-- last_seen_at, for: admin -> everyone; sales manager -> himself + his assigned
-- reps (users.manager_id); anyone else -> only themself.
-- ADDITIVE: new function only; no policy or table change.
-- Rollback: DROP FUNCTION public.team_push_last_seen();
-- =====================================================================

CREATE OR REPLACE FUNCTION public.team_push_last_seen()
  RETURNS TABLE(user_id uuid, last_seen_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT ps.user_id, max(ps.last_seen_at)
    FROM public.push_subscriptions ps
   WHERE auth.uid() IS NOT NULL
     AND (
       COALESCE(public.get_my_role() = 'admin', false)
       OR ps.user_id = auth.uid()
       OR (COALESCE(public.is_sales_manager(), false)
           AND ps.user_id IN (SELECT u.id FROM public.users u WHERE u.manager_id = auth.uid()))
     )
   GROUP BY ps.user_id
$fn$;
REVOKE EXECUTE ON FUNCTION public.team_push_last_seen() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.team_push_last_seen() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY: function exists, closed to anon, open to logged-in users.
SELECT
  has_function_privilege('anon', 'public.team_push_last_seen()', 'execute') AS anon_exec,
  has_function_privilege('authenticated', 'public.team_push_last_seen()', 'execute') AS auth_exec;
