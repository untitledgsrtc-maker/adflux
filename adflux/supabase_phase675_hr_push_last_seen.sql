-- supabase_phase675_hr_push_last_seen.sql (24-11-2026)
-- Owner 24-11-2026: Sales attendance showed every rep as "Online off / Push off" to HR, because
-- HR cannot read push_subscriptions (it holds device push keys). team_push_last_seen() returns
-- ONLY user_id + last-seen time; it now also answers co_owner, hr and office_admin. The table's
-- own read rules are unchanged.

CREATE OR REPLACE FUNCTION public.team_push_last_seen()
 RETURNS TABLE(user_id uuid, last_seen_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT ps.user_id, max(ps.last_seen_at)
    FROM public.push_subscriptions ps
   WHERE auth.uid() IS NOT NULL
     AND (
       -- Phase 675: HR / Office Admin see last-seen times on Sales attendance (times only, never device keys)
       COALESCE(public.get_my_role() IN ('admin', 'co_owner', 'hr', 'office_admin'), false)
       OR ps.user_id = auth.uid()
       OR (COALESCE(public.is_sales_manager(), false)
           AND ps.user_id IN (SELECT u.id FROM public.users u WHERE u.manager_id = auth.uid()))
     )
   GROUP BY ps.user_id
$function$;

REVOKE EXECUTE ON FUNCTION public.team_push_last_seen() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_push_last_seen() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY: expect hr_allowed = true
SELECT pg_get_functiondef(oid) LIKE '%''hr'', ''office_admin''%' AS hr_allowed FROM pg_proc WHERE proname = 'team_push_last_seen';
