-- Phase 604 - Supabase performance advisor (2026-11-18)
-- (1) auth_rls_initplan: 299 RLS policies on 128 tables called auth.uid() / get_my_role() /
--     get_my_segment_access() / is_sales_manager() / is_team_viewer() / is_sales_head()
--     once PER ROW. Each call is now wrapped as (SELECT fn()) so Postgres evaluates it once
--     per query. Policy logic is otherwise byte-identical (ALTER POLICY changes only the
--     expressions; name, command, roles untouched). Verified 18 Nov: visible row counts for
--     12 users (one per role + logged-out) on all 128 tables identical before/after.
-- (2) duplicate_index: dropped idx_lead_activities_created_by (0 scans; identical
--     idx_lead_activities_created_by_time kept, 80,964 scans) and
--     idx_work_sessions_today_no_checkin (identical to idx_work_sessions_no_checkin).
-- Re-running is safe: already-wrapped calls are not wrapped again.
BEGIN;

ALTER POLICY "am_admin_delete" ON public."admin_messages" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "am_admin_insert" ON public."admin_messages" WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "am_recipient_mark_read" ON public."admin_messages" USING ((recipient_id = (SELECT auth.uid()))) WITH CHECK ((recipient_id = (SELECT auth.uid())));
ALTER POLICY "am_recipient_read" ON public."admin_messages" USING (((recipient_id = (SELECT auth.uid())) OR ((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text]))));
ALTER POLICY "acp_admin_all" ON public."agency_commission_payouts" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "acp_self_read" ON public."agency_commission_payouts" USING ((user_id = (SELECT auth.uid())));
ALTER POLICY "ai_failures_admin_read" ON public."ai_failures" USING (COALESCE(((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])), false));
ALTER POLICY "ai_faq_admin" ON public."ai_faq" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "ai_quote_followups_read" ON public."ai_quote_followups" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text, 'accounts'::text])));
ALTER POLICY "ai_runs_admin_all" ON public."ai_runs" USING (((SELECT get_my_role()) = 'admin'::text));
ALTER POLICY "ai_runs_self_insert" ON public."ai_runs" WITH CHECK (((created_by = (SELECT auth.uid())) OR (created_by IS NULL)));
ALTER POLICY "app_version_admin_write" ON public."app_version" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "applied_migrations_read" ON public."applied_migrations" USING (((SELECT auth.role()) = 'authenticated'::text));
ALTER POLICY "at_admin_write" ON public."attachment_templates" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'owner'::text, 'co_owner'::text])));
ALTER POLICY "at_read_all" ON public."attachment_templates" USING (((SELECT auth.uid()) IS NOT NULL));
ALTER POLICY "aw_admin_all" ON public."attendance_warnings" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "aw_self_select" ON public."attendance_warnings" USING ((user_id = (SELECT auth.uid())));
ALTER POLICY "auto_districts_admin_write" ON public."auto_districts" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'owner'::text, 'co_owner'::text])));
ALTER POLICY "auto_districts_read_all" ON public."auto_districts" USING (((SELECT auth.uid()) IS NOT NULL));
ALTER POLICY "auto_rate_master_admin_write" ON public."auto_rate_master" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'owner'::text, 'co_owner'::text])));
ALTER POLICY "auto_rate_master_read_all" ON public."auto_rate_master" USING (((SELECT auth.uid()) IS NOT NULL));
ALTER POLICY "bank_accounts_admin_accounts" ON public."bank_accounts" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'accounts'::text])));
ALTER POLICY "bcast_recip_admin_all" ON public."broadcast_recipients" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "ccl_admin_read" ON public."call_capture_log" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "ccl_self_insert" ON public."call_capture_log" WITH CHECK (((user_id = (SELECT auth.uid())) OR (user_id IS NULL)));
ALTER POLICY "ccl_self_read" ON public."call_capture_log" USING ((user_id = (SELECT auth.uid())));
ALTER POLICY "call_logs_admin_all" ON public."call_logs" USING (((SELECT get_my_role()) = 'admin'::text));
ALTER POLICY "call_logs_manager" ON public."call_logs" USING ((user_id IN ( SELECT users.id
   FROM users
  WHERE (users.manager_id = (SELECT auth.uid())))));
ALTER POLICY "call_logs_own" ON public."call_logs" USING ((user_id = (SELECT auth.uid())));
ALTER POLICY "scripts_admin_write" ON public."call_scripts" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "bot_buttons_admin_all" ON public."campaign_bot_buttons" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "bot_flows_admin_all" ON public."campaign_bot_flows" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "bot_rules_admin_all" ON public."campaign_bot_rules" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "bcast_admin_all" ON public."campaign_broadcasts" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "camp_loc_admin_write" ON public."campaign_locations" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "campaign_media_admin_all" ON public."campaign_media" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "seg_admin_all" ON public."campaign_segments" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "campaigns_admin_write" ON public."campaigns" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "capi_outbox_admin_read" ON public."capi_outbox" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "cities_admin_write" ON public."cities" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'owner'::text, 'co_owner'::text])));
ALTER POLICY "cities_read_all" ON public."cities" USING (((SELECT auth.uid()) IS NOT NULL));
ALTER POLICY "ceilings_admin" ON public."city_da_ceilings" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "ceilings_read_all" ON public."city_da_ceilings" USING (((SELECT auth.uid()) IS NOT NULL));
ALTER POLICY "clients_admin_all" ON public."clients" USING (((SELECT get_my_role()) = 'admin'::text));
ALTER POLICY "clients_office_admin_read" ON public."clients" USING (((SELECT get_my_role()) = 'office_admin'::text));
ALTER POLICY "clients_sales_insert_own" ON public."clients" WITH CHECK ((((SELECT get_my_role()) = ANY (ARRAY['sales'::text, 'agency'::text, 'telecaller'::text, 'sales_manager'::text])) AND (created_by = (SELECT auth.uid()))));
ALTER POLICY "clients_sales_read_own" ON public."clients" USING ((((SELECT get_my_role()) = ANY (ARRAY['sales'::text, 'agency'::text, 'telecaller'::text, 'sales_manager'::text])) AND (created_by = (SELECT auth.uid()))));
ALTER POLICY "clients_sales_select_own" ON public."clients" USING ((((SELECT get_my_role()) = ANY (ARRAY['sales'::text, 'agency'::text])) AND (created_by = (SELECT auth.uid()))));
ALTER POLICY "clients_sales_update_own" ON public."clients" USING ((((SELECT get_my_role()) = ANY (ARRAY['sales'::text, 'agency'::text, 'telecaller'::text, 'sales_manager'::text])) AND (created_by = (SELECT auth.uid()))));
ALTER POLICY "co_admin_write" ON public."companies" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'owner'::text, 'co_owner'::text])));
ALTER POLICY "co_read_all" ON public."companies" USING (((SELECT auth.uid()) IS NOT NULL));
ALTER POLICY "daily_performance_accounts_read" ON public."daily_performance" USING (((SELECT get_my_role()) = 'accounts'::text));
ALTER POLICY "dp_admin" ON public."daily_performance" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "dp_own" ON public."daily_performance" USING ((user_id = (SELECT auth.uid())));
ALTER POLICY "daily_ta_accounts_all" ON public."daily_ta" USING (((SELECT get_my_role()) = 'accounts'::text)) WITH CHECK (((SELECT get_my_role()) = 'accounts'::text));
ALTER POLICY "daily_ta_hr_read" ON public."daily_ta" USING (((SELECT get_my_role()) = 'hr'::text));
ALTER POLICY "daily_ta_office_admin_read" ON public."daily_ta" USING (((SELECT get_my_role()) = 'office_admin'::text));
ALTER POLICY "daily_ta_sales_head_read" ON public."daily_ta" USING ((SELECT is_sales_head()));
ALTER POLICY "ta_admin_all" ON public."daily_ta" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "ta_ops_head" ON public."daily_ta" USING ((((SELECT get_my_role()) = 'operation_head'::text) AND (user_id IN ( SELECT users.id
   FROM users
  WHERE (users.role = 'operation_executive'::text)))));
ALTER POLICY "ta_self_read" ON public."daily_ta" USING ((user_id = (SELECT auth.uid())));
ALTER POLICY "dt_admin_write" ON public."daily_targets" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'owner'::text, 'co_owner'::text])));
ALTER POLICY "dt_hr_write" ON public."daily_targets" USING ((((SELECT get_my_role()) = 'hr'::text) AND (COALESCE(( SELECT u.role
   FROM users u
  WHERE (u.id = daily_targets.user_id)), ''::text) <> ALL (ARRAY['admin'::text, 'co_owner'::text])))) WITH CHECK ((((SELECT get_my_role()) = 'hr'::text) AND (COALESCE(( SELECT u.role
   FROM users u
  WHERE (u.id = daily_targets.user_id)), ''::text) <> ALL (ARRAY['admin'::text, 'co_owner'::text]))));
ALTER POLICY "dt_read_all" ON public."daily_targets" USING (((SELECT auth.uid()) IS NOT NULL));
ALTER POLICY "des_admin_write" ON public."designations" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text, 'hr'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text, 'hr'::text])));
ALTER POLICY "email_log_admin_read" ON public."email_log" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text, 'hr'::text, 'accounts'::text])));
ALTER POLICY "email_log_self_read" ON public."email_log" USING ((sent_by = (SELECT auth.uid())));
ALTER POLICY "finance_expense_heads_admin_accounts" ON public."finance_expense_heads" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'accounts'::text])));
ALTER POLICY "finance_import_batches_admin_accounts" ON public."finance_import_batches" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'accounts'::text])));
ALTER POLICY "finance_rules_admin_accounts" ON public."finance_rules" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'accounts'::text])));
ALTER POLICY "finance_tasks_admin_accounts" ON public."finance_tasks" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'accounts'::text])));
ALTER POLICY "finance_transactions_admin_accounts" ON public."finance_transactions" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'accounts'::text])));
ALTER POLICY "finance_txn_govt_partner_read" ON public."finance_transactions" USING (((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (SELECT auth.uid())) AND (u.team_role = 'government_partner'::text)))) AND (segment = 'GOVERNMENT'::text)));
ALTER POLICY "fu_admin_all" ON public."follow_ups" USING (((SELECT get_my_role()) = 'admin'::text));
ALTER POLICY "fu_govt_partner_read" ON public."follow_ups" USING (((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (SELECT auth.uid())) AND (u.team_role = 'government_partner'::text)))) AND ((EXISTS ( SELECT 1
   FROM quotes q
  WHERE ((q.id = follow_ups.quote_id) AND (q.segment = 'GOVERNMENT'::text)))) OR (EXISTS ( SELECT 1
   FROM leads l
  WHERE ((l.id = follow_ups.lead_id) AND (l.segment = 'GOVERNMENT'::text)))))));
ALTER POLICY "fu_sales_own" ON public."follow_ups" USING ((((SELECT get_my_role()) = ANY (ARRAY['sales'::text, 'agency'::text, 'telecaller'::text, 'sales_manager'::text])) AND (assigned_to = (SELECT auth.uid())))) WITH CHECK ((((SELECT get_my_role()) = ANY (ARRAY['sales'::text, 'agency'::text, 'telecaller'::text, 'sales_manager'::text])) AND (assigned_to = (SELECT auth.uid()))));
ALTER POLICY "fu_telecaller_own" ON public."follow_ups" USING ((((SELECT get_my_role()) = 'telecaller'::text) AND (assigned_to = (SELECT auth.uid())))) WITH CHECK ((((SELECT get_my_role()) = 'telecaller'::text) AND (assigned_to = (SELECT auth.uid()))));
ALTER POLICY "force_stop_events_admin_all" ON public."force_stop_events" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "force_stop_events_self_read" ON public."force_stop_events" USING ((((SELECT get_my_role()) = ANY (ARRAY['sales'::text, 'agency'::text, 'telecaller'::text, 'sales_manager'::text])) AND (user_id = (SELECT auth.uid()))));
ALTER POLICY "force_stop_events_self_write" ON public."force_stop_events" WITH CHECK ((((SELECT get_my_role()) = ANY (ARRAY['sales'::text, 'agency'::text, 'telecaller'::text, 'sales_manager'::text])) AND (user_id = (SELECT auth.uid()))));
ALTER POLICY "gps_block_events_admin_all" ON public."gps_block_events" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "gps_block_events_self_read" ON public."gps_block_events" USING ((((SELECT get_my_role()) = ANY (ARRAY['sales'::text, 'agency'::text, 'telecaller'::text, 'sales_manager'::text])) AND (user_id = (SELECT auth.uid()))));
ALTER POLICY "gps_block_events_self_resolve" ON public."gps_block_events" USING ((((SELECT get_my_role()) = ANY (ARRAY['sales'::text, 'agency'::text, 'telecaller'::text, 'sales_manager'::text])) AND (user_id = (SELECT auth.uid())) AND (resolved_at IS NULL))) WITH CHECK ((user_id = (SELECT auth.uid())));
ALTER POLICY "gps_block_events_self_write" ON public."gps_block_events" WITH CHECK ((((SELECT get_my_role()) = ANY (ARRAY['sales'::text, 'agency'::text, 'telecaller'::text, 'sales_manager'::text])) AND (user_id = (SELECT auth.uid()))));
ALTER POLICY "gps_off_events_admin_all" ON public."gps_off_events" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "gps_off_events_hr_read" ON public."gps_off_events" USING (((SELECT get_my_role()) = 'hr'::text));
ALTER POLICY "gps_off_events_self_close" ON public."gps_off_events" USING ((((SELECT get_my_role()) = ANY (ARRAY['sales'::text, 'agency'::text, 'telecaller'::text, 'sales_manager'::text])) AND (user_id = (SELECT auth.uid())) AND (toggled_on_at IS NULL))) WITH CHECK ((user_id = (SELECT auth.uid())));
ALTER POLICY "gps_off_events_self_read" ON public."gps_off_events" USING ((((SELECT get_my_role()) = ANY (ARRAY['sales'::text, 'agency'::text, 'telecaller'::text, 'sales_manager'::text])) AND (user_id = (SELECT auth.uid()))));
ALTER POLICY "gps_off_events_self_write" ON public."gps_off_events" WITH CHECK ((((SELECT get_my_role()) = ANY (ARRAY['sales'::text, 'agency'::text, 'telecaller'::text, 'sales_manager'::text])) AND (user_id = (SELECT auth.uid()))));
ALTER POLICY "gps_off_reasons_admin_all" ON public."gps_off_reasons" USING (((SELECT get_my_role()) = 'admin'::text)) WITH CHECK (((SELECT get_my_role()) = 'admin'::text));
ALTER POLICY "gps_off_reasons_self_insert" ON public."gps_off_reasons" WITH CHECK (((user_id = (SELECT auth.uid())) AND (status = 'pending'::text) AND (decided_by IS NULL) AND (decided_at IS NULL) AND (decision_note IS NULL) AND (EXISTS ( SELECT 1
   FROM gps_off_events e
  WHERE ((e.id = gps_off_reasons.event_id) AND (e.user_id = (SELECT auth.uid())))))));
ALTER POLICY "gps_off_reasons_self_read" ON public."gps_off_reasons" USING ((user_id = (SELECT auth.uid())));
ALTER POLICY "gps_pings_accounts_read" ON public."gps_pings" USING (((SELECT get_my_role()) = 'accounts'::text));
ALTER POLICY "gps_pings_admin_all" ON public."gps_pings" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "gps_pings_hr_read" ON public."gps_pings" USING (((SELECT get_my_role()) = 'hr'::text));
ALTER POLICY "gps_pings_ops_head" ON public."gps_pings" USING ((((SELECT get_my_role()) = 'operation_head'::text) AND (user_id IN ( SELECT users.id
   FROM users
  WHERE (users.role = 'operation_executive'::text)))));
ALTER POLICY "gps_pings_ops_insert_own" ON public."gps_pings" WITH CHECK ((((SELECT get_my_role()) = 'operation_executive'::text) AND (user_id = (SELECT auth.uid()))));
ALTER POLICY "gps_pings_ops_read_own" ON public."gps_pings" USING ((((SELECT get_my_role()) = 'operation_executive'::text) AND (user_id = (SELECT auth.uid()))));
ALTER POLICY "gps_pings_sales_insert_own" ON public."gps_pings" WITH CHECK ((((SELECT get_my_role()) = ANY (ARRAY['sales'::text, 'agency'::text, 'telecaller'::text, 'sales_manager'::text])) AND (user_id = (SELECT auth.uid()))));
ALTER POLICY "gps_pings_sales_read_own" ON public."gps_pings" USING ((((SELECT get_my_role()) = ANY (ARRAY['sales'::text, 'agency'::text, 'telecaller'::text, 'sales_manager'::text])) AND (user_id = (SELECT auth.uid()))));
ALTER POLICY "gsrtc_stations_admin_write" ON public."gsrtc_stations" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'owner'::text, 'co_owner'::text])));
ALTER POLICY "gsrtc_stations_read_all" ON public."gsrtc_stations" USING (((SELECT auth.uid()) IS NOT NULL));
ALTER POLICY "holidays_admin_all" ON public."holidays" USING (((SELECT get_my_role()) = 'admin'::text));
ALTER POLICY "holidays_read_all" ON public."holidays" USING (((SELECT auth.uid()) IS NOT NULL));
ALTER POLICY "hr_candidate_calls_hr_all" ON public."hr_candidate_calls" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text, 'hr'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text, 'hr'::text])));
ALTER POLICY "hr_candidates_hr_all" ON public."hr_candidates" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text, 'hr'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text, 'hr'::text])));
ALTER POLICY "hr_templates_admin_all" ON public."hr_offer_templates" USING (((SELECT get_my_role()) = 'admin'::text));
ALTER POLICY "hr_templates_sales_read" ON public."hr_offer_templates" USING (((SELECT auth.uid()) IS NOT NULL));
ALTER POLICY "hr_offers_admin_all" ON public."hr_offers" USING (((SELECT get_my_role()) = 'admin'::text));
ALTER POLICY "hr_offers_hr_all" ON public."hr_offers" USING (((SELECT get_my_role()) = 'hr'::text)) WITH CHECK (((SELECT get_my_role()) = 'hr'::text));
ALTER POLICY "hr_offers_self_read" ON public."hr_offers" USING ((((SELECT get_my_role()) = ANY (ARRAY['sales'::text, 'telecaller'::text, 'agency'::text, 'co_owner'::text, 'hr'::text])) AND (converted_user_id = (SELECT auth.uid()))));
ALTER POLICY "inbound_admin" ON public."inbound_leads" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "incentive_payouts_accounts_all" ON public."incentive_payouts" USING (((SELECT get_my_role()) = 'accounts'::text)) WITH CHECK (((SELECT get_my_role()) = 'accounts'::text));
ALTER POLICY "ip_admin_all" ON public."incentive_payouts" USING (((SELECT get_my_role()) = 'admin'::text));
ALTER POLICY "ip_sales_own" ON public."incentive_payouts" USING ((((SELECT get_my_role()) = ANY (ARRAY['sales'::text, 'agency'::text])) AND (staff_id = (SELECT auth.uid()))));
ALTER POLICY "incentive_settings_accounts_all" ON public."incentive_settings" USING (((SELECT get_my_role()) = 'accounts'::text)) WITH CHECK (((SELECT get_my_role()) = 'accounts'::text));
ALTER POLICY "is_admin_all" ON public."incentive_settings" USING (((SELECT get_my_role()) = 'admin'::text));
ALTER POLICY "is_sales_read" ON public."incentive_settings" USING (((SELECT auth.uid()) IS NOT NULL));
ALTER POLICY "lead_activities_admin_all" ON public."lead_activities" USING (((SELECT get_my_role()) = 'admin'::text));
ALTER POLICY "lead_imports_admin_all" ON public."lead_imports" USING (((SELECT get_my_role()) = 'admin'::text));
ALTER POLICY "lead_imports_own_insert" ON public."lead_imports" WITH CHECK ((uploaded_by = (SELECT auth.uid())));
ALTER POLICY "lead_imports_own_read" ON public."lead_imports" USING ((uploaded_by = (SELECT auth.uid())));
ALTER POLICY "lead_imports_own_update" ON public."lead_imports" USING ((uploaded_by = (SELECT auth.uid()))) WITH CHECK ((uploaded_by = (SELECT auth.uid())));
ALTER POLICY "lp_admin" ON public."lead_photos" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "lp_insert" ON public."lead_photos" WITH CHECK (((created_by = (SELECT auth.uid())) AND (EXISTS ( SELECT 1
   FROM leads l
  WHERE ((l.id = lead_photos.lead_id) AND ((l.assigned_to = (SELECT auth.uid())) OR (l.created_by = (SELECT auth.uid())) OR ((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text]))))))));
ALTER POLICY "lead_tasks_insert_admin" ON public."lead_tasks" WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "lead_tasks_select_self_or_chain" ON public."lead_tasks" USING (((assigned_to = (SELECT auth.uid())) OR ((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = lead_tasks.assigned_to) AND (u.manager_id = (SELECT auth.uid())))))));
ALTER POLICY "lead_tasks_update_self_or_chain" ON public."lead_tasks" USING (((assigned_to = (SELECT auth.uid())) OR ((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = lead_tasks.assigned_to) AND (u.manager_id = (SELECT auth.uid())))))));
ALTER POLICY "leads_admin_all" ON public."leads" USING (((SELECT get_my_role()) = 'admin'::text));
ALTER POLICY "leads_govt_partner_read" ON public."leads" USING (((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (SELECT auth.uid())) AND (u.team_role = 'government_partner'::text)))) AND (segment = 'GOVERNMENT'::text)));
ALTER POLICY "leads_govt_partner_write" ON public."leads" USING (((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (SELECT auth.uid())) AND (u.team_role = 'government_partner'::text)))) AND (segment = 'GOVERNMENT'::text)));
ALTER POLICY "leads_sales_own" ON public."leads" USING ((((SELECT get_my_role()) = ANY (ARRAY['sales'::text, 'agency'::text])) AND (assigned_to = (SELECT auth.uid()))));
ALTER POLICY "leads_telecaller_own" ON public."leads" USING (((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (SELECT auth.uid())) AND (u.team_role = 'telecaller'::text)))) AND ((telecaller_id = (SELECT auth.uid())) OR (assigned_to = (SELECT auth.uid())))));
ALTER POLICY "leaves_accounts_all" ON public."leaves" USING (((SELECT get_my_role()) = 'accounts'::text)) WITH CHECK (((SELECT get_my_role()) = 'accounts'::text));
ALTER POLICY "leaves_admin_all" ON public."leaves" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "leaves_hr_all" ON public."leaves" USING (((SELECT get_my_role()) = 'hr'::text)) WITH CHECK (((SELECT get_my_role()) = 'hr'::text));
ALTER POLICY "leaves_manager_read" ON public."leaves" USING (((SELECT is_sales_manager()) AND (user_id IN ( SELECT users.id
   FROM users
  WHERE (users.manager_id = (SELECT auth.uid()))))));
ALTER POLICY "leaves_manager_update" ON public."leaves" USING (((SELECT is_sales_manager()) AND (user_id IN ( SELECT users.id
   FROM users
  WHERE (users.manager_id = (SELECT auth.uid())))))) WITH CHECK (((SELECT is_sales_manager()) AND (user_id IN ( SELECT users.id
   FROM users
  WHERE (users.manager_id = (SELECT auth.uid()))))));
ALTER POLICY "leaves_office_admin_all" ON public."leaves" USING (((SELECT get_my_role()) = 'office_admin'::text)) WITH CHECK (((SELECT get_my_role()) = 'office_admin'::text));
ALTER POLICY "leaves_sales_head_read" ON public."leaves" USING ((SELECT is_sales_head()));
ALTER POLICY "leaves_self_read" ON public."leaves" USING ((user_id = (SELECT auth.uid())));
ALTER POLICY "leaves_self_request" ON public."leaves" WITH CHECK (((user_id = (SELECT auth.uid())) AND (status = 'pending'::text)));
ALTER POLICY "leaves_self_withdraw" ON public."leaves" USING (((user_id = (SELECT auth.uid())) AND (status = 'pending'::text)));
ALTER POLICY "msv_admin_write" ON public."media_segment_validity" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'owner'::text, 'co_owner'::text])));
ALTER POLICY "msv_read_all" ON public."media_segment_validity" USING (((SELECT auth.uid()) IS NOT NULL));
ALTER POLICY "media_types_admin_all" ON public."media_types" USING (((SELECT get_my_role()) = 'admin'::text));
ALTER POLICY "media_types_read_all" ON public."media_types" USING (((SELECT auth.uid()) IS NOT NULL));
ALTER POLICY "mlr_admin_all" ON public."meeting_location_requests" USING (((SELECT get_my_role()) = 'admin'::text)) WITH CHECK (((SELECT get_my_role()) = 'admin'::text));
ALTER POLICY "mlr_self_insert" ON public."meeting_location_requests" WITH CHECK (((user_id = (SELECT auth.uid())) AND (status = 'pending'::text) AND (decided_by IS NULL) AND (decided_at IS NULL) AND (decision_note IS NULL)));
ALTER POLICY "mlr_self_read" ON public."meeting_location_requests" USING ((user_id = (SELECT auth.uid())));
ALTER POLICY "message_templates_admin" ON public."message_templates" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "message_templates_read" ON public."message_templates" USING (((SELECT auth.uid()) IS NOT NULL));
ALTER POLICY "monthly_sales_data_accounts_read" ON public."monthly_sales_data" USING (((SELECT get_my_role()) = 'accounts'::text));
ALTER POLICY "msd_admin_all" ON public."monthly_sales_data" USING (((SELECT get_my_role()) = 'admin'::text));
ALTER POLICY "msd_sales_own" ON public."monthly_sales_data" USING ((((SELECT get_my_role()) = ANY (ARRAY['sales'::text, 'agency'::text])) AND (staff_id = (SELECT auth.uid()))));
ALTER POLICY "net_off_reasons_admin_all" ON public."net_off_reasons" USING (((SELECT get_my_role()) = 'admin'::text)) WITH CHECK (((SELECT get_my_role()) = 'admin'::text));
ALTER POLICY "net_off_reasons_self_insert" ON public."net_off_reasons" WITH CHECK (((user_id = (SELECT auth.uid())) AND (status = 'pending'::text) AND (decided_by IS NULL) AND (decided_at IS NULL) AND (decision_note IS NULL) AND (EXISTS ( SELECT 1
   FROM network_off_events e
  WHERE ((e.id = net_off_reasons.event_id) AND (e.user_id = (SELECT auth.uid())))))));
ALTER POLICY "net_off_reasons_self_read" ON public."net_off_reasons" USING ((user_id = (SELECT auth.uid())));
ALTER POLICY "network_off_events_admin_all" ON public."network_off_events" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "network_off_events_self_close" ON public."network_off_events" USING ((((SELECT get_my_role()) = ANY (ARRAY['sales'::text, 'agency'::text, 'telecaller'::text, 'sales_manager'::text])) AND (user_id = (SELECT auth.uid())) AND (regained_at IS NULL))) WITH CHECK ((user_id = (SELECT auth.uid())));
ALTER POLICY "network_off_events_self_read" ON public."network_off_events" USING ((((SELECT get_my_role()) = ANY (ARRAY['sales'::text, 'agency'::text, 'telecaller'::text, 'sales_manager'::text])) AND (user_id = (SELECT auth.uid()))));
ALTER POLICY "network_off_events_self_write" ON public."network_off_events" WITH CHECK ((((SELECT get_my_role()) = ANY (ARRAY['sales'::text, 'agency'::text, 'telecaller'::text, 'sales_manager'::text])) AND (user_id = (SELECT auth.uid()))));
ALTER POLICY "onboarding_progress_hr_all" ON public."onboarding_progress" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text, 'hr'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text, 'hr'::text])));
ALTER POLICY "onboarding_progress_own_read" ON public."onboarding_progress" USING ((EXISTS ( SELECT 1
   FROM onboarding_runs r
  WHERE ((r.id = onboarding_progress.run_id) AND (r.user_id = (SELECT auth.uid()))))));
ALTER POLICY "onboarding_progress_own_tick" ON public."onboarding_progress" USING (((EXISTS ( SELECT 1
   FROM onboarding_runs r
  WHERE ((r.id = onboarding_progress.run_id) AND (r.user_id = (SELECT auth.uid()))))) AND (EXISTS ( SELECT 1
   FROM onboarding_steps s
  WHERE ((s.id = onboarding_progress.step_id) AND (s.owner = 'hire'::text) AND (s.has_test = false)))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM onboarding_runs r
  WHERE ((r.id = onboarding_progress.run_id) AND (r.user_id = (SELECT auth.uid()))))) AND (EXISTS ( SELECT 1
   FROM onboarding_steps s
  WHERE ((s.id = onboarding_progress.step_id) AND (s.owner = 'hire'::text) AND (s.has_test = false))))));
ALTER POLICY "onboarding_runs_hr_all" ON public."onboarding_runs" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text, 'hr'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text, 'hr'::text])));
ALTER POLICY "onboarding_runs_own_read" ON public."onboarding_runs" USING ((user_id = (SELECT auth.uid())));
ALTER POLICY "onboarding_questions_hr_all" ON public."onboarding_step_questions" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text, 'hr'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text, 'hr'::text])));
ALTER POLICY "onboarding_steps_hr_all" ON public."onboarding_steps" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text, 'hr'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text, 'hr'::text])));
ALTER POLICY "onboarding_templates_hr_all" ON public."onboarding_templates" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text, 'hr'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text, 'hr'::text])));
ALTER POLICY "ops_depot_contacts_exec_delete" ON public."ops_depot_contacts" USING ((((SELECT get_my_role()) = 'operation_executive'::text) AND (created_by = (SELECT auth.uid()))));
ALTER POLICY "ops_depot_contacts_exec_insert" ON public."ops_depot_contacts" WITH CHECK ((((SELECT get_my_role()) = 'operation_executive'::text) AND (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (SELECT auth.uid())) AND u.is_active))) AND (created_by = (SELECT auth.uid())) AND (phone ~ '^[0-9]{10}$'::text) AND (char_length(COALESCE(role_en, ''::text)) <= 60) AND (char_length(COALESCE(role_gu, ''::text)) <= 60) AND (char_length(COALESCE(name, ''::text)) <= 60) AND (( SELECT count(*) AS count
   FROM ops_depot_contacts c
  WHERE (c.depot_id = ops_depot_contacts.depot_id)) < 20) AND (EXISTS ( SELECT 1
   FROM ops_depots d
  WHERE ((d.id = ops_depot_contacts.depot_id) AND (d.assigned_to = (SELECT auth.uid())) AND d.is_active)))));
ALTER POLICY "ops_depot_contacts_manage" ON public."ops_depot_contacts" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text, 'operation_head'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text, 'operation_head'::text])));
ALTER POLICY "ops_depot_contacts_read" ON public."ops_depot_contacts" USING (((SELECT get_my_role()) = 'operation_executive'::text));
ALTER POLICY "ops_depots_manage" ON public."ops_depots" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text, 'operation_head'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text, 'operation_head'::text])));
ALTER POLICY "ops_depots_read" ON public."ops_depots" USING (((SELECT get_my_role()) = 'operation_executive'::text));
ALTER POLICY "ops_issue_types_manage" ON public."ops_issue_types" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text, 'operation_head'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text, 'operation_head'::text])));
ALTER POLICY "ops_issue_types_read" ON public."ops_issue_types" USING (((SELECT get_my_role()) = 'operation_executive'::text));
ALTER POLICY "ops_screen_faults_read" ON public."ops_screen_faults" USING ((((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text, 'operation_head'::text])) OR (EXISTS ( SELECT 1
   FROM ops_depots d
  WHERE ((d.id = ops_screen_faults.depot_id) AND (d.assigned_to = (SELECT auth.uid())))))));
ALTER POLICY "ops_screens_manage" ON public."ops_screens" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text, 'operation_head'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text, 'operation_head'::text])));
ALTER POLICY "ops_screens_read" ON public."ops_screens" USING (((SELECT get_my_role()) = 'operation_executive'::text));
ALTER POLICY "ops_tickets_exec_insert" ON public."ops_tickets" WITH CHECK ((((SELECT get_my_role()) = 'operation_executive'::text) AND (created_by = (SELECT auth.uid()))));
ALTER POLICY "ops_tickets_exec_read" ON public."ops_tickets" USING ((((SELECT get_my_role()) = 'operation_executive'::text) AND (assigned_to = (SELECT auth.uid()))));
ALTER POLICY "ops_tickets_exec_update" ON public."ops_tickets" USING ((((SELECT get_my_role()) = 'operation_executive'::text) AND (assigned_to = (SELECT auth.uid())))) WITH CHECK ((((SELECT get_my_role()) = 'operation_executive'::text) AND (assigned_to = (SELECT auth.uid()))));
ALTER POLICY "ops_tickets_manage" ON public."ops_tickets" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text, 'operation_head'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text, 'operation_head'::text])));
ALTER POLICY "ops_tickets_sales_read" ON public."ops_tickets" USING ((requested_by = (SELECT auth.uid())));
ALTER POLICY "ops_tickets_sales_request" ON public."ops_tickets" WITH CHECK ((((SELECT get_my_role()) = ANY (ARRAY['sales'::text, 'agency'::text, 'telecaller'::text])) AND (type = 'photo_request'::text) AND (requested_by = (SELECT auth.uid())) AND (created_by = (SELECT auth.uid()))));
ALTER POLICY "ops_uptime_exec_read" ON public."ops_uptime_daily" USING ((((SELECT get_my_role()) = 'operation_executive'::text) AND (user_id = (SELECT auth.uid()))));
ALTER POLICY "ops_uptime_manage" ON public."ops_uptime_daily" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text, 'operation_head'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text, 'operation_head'::text])));
ALTER POLICY "pay_baseline_read" ON public."pay_baseline" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text, 'accounts'::text])));
ALTER POLICY "pay_check_runs_read" ON public."pay_check_runs" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text, 'accounts'::text])));
ALTER POLICY "payments_accounts_read" ON public."payments" USING (((SELECT get_my_role()) = 'accounts'::text));
ALTER POLICY "payments_admin_all" ON public."payments" USING (((SELECT get_my_role()) = 'admin'::text));
ALTER POLICY "payments_govt_partner_read" ON public."payments" USING (((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (SELECT auth.uid())) AND (u.team_role = 'government_partner'::text)))) AND (EXISTS ( SELECT 1
   FROM quotes q
  WHERE ((q.id = payments.quote_id) AND (q.segment = 'GOVERNMENT'::text))))));
ALTER POLICY "payments_sales_delete_own" ON public."payments" USING ((((SELECT get_my_role()) = ANY (ARRAY['sales'::text, 'agency'::text, 'telecaller'::text, 'sales_manager'::text])) AND (quote_id IN ( SELECT quotes.id
   FROM quotes
  WHERE (quotes.created_by = (SELECT auth.uid())))) AND (approval_status = 'pending'::text)));
ALTER POLICY "payments_sales_insert_own" ON public."payments" WITH CHECK ((((SELECT get_my_role()) = ANY (ARRAY['sales'::text, 'agency'::text, 'telecaller'::text, 'sales_manager'::text])) AND (quote_id IN ( SELECT quotes.id
   FROM quotes
  WHERE (quotes.created_by = (SELECT auth.uid())))) AND (approval_status = 'pending'::text)));
ALTER POLICY "payments_sales_read_own" ON public."payments" USING ((((SELECT get_my_role()) = ANY (ARRAY['sales'::text, 'agency'::text, 'telecaller'::text, 'sales_manager'::text])) AND (quote_id IN ( SELECT quotes.id
   FROM quotes
  WHERE (quotes.created_by = (SELECT auth.uid()))))));
ALTER POLICY "payments_sales_update_own" ON public."payments" USING ((((SELECT get_my_role()) = ANY (ARRAY['sales'::text, 'agency'::text, 'telecaller'::text, 'sales_manager'::text])) AND (quote_id IN ( SELECT quotes.id
   FROM quotes
  WHERE (quotes.created_by = (SELECT auth.uid())))) AND (approval_status = 'pending'::text)));
ALTER POLICY "pdf_share_tokens_admin_all" ON public."pdf_share_tokens" USING (((SELECT get_my_role()) = 'admin'::text));
ALTER POLICY "pdf_share_tokens_govt_partner_read" ON public."pdf_share_tokens" USING (((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (SELECT auth.uid())) AND (u.team_role = 'government_partner'::text)))) AND (EXISTS ( SELECT 1
   FROM quotes q
  WHERE ((q.id = pdf_share_tokens.quote_id) AND (q.segment = 'GOVERNMENT'::text))))));
ALTER POLICY "pdf_share_tokens_lead_owner_insert" ON public."pdf_share_tokens" WITH CHECK (((created_by = (SELECT auth.uid())) AND is_lead_quote_owner(quote_id) AND (expires_at <= (now() + '91 days'::interval)) AND (length(token) >= 32)));
ALTER POLICY "pdf_share_tokens_self_insert" ON public."pdf_share_tokens" WITH CHECK ((((SELECT get_my_role()) = ANY (ARRAY['sales'::text, 'agency'::text, 'telecaller'::text, 'sales_manager'::text])) AND (created_by = (SELECT auth.uid())) AND (EXISTS ( SELECT 1
   FROM quotes q
  WHERE ((q.id = pdf_share_tokens.quote_id) AND (q.created_by = (SELECT auth.uid())))))));
ALTER POLICY "pdf_share_tokens_self_read" ON public."pdf_share_tokens" USING ((((SELECT get_my_role()) = ANY (ARRAY['sales'::text, 'agency'::text, 'telecaller'::text, 'sales_manager'::text])) AND (created_by = (SELECT auth.uid()))));
ALTER POLICY "ps_admin_all" ON public."presentation_sessions" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "ps_self_all" ON public."presentation_sessions" USING ((user_id = (SELECT auth.uid()))) WITH CHECK ((user_id = (SELECT auth.uid())));
ALTER POLICY "pt_admin_write" ON public."proposal_templates" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'owner'::text, 'co_owner'::text])));
ALTER POLICY "pt_read_all" ON public."proposal_templates" USING (((SELECT auth.uid()) IS NOT NULL));
ALTER POLICY "push_health_alerts_admin_read" ON public."push_health_alerts" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "push_log_admin" ON public."push_log" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "push_outcomes_admin_read" ON public."push_outcomes" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "ps_admin" ON public."push_subscriptions" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "ps_self" ON public."push_subscriptions" USING ((user_id = (SELECT auth.uid()))) WITH CHECK ((user_id = (SELECT auth.uid())));
ALTER POLICY "qr_scans_admin_read" ON public."qr_scans" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "qc_admin_all" ON public."quote_cities" USING (((SELECT get_my_role()) = 'admin'::text));
ALTER POLICY "qc_govt_partner_read" ON public."quote_cities" USING (((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (SELECT auth.uid())) AND (u.team_role = 'government_partner'::text)))) AND (EXISTS ( SELECT 1
   FROM quotes q
  WHERE ((q.id = quote_cities.quote_id) AND (q.segment = 'GOVERNMENT'::text))))));
ALTER POLICY "qc_govt_partner_write" ON public."quote_cities" USING (((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (SELECT auth.uid())) AND (u.team_role = 'government_partner'::text) AND u.is_active))) AND (EXISTS ( SELECT 1
   FROM quotes q
  WHERE ((q.id = quote_cities.quote_id) AND (q.created_by = (SELECT auth.uid())) AND (q.segment = 'GOVERNMENT'::text) AND (q.status <> 'won'::text)))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (SELECT auth.uid())) AND (u.team_role = 'government_partner'::text) AND u.is_active))) AND (EXISTS ( SELECT 1
   FROM quotes q
  WHERE ((q.id = quote_cities.quote_id) AND (q.created_by = (SELECT auth.uid())) AND (q.segment = 'GOVERNMENT'::text) AND (q.status <> 'won'::text))))));
ALTER POLICY "qc_office_admin_read" ON public."quote_cities" USING ((((SELECT get_my_role()) = 'office_admin'::text) AND (EXISTS ( SELECT 1
   FROM quotes q
  WHERE ((q.id = quote_cities.quote_id) AND (q.segment = 'GOVERNMENT'::text))))));
ALTER POLICY "qc_sales_head_delete" ON public."quote_cities" USING (((SELECT is_sales_head()) AND (EXISTS ( SELECT 1
   FROM quotes q
  WHERE ((q.id = quote_cities.quote_id) AND (q.status <> 'won'::text))))));
ALTER POLICY "qc_sales_head_insert" ON public."quote_cities" WITH CHECK (((SELECT is_sales_head()) AND (EXISTS ( SELECT 1
   FROM quotes q
  WHERE ((q.id = quote_cities.quote_id) AND (q.status <> 'won'::text))))));
ALTER POLICY "qc_sales_head_read" ON public."quote_cities" USING (((SELECT is_sales_head()) AND (EXISTS ( SELECT 1
   FROM quotes q
  WHERE ((q.id = quote_cities.quote_id) AND (q.segment = 'PRIVATE'::text))))));
ALTER POLICY "qc_sales_own" ON public."quote_cities" USING ((((SELECT get_my_role()) = ANY (ARRAY['sales'::text, 'agency'::text, 'telecaller'::text, 'sales_manager'::text])) AND (quote_id IN ( SELECT quotes.id
   FROM quotes
  WHERE (quotes.created_by = (SELECT auth.uid())))))) WITH CHECK ((((SELECT get_my_role()) = ANY (ARRAY['sales'::text, 'agency'::text, 'telecaller'::text, 'sales_manager'::text])) AND (quote_id IN ( SELECT quotes.id
   FROM quotes
  WHERE (quotes.created_by = (SELECT auth.uid()))))));
ALTER POLICY "quote_costs_admin_accounts" ON public."quote_costs" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'accounts'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'accounts'::text])));
ALTER POLICY "quote_costs_govt_partner_read" ON public."quote_costs" USING (((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (SELECT auth.uid())) AND (u.team_role = 'government_partner'::text)))) AND (EXISTS ( SELECT 1
   FROM quotes q
  WHERE ((q.id = quote_costs.quote_id) AND (q.segment = 'GOVERNMENT'::text))))));
ALTER POLICY "qpa_admin_all" ON public."quote_price_approvals" USING (((SELECT get_my_role()) = 'admin'::text)) WITH CHECK (((SELECT get_my_role()) = 'admin'::text));
ALTER POLICY "qpa_owner_read" ON public."quote_price_approvals" USING (((requested_by = (SELECT auth.uid())) OR (EXISTS ( SELECT 1
   FROM quotes q
  WHERE ((q.id = quote_price_approvals.quote_id) AND (q.created_by = (SELECT auth.uid()))))) OR is_lead_quote_owner(quote_id)));
ALTER POLICY "qpa_sales_head_decide" ON public."quote_price_approvals" USING ((qpa_is_active_head() AND (status = 'pending'::text) AND (requested_by IS DISTINCT FROM (SELECT auth.uid())) AND (NOT (EXISTS ( SELECT 1
   FROM quotes q
  WHERE ((q.id = quote_price_approvals.quote_id) AND (q.created_by = (SELECT auth.uid()))))))));
ALTER POLICY "quotes_accounts_read" ON public."quotes" USING (((SELECT get_my_role()) = 'accounts'::text));
ALTER POLICY "quotes_admin_all" ON public."quotes" USING (((SELECT get_my_role()) = 'admin'::text));
ALTER POLICY "quotes_govt_partner_insert" ON public."quotes" WITH CHECK (((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (SELECT auth.uid())) AND (u.team_role = 'government_partner'::text) AND u.is_active))) AND (created_by = (SELECT auth.uid())) AND (segment = 'GOVERNMENT'::text) AND (status <> 'won'::text)));
ALTER POLICY "quotes_govt_partner_read" ON public."quotes" USING (((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (SELECT auth.uid())) AND (u.team_role = 'government_partner'::text)))) AND (segment = 'GOVERNMENT'::text)));
ALTER POLICY "quotes_govt_partner_update" ON public."quotes" USING (((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (SELECT auth.uid())) AND (u.team_role = 'government_partner'::text) AND u.is_active))) AND (created_by = (SELECT auth.uid())) AND (segment = 'GOVERNMENT'::text) AND (status <> 'won'::text))) WITH CHECK (((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (SELECT auth.uid())) AND (u.team_role = 'government_partner'::text) AND u.is_active))) AND (created_by = (SELECT auth.uid())) AND (segment = 'GOVERNMENT'::text) AND (status <> 'won'::text)));
ALTER POLICY "quotes_office_admin_read" ON public."quotes" USING ((((SELECT get_my_role()) = 'office_admin'::text) AND (segment = 'GOVERNMENT'::text)));
ALTER POLICY "quotes_sales_head_edit" ON public."quotes" USING (((SELECT is_sales_head()) AND (segment = 'PRIVATE'::text) AND (status <> 'won'::text))) WITH CHECK (((SELECT is_sales_head()) AND (segment = 'PRIVATE'::text) AND (status <> 'won'::text) AND sh_quote_unchanged(id, created_by, segment, media_type, lead_id, quote_number)));
ALTER POLICY "quotes_sales_head_read" ON public."quotes" USING (((SELECT is_sales_head()) AND (segment = 'PRIVATE'::text)));
ALTER POLICY "quotes_sales_own" ON public."quotes" USING ((((SELECT get_my_role()) = ANY (ARRAY['sales'::text, 'agency'::text, 'telecaller'::text, 'sales_manager'::text])) AND (created_by = (SELECT auth.uid())))) WITH CHECK ((((SELECT get_my_role()) = ANY (ARRAY['sales'::text, 'agency'::text, 'telecaller'::text, 'sales_manager'::text])) AND (created_by = (SELECT auth.uid()))));
ALTER POLICY "reassign_audit_admin_all" ON public."reassign_audit" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "reassign_audit_self_read" ON public."reassign_audit" USING ((caller_id = (SELECT auth.uid())));
ALTER POLICY "salary_audit_admin_read" ON public."salary_change_audit" USING (((SELECT get_my_role()) = 'admin'::text));
ALTER POLICY "salary_payouts_accounts_all" ON public."salary_payouts" USING (((SELECT get_my_role()) = 'accounts'::text)) WITH CHECK (((SELECT get_my_role()) = 'accounts'::text));
ALTER POLICY "sp_admin_all" ON public."salary_payouts" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "sp_self_read" ON public."salary_payouts" USING ((user_id = (SELECT auth.uid())));
ALTER POLICY "salary_policy_accounts_all" ON public."salary_policy" USING (((SELECT get_my_role()) = 'accounts'::text)) WITH CHECK (((SELECT get_my_role()) = 'accounts'::text));
ALTER POLICY "salary_policy_admin_all" ON public."salary_policy" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "sip_admin_all" ON public."staff_incentive_profiles" USING (((SELECT get_my_role()) = 'admin'::text));
ALTER POLICY "sip_hr_write" ON public."staff_incentive_profiles" USING ((((SELECT get_my_role()) = 'hr'::text) AND (COALESCE(( SELECT u.role
   FROM users u
  WHERE (u.id = staff_incentive_profiles.user_id)), ''::text) <> ALL (ARRAY['admin'::text, 'co_owner'::text])))) WITH CHECK ((((SELECT get_my_role()) = 'hr'::text) AND (COALESCE(( SELECT u.role
   FROM users u
  WHERE (u.id = staff_incentive_profiles.user_id)), ''::text) <> ALL (ARRAY['admin'::text, 'co_owner'::text]))));
ALTER POLICY "sip_sales_own" ON public."staff_incentive_profiles" USING ((((SELECT get_my_role()) = ANY (ARRAY['sales'::text, 'agency'::text])) AND (user_id = (SELECT auth.uid()))));
ALTER POLICY "sip_sales_read_own" ON public."staff_incentive_profiles" USING ((((SELECT get_my_role()) = ANY (ARRAY['sales'::text, 'agency'::text, 'telecaller'::text, 'sales_manager'::text])) AND (user_id = (SELECT auth.uid()))));
ALTER POLICY "staff_incentive_profiles_accounts_all" ON public."staff_incentive_profiles" USING (((SELECT get_my_role()) = 'accounts'::text)) WITH CHECK (((SELECT get_my_role()) = 'accounts'::text));
ALTER POLICY "ta_da_requests_accounts_all" ON public."ta_da_requests" USING (((SELECT get_my_role()) = 'accounts'::text)) WITH CHECK (((SELECT get_my_role()) = 'accounts'::text));
ALTER POLICY "ta_da_requests_hr_all" ON public."ta_da_requests" USING (((SELECT get_my_role()) = 'hr'::text)) WITH CHECK (((SELECT get_my_role()) = 'hr'::text));
ALTER POLICY "ta_da_requests_office_admin_all" ON public."ta_da_requests" USING (((SELECT get_my_role()) = 'office_admin'::text)) WITH CHECK (((SELECT get_my_role()) = 'office_admin'::text));
ALTER POLICY "ta_requests_manager_read" ON public."ta_da_requests" USING (((SELECT is_sales_manager()) AND (user_id IN ( SELECT users.id
   FROM users
  WHERE (users.manager_id = (SELECT auth.uid()))))));
ALTER POLICY "ta_requests_manager_update" ON public."ta_da_requests" USING (((SELECT is_sales_manager()) AND (user_id IN ( SELECT users.id
   FROM users
  WHERE (users.manager_id = (SELECT auth.uid())))))) WITH CHECK (((SELECT is_sales_manager()) AND (user_id IN ( SELECT users.id
   FROM users
  WHERE (users.manager_id = (SELECT auth.uid()))))));
ALTER POLICY "ta_requests_sales_head_read" ON public."ta_da_requests" USING ((SELECT is_sales_head()));
ALTER POLICY "tda_admin" ON public."ta_da_requests" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "tda_self" ON public."ta_da_requests" USING ((user_id = (SELECT auth.uid()))) WITH CHECK (((user_id = (SELECT auth.uid())) AND (status = 'pending'::text)));
ALTER POLICY "tar_admin_read" ON public."team_assistant_requests" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text, 'accounts'::text])));
ALTER POLICY "team_wa_messages_admin_read" ON public."team_wa_messages" USING (COALESCE(((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])), false));
ALTER POLICY "training_completions_read" ON public."training_completions" USING (((user_id = (SELECT auth.uid())) OR ((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text]))));
ALTER POLICY "training_completions_self_write" ON public."training_completions" WITH CHECK ((user_id = (SELECT auth.uid())));
ALTER POLICY "np_self" ON public."user_notification_prefs" USING ((user_id = (SELECT auth.uid()))) WITH CHECK ((user_id = (SELECT auth.uid())));
ALTER POLICY "users_admin_write" ON public."users" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'owner'::text, 'co_owner'::text])));
ALTER POLICY "users_hr_read" ON public."users" USING (((SELECT get_my_role()) = 'hr'::text));
ALTER POLICY "users_office_admin_read" ON public."users" USING (((SELECT get_my_role()) = 'office_admin'::text));
ALTER POLICY "users_read_all" ON public."users" USING (((SELECT auth.uid()) IS NOT NULL));
ALTER POLICY "users_self_update_avatar" ON public."users" USING ((id = (SELECT auth.uid()))) WITH CHECK (((id = (SELECT auth.uid())) AND (NOT (role IS DISTINCT FROM ( SELECT u.role
   FROM users u
  WHERE (u.id = (SELECT auth.uid()))))) AND (NOT (team_role IS DISTINCT FROM ( SELECT u.team_role
   FROM users u
  WHERE (u.id = (SELECT auth.uid()))))) AND (NOT (segment_access IS DISTINCT FROM ( SELECT u.segment_access
   FROM users u
  WHERE (u.id = (SELECT auth.uid()))))) AND (NOT (manager_id IS DISTINCT FROM ( SELECT u.manager_id
   FROM users u
  WHERE (u.id = (SELECT auth.uid()))))) AND (NOT (is_active IS DISTINCT FROM ( SELECT u.is_active
   FROM users u
  WHERE (u.id = (SELECT auth.uid()))))) AND (NOT (email IS DISTINCT FROM ( SELECT u.email
   FROM users u
  WHERE (u.id = (SELECT auth.uid()))))) AND (NOT (signing_authority IS DISTINCT FROM ( SELECT u.signing_authority
   FROM users u
  WHERE (u.id = (SELECT auth.uid()))))) AND (NOT (hr_accepted_at IS DISTINCT FROM ( SELECT u.hr_accepted_at
   FROM users u
  WHERE (u.id = (SELECT auth.uid()))))) AND (NOT (hr_accepted_by IS DISTINCT FROM ( SELECT u.hr_accepted_by
   FROM users u
  WHERE (u.id = (SELECT auth.uid()))))) AND (NOT (hr_acceptance_note IS DISTINCT FROM ( SELECT u.hr_acceptance_note
   FROM users u
  WHERE (u.id = (SELECT auth.uid()))))) AND (NOT (can_view_team_dashboard IS DISTINCT FROM ( SELECT u.can_view_team_dashboard
   FROM users u
  WHERE (u.id = (SELECT auth.uid()))))) AND (NOT (is_sales_head IS DISTINCT FROM ( SELECT u.is_sales_head
   FROM users u
  WHERE (u.id = (SELECT auth.uid())))))));
ALTER POLICY "voice_logs_insert_self" ON public."voice_logs" WITH CHECK ((user_id = (SELECT auth.uid())));
ALTER POLICY "voice_logs_select_self_or_chain" ON public."voice_logs" USING (((user_id = (SELECT auth.uid())) OR ((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = voice_logs.user_id) AND (u.manager_id = (SELECT auth.uid())))))));
ALTER POLICY "voice_logs_update_self" ON public."voice_logs" USING ((user_id = (SELECT auth.uid()))) WITH CHECK ((user_id = (SELECT auth.uid())));
ALTER POLICY "wa_cadence_templates_admin" ON public."wa_cadence_templates" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "wa_outcome_templates_admin" ON public."wa_outcome_templates" USING (COALESCE(((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])), false)) WITH CHECK (COALESCE(((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])), false));
ALTER POLICY "wa_quality_log_read" ON public."wa_quality_log" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text, 'accounts'::text])));
ALTER POLICY "webhook_log_admin" ON public."webhook_event_log" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "wa_accounts_admin_write" ON public."whatsapp_accounts" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "wa_conv_admin" ON public."whatsapp_conversations" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "wa_conv_self_or_lead" ON public."whatsapp_conversations" USING ((((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])) OR (SELECT is_team_viewer()) OR (assigned_to = (SELECT auth.uid())) OR ((lead_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM leads l
  WHERE (l.id = whatsapp_conversations.lead_id))))));
ALTER POLICY "wa_conv_team_viewer" ON public."whatsapp_conversations" USING ((SELECT is_team_viewer()));
ALTER POLICY "wa_msg_admin" ON public."whatsapp_messages" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "wa_msg_via_conv" ON public."whatsapp_messages" USING ((((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])) OR (SELECT is_team_viewer()) OR (EXISTS ( SELECT 1
   FROM whatsapp_conversations c
  WHERE (c.id = whatsapp_messages.conversation_id)))));
ALTER POLICY "wa_tmpl_admin_write" ON public."whatsapp_templates" USING (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text]))) WITH CHECK (((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])));
ALTER POLICY "was_read" ON public."work_activity_slices" USING ((work_is_active_user() AND ((user_id = (SELECT auth.uid())) OR work_is_head())));
ALTER POLICY "wad_read" ON public."work_agent_devices" USING ((work_is_active_user() AND ((user_id = (SELECT auth.uid())) OR work_is_head())));
ALTER POLICY "work_deleted_tasks_admin_read" ON public."work_deleted_tasks" USING (COALESCE(((SELECT get_my_role()) = ANY (ARRAY['admin'::text, 'co_owner'::text])), false));
ALTER POLICY "wie_read" ON public."work_idle_events" USING ((work_is_active_user() AND ((user_id = (SELECT auth.uid())) OR work_is_head())));
ALTER POLICY "work_members_read" ON public."work_members" USING (((user_id = (SELECT auth.uid())) OR work_is_head()));
ALTER POLICY "work_reminders_own_read" ON public."work_reminders" USING ((user_id = (SELECT auth.uid())));
ALTER POLICY "work_shares_read" ON public."work_report_shares" USING ((work_is_active_user() AND ((user_id = (SELECT auth.uid())) OR work_is_head())));
ALTER POLICY "wsh_read" ON public."work_screenshots" USING ((work_is_active_user() AND ((user_id = (SELECT auth.uid())) OR work_is_head())));
ALTER POLICY "work_sessions_admin_all" ON public."work_sessions" USING (((SELECT get_my_role()) = 'admin'::text));
ALTER POLICY "work_sessions_govt_partner" ON public."work_sessions" USING (((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (SELECT auth.uid())) AND (u.team_role = 'government_partner'::text)))) AND (user_id IN ( SELECT users.id
   FROM users
  WHERE (users.team_role = ANY (ARRAY['sales'::text, 'telecaller'::text, 'agency'::text]))))));
ALTER POLICY "work_sessions_hr_read" ON public."work_sessions" USING (((SELECT get_my_role()) = 'hr'::text));
ALTER POLICY "work_sessions_manager" ON public."work_sessions" USING ((user_id IN ( SELECT users.id
   FROM users
  WHERE (users.manager_id = (SELECT auth.uid())))));
ALTER POLICY "work_sessions_office_admin_read" ON public."work_sessions" USING (((SELECT get_my_role()) = 'office_admin'::text));
ALTER POLICY "work_sessions_ops_head" ON public."work_sessions" USING ((((SELECT get_my_role()) = 'operation_head'::text) AND (user_id IN ( SELECT users.id
   FROM users
  WHERE (users.role = 'operation_executive'::text)))));
ALTER POLICY "work_sessions_own" ON public."work_sessions" USING ((user_id = (SELECT auth.uid())));
ALTER POLICY "work_task_nudges_read" ON public."work_task_nudges" USING (((user_id = (SELECT auth.uid())) OR (sent_by = (SELECT auth.uid())) OR work_is_head()));
ALTER POLICY "work_templates_read" ON public."work_templates" USING ((work_is_active_user() AND ((created_by = (SELECT auth.uid())) OR (assignee_id = (SELECT auth.uid())) OR work_is_head())));
ALTER POLICY "work_entries_read" ON public."work_time_entries" USING ((work_is_active_user() AND ((user_id = (SELECT auth.uid())) OR work_is_head())));
ALTER POLICY "wtp_read" ON public."work_tracking_people" USING ((work_is_active_user() AND ((user_id = (SELECT auth.uid())) OR work_is_head())));

DROP INDEX IF EXISTS public.idx_lead_activities_created_by;
DROP INDEX IF EXISTS public.idx_work_sessions_today_no_checkin;
COMMIT;

NOTIFY pgrst, 'reload schema';

-- VERIFY:
-- 1) supabase db advisors --type performance -> auth_rls_initplan 0, duplicate_index 0
-- 2) visible-row snapshot per role (scratch script, 18 Nov) identical before/after
