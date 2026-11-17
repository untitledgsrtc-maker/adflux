-- Phase 603 - Supabase advisor: SECURITY DEFINER functions callable by anon (2026-11-18)
-- 94 flagged. Trigger functions (54): no one needs to call them directly (Postgres does not
-- check EXECUTE when a trigger fires) -> revoked from PUBLIC, anon, authenticated.
-- App RPCs (32): logged-out callers revoked; logged-in staff keep EXECUTE (explicit grant
-- so removing PUBLIC does not take it from authenticated). Every one of these is only
-- called from pages behind login (grep of src/ + api/ on 18 Nov).
-- KEPT for anon on purpose (8): fetch_offer_by_token, is_open_offer_token,
-- submit_offer_acceptance (the /offer/:token page has no login, same as Phase 571) and
-- get_my_role, get_my_segment_access, is_sales_head, is_sales_manager, is_team_viewer
-- (called by RLS policies on every request; return nothing for a logged-out caller).
-- Revert one: GRANT EXECUTE ON FUNCTION <sig> TO PUBLIC;

-- trigger functions
REVOKE EXECUTE ON FUNCTION public.admin_messages_freeze_content() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_create_followup() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bump_meeting_counter() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.call_log_calls_recount_on_delete() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.call_logs_dedupe_before_insert() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.campaign_conversation_ensure_lead() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.clear_handoff_sla_on_activity() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.deactivate_incentive_on_agency_flip() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.followup_after_done() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.followup_block_on_lost_lead() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_quote_number() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.heal_gps_off_on_ping() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.lead_activity_aftermath() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.lead_activity_bump_counter() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.lead_activity_calls_recount_on_delete() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.lead_activity_meeting_recount_on_delete() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.lead_activity_sync_followup() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.lead_auto_create_followup() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.lead_auto_heat_from_outcome() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.lead_first_engagement_advance() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.lead_first_engagement_from_call_log() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.lead_lost_close_payment_fu() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.lead_new_leads_recount_on_delete() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.lead_owner_change_transfer_followups() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.lead_pause_close_auto_followups() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.lead_stage_change_cadence() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.leads_block_dup_phone() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.leads_enforce_segment_access() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_salary_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.onboarding_step_seed_runs() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ops_uptime_to_daily_performance() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.payment_close_collection_followups() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.quote_after_delete_rollback_lead() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.quote_before_insert_ensure_lead() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.quote_status_propagate_on_insert() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.quote_status_propagate_to_lead() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.quote_terminal_close_followups() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.quotes_no_delete_after_draft() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_wa_conversation_owner() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.team_assistant_dispatch() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_push_on_followup_due() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_push_on_lead_assign() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_push_on_lead_task_insert() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_push_on_payment_approved() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_push_on_quote_won() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_push_on_wa_inbound_lead() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_push_on_wa_inbound_message() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_quote_won_payment_followups() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_recompute_score_on_activity() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_recompute_ta_on_ping() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_lead_close_followups_on_terminal() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_default_signer() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.wa_ai_reply_dispatch() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.wa_message_bump_conversation() FROM PUBLIC, anon, authenticated;

-- app RPCs (logged-in only)
REVOKE EXECUTE ON FUNCTION public._compute_monthly_salary_base(uuid,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._compute_monthly_salary_base(uuid,integer,integer) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.accept_user_profile(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_user_profile(uuid,text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.admin_create_user(text,text,text,text,text,text,text,text,text,uuid,boolean,boolean,boolean,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_user(text,text,text,text,text,text,text,text,text,uuid,boolean,boolean,boolean,boolean) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.approve_leave(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_leave(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.backfill_performance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.backfill_performance(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.backfill_ta(uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.backfill_ta(uuid,date) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.compute_daily_score(uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_daily_score(uuid,date) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.compute_daily_ta(uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_daily_ta(uuid,date) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.compute_monthly_salary(uuid,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_monthly_salary(uuid,integer,integer) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.consecutive_missed_days(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consecutive_missed_days(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.create_onboarding_run(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_onboarding_run(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.eligible_for_paid_leave(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eligible_for_paid_leave(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.generate_lead_tasks(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_lead_tasks(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_onboarding_step_quiz(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_onboarding_step_quiz(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.is_checked_in_today() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_checked_in_today() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.monthly_score(uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.monthly_score(uuid,date) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.my_chase_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_chase_counts() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.record_checkin(numeric,numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_checkin(numeric,numeric,text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.reject_leave(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_leave(uuid,text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.sales_head_approve_ta_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_head_approve_ta_request(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.sales_head_approve_ta_rows(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_head_approve_ta_rows(uuid[]) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.sales_head_reject_ta_request(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_head_reject_ta_request(uuid,text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.score_history(uuid,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.score_history(uuid,integer) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.set_my_app_version(text,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_app_version(text,integer) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.submit_onboarding_test(uuid,uuid,integer[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_onboarding_test(uuid,uuid,integer[]) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.team_all_followups() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_all_followups() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.team_all_leads() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_all_leads() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.team_all_quotes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_all_quotes() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.team_dashboard_bundle(timestamp with time zone,timestamp with time zone,date,date,date,date,timestamp with time zone,timestamp with time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_dashboard_bundle(timestamp with time zone,timestamp with time zone,date,date,date,date,timestamp with time zone,timestamp with time zone) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.team_rep_followups(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_rep_followups(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.todays_suggested_tasks(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.todays_suggested_tasks(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.unaccept_user_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unaccept_user_profile(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- VERIFY (expect exactly the 8 kept names):
-- SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--  WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege('anon', p.oid, 'EXECUTE') ORDER BY 1;
