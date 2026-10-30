-- Phase 538: close anonymous (logged-out) EXECUTE on two finance RPCs.
-- finance_accounts_home() and finance_reconcile(date,date) were granted to
-- authenticated but also inherited the default PUBLIC execute, so anon could
-- call them. Both check get_my_role() inside and returned nothing for anon, but
-- the door should be shut at the grant level too. Logged-in app calls unchanged.
REVOKE EXECUTE ON FUNCTION public.finance_accounts_home() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.finance_reconcile(date,date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.finance_accounts_home() TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.finance_reconcile(date,date) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';

-- VERIFY: expect anon_x = false, auth_x = true for both rows
-- SELECT p.proname, has_function_privilege('anon',p.oid,'EXECUTE') anon_x,
--        has_function_privilege('authenticated',p.oid,'EXECUTE') auth_x
-- FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
--   AND p.proname IN ('finance_accounts_home','finance_reconcile');
