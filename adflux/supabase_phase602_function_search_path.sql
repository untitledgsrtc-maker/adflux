-- Phase 602 — fix the Supabase advisor warning "function_search_path_mutable" (2026-11-18)
-- 51 public functions (none SECURITY DEFINER; Phase 601 did the last definer one) had no
-- fixed search_path. Pinned to the SAME lookup the database uses today ("$user", public,
-- extensions) minus $user, plus pg_temp last -> no change in how any name resolves.
-- No function body changed. None use extension functions; none sit in a table RLS policy
-- or an index (checked live 18 Nov); storage_path_to_quote_id is in the storage.objects
-- policy (per-file cost only). Idempotent: ALTER ... SET can be re-run.
-- Revert one: ALTER FUNCTION <sig> RESET search_path;

ALTER FUNCTION public.auto_create_incentive_profile() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.bump_daily_counter(uuid,text,integer,date) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.call_log_bump_counter() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.cancel_lead_cadence(uuid,text[]) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.clients_touch_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.detect_city(numeric,numeric) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.dismiss_auto_lost_suggestion(uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.enforce_evening_before_checkout() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.fy_for_date(date) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.gps_off_events_compute_duration() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.handle_payment_delete() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.handle_payment_insert() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.handle_payment_update() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.haversine_km(numeric,numeric,numeric,numeric) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.hr_candidate_call_counts() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.is_off_day(date) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.is_push_allowed_now() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.is_workday_for(uuid,date) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.ist_now() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.ist_today() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.lead_activity_after_insert() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.lead_after_insert_bump_counter() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.lead_auto_assign() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.lead_is_self_import(uuid,uuid,uuid,uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.lead_set_handoff_sla() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.lead_stamp_won_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.nearby_leads_for_user(uuid,double precision,double precision,integer) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.network_off_events_compute_duration() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.next_business_moment(timestamp with time zone) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.payments_no_backdate() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.qpa_line_key(uuid,text,uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.qpa_price_floor() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.quote_stamp_won_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.quotes_status_one_way() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.quotes_won_needs_campaign_dates() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.rebuild_monthly_sales(uuid,text) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.run_select(text) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.set_lead_geocode(uuid,numeric,numeric,text) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.spawn_lead_intro_cadence(uuid,uuid,date) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.spawn_nurture_followup(uuid,uuid,date,text) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.spawn_quote_chase_cadence(uuid,uuid,date) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.storage_path_to_quote_id(text) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.tda_set_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.tg_campaign_bot_flows_touch() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.touch_companies_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.touch_daily_targets_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.touch_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.trg_ta_claim_recompute_daily() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.update_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.user_first_name(uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.work_tasks_mark_auto() SET search_path = public, extensions, pg_temp;

NOTIFY pgrst, 'reload schema';

-- VERIFY (expect 0):
-- SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--  LEFT JOIN pg_depend d ON d.objid=p.oid AND d.deptype='e'
--  WHERE n.nspname='public' AND p.prokind='f' AND d.objid IS NULL
--    AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig,'{}')) c WHERE c LIKE 'search_path=%');
