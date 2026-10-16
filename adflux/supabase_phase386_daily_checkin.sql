-- supabase_phase386_daily_checkin.sql
-- Phase 386 - ONE "Daily check-in" card (morning hi + evening report) for admin, co-owner, HR and accounts.
-- HR cannot read team_assistant_requests directly (RLS), so this SECURITY DEFINER function returns only
-- who said hi / who shared today, per active person. Read-only, idempotent.
-- Function body lives ONLY in db/functions/work_daily_checkin.sql (section 71/72). Run that file for the function.
REVOKE ALL ON FUNCTION public.work_daily_checkin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.work_daily_checkin() TO authenticated;
NOTIFY pgrst, 'reload schema';
-- VERIFY: SELECT has_function_privilege('anon','public.work_daily_checkin()','EXECUTE') -> f ; authenticated -> t
