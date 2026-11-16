-- =====================================================================
-- Phase 571 — close logged-out access to 22 ungated definer functions (17 Nov 2026)
-- =====================================================================
-- Audit (17 Nov): 117 SECURITY DEFINER functions were executable by anon.
--   54 are trigger functions (cannot be called directly)  -> no change
--   38 check the caller inside (auth.uid / role helpers)   -> no change
--   25 have NO caller check:
--     3 are the public offer-letter flow (candidate is logged out):
--       fetch_offer_by_token, submit_offer_acceptance, is_open_offer_token -> KEEP anon
--     8 are used by logged-in users (app RPC, an INVOKER trigger, or an RLS
--       policy) -> revoke anon, keep authenticated:
--       assign_lead_round_robin (lead_auto_assign trigger is INVOKER),
--       find_lead_by_phone, find_open_lead_id_by_phone, get_team_leaderboard,
--       is_leave_day, tc_weekly_stats, recompute_daily_meetings (useDaySummary,
--       GpsTrackV2), sh_quote_unchanged (quotes_sales_head_edit policy)
--     14 are cron / internal only (cron runs as postgres; other callers are
--       definer functions; no app or api caller found) -> revoke anon + authenticated
-- service_role keeps EXECUTE on all (Vercel api uses it). Same pattern as
-- Phase 97.A2 / 566. Revoke FROM PUBLIC too, or anon keeps access via PUBLIC.
-- Rollback: GRANT EXECUTE ON FUNCTION <sig> TO anon, authenticated;
-- =====================================================================

-- logged-in app use: anon out, authenticated stays
REVOKE EXECUTE ON FUNCTION public.assign_lead_round_robin(p_segment text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.assign_lead_round_robin(p_segment text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.find_lead_by_phone(p_phone text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.find_lead_by_phone(p_phone text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.find_open_lead_id_by_phone(p_phone text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.find_open_lead_id_by_phone(p_phone text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_team_leaderboard(p_month_keys text[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_team_leaderboard(p_month_keys text[]) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.is_leave_day(p_user_id uuid, p_date date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_leave_day(p_user_id uuid, p_date date) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.recompute_daily_meetings(p_user uuid, p_date date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.recompute_daily_meetings(p_user uuid, p_date date) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.sh_quote_unchanged(p_id uuid, p_created_by uuid, p_segment text, p_media text, p_lead uuid, p_qnum text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.sh_quote_unchanged(p_id uuid, p_created_by uuid, p_segment text, p_media text, p_lead uuid, p_qnum text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.tc_weekly_stats(p_user_id uuid, p_week_start date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.tc_weekly_stats(p_user_id uuid, p_week_start date) TO authenticated, service_role;

-- cron / internal only: anon and authenticated out
REVOKE EXECUTE ON FUNCTION public.auto_close_open_sessions() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.auto_close_open_sessions() TO service_role;
REVOKE EXECUTE ON FUNCTION public.backfill_daily_performance_month(p_month_start date) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.backfill_daily_performance_month(p_month_start date) TO service_role;
REVOKE EXECUTE ON FUNCTION public.backfill_daily_ta_month(p_month_start date) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.backfill_daily_ta_month(p_month_start date) TO service_role;
REVOKE EXECUTE ON FUNCTION public.backfill_ta_all_active_reps() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.backfill_ta_all_active_reps() TO service_role;
REVOKE EXECUTE ON FUNCTION public.enqueue_attendance_reminder(p_user uuid, p_kind text, p_attempt integer, p_title text, p_body text, p_url text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.enqueue_attendance_reminder(p_user uuid, p_kind text, p_attempt integer, p_title text, p_body text, p_url text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.push_daily_reminders() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.push_daily_reminders() TO service_role;
REVOKE EXECUTE ON FUNCTION public.push_followup_digest(p_label text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.push_followup_digest(p_label text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.push_followup_due_reminders() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.push_followup_due_reminders() TO service_role;
REVOKE EXECUTE ON FUNCTION public.push_morning_checkin() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.push_morning_checkin() TO service_role;
REVOKE EXECUTE ON FUNCTION public.recompute_all_scores_today() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.recompute_all_scores_today() TO service_role;
REVOKE EXECUTE ON FUNCTION public.recompute_all_ta_today() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.recompute_all_ta_today() TO service_role;
REVOKE EXECUTE ON FUNCTION public.refresh_expired_quotes() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.refresh_expired_quotes() TO service_role;
REVOKE EXECUTE ON FUNCTION public.run_nurture_revisit() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.run_nurture_revisit() TO service_role;
REVOKE EXECUTE ON FUNCTION public.tick_attendance() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.tick_attendance() TO service_role;

NOTIFY pgrst, 'reload schema';

-- VERIFY: anon_callable_ungated should be 3 (the offer flow), auth_app_ok 8, auth_internal_blocked 14
SELECT
  (SELECT count(*) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prosecdef
     AND pg_get_function_result(p.oid) <> 'trigger'
     AND has_function_privilege('anon', p.oid, 'execute')
     AND p.prosrc !~* '(auth\.uid|get_my_role|_assert_|is_sales_manager|is_sales_head|is_team_viewer|is_admin|auth\.jwt|current_user_role)') AS anon_callable_ungated,
  (SELECT count(*) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN
     ('assign_lead_round_robin','find_lead_by_phone','find_open_lead_id_by_phone','get_team_leaderboard','is_leave_day','tc_weekly_stats','recompute_daily_meetings','sh_quote_unchanged')
     AND has_function_privilege('authenticated', p.oid, 'execute')) AS auth_app_ok,
  (SELECT count(*) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN
     ('auto_close_open_sessions','backfill_daily_performance_month','backfill_daily_ta_month','backfill_ta_all_active_reps','enqueue_attendance_reminder','push_daily_reminders','push_followup_digest','push_followup_due_reminders','push_morning_checkin','recompute_all_scores_today','recompute_all_ta_today','refresh_expired_quotes','run_nurture_revisit','tick_attendance')
     AND NOT has_function_privilege('authenticated', p.oid, 'execute')) AS auth_internal_blocked;
