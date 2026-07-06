-- ============================================================================
-- Phase 193 — REAL /team-dashboard for a per-user viewer, via ONE gated RPC
-- ============================================================================
-- Owner wants Jayna (a telecaller) to see the SAME /team-dashboard admin page —
-- NOT a new page — while staying own-only on /leads, /work, etc. Phase 192 did
-- it with 13 broad SELECT policies → leaked ALL leads/clients to her everywhere
-- (RLS is app-wide). This file gives the real page WITHOUT any broad RLS:
--
--   • DROPs the 13 Phase 192 leak policies (idempotent, safe no-op if gone).
--   • DROPs the interim team_monitor_snapshot() (the light page is retired).
--   • Creates ONE gated SECURITY DEFINER RPC, team_dashboard_bundle(), that
--     returns the EXACT bundle TeamDashboardV2's loader builds (the same 18
--     reads). The admin keeps their existing client-side Promise.all path
--     unchanged; ONLY a flagged viewer (or admin, as a fallback) calls this RPC.
--   • Keeps the flag column + is_team_viewer() helper.
--
-- Gated: returns '{}'::jsonb to anyone who is not is_team_viewer() OR admin/
-- co_owner, so a plain rep gets nothing. The viewer's own RLS on /leads, /work
-- stays own-only — she reads team data ONLY through this function.
--
-- ⚠️ MIRROR: the sub-selects below MUST match TeamDashboardV2.jsx's loader
-- Promise.all (lines ~307-495) column-for-column + filter-for-filter. If a
-- dashboard query changes there, update the matching branch here or the
-- viewer's numbers drift from the admin's. (It's a monitoring view, not pay —
-- a drift is cosmetic, not financial.)
--
-- Self-contained + re-runnable-safe (§8/§71): re-running only re-asserts the
-- closed state; it can NEVER recreate the leak.
--
-- TO GRANT: UPDATE public.users SET can_view_team_dashboard = true WHERE email='..';
-- ============================================================================

-- ---- flag column + helper (idempotent) -------------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS can_view_team_dashboard boolean NOT NULL DEFAULT false;

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

-- ---- CLOSE THE LEAK: drop the 13 Phase 192 broad SELECT policies ------------
DO $$
DECLARE t text;
  tbls text[] := ARRAY[
    'gps_pings','gps_off_events','users','work_sessions','call_logs','leads',
    'quotes','voice_logs','daily_targets','follow_ups','payments',
    'lead_activities','push_subscriptions'];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_team_viewer_read', t);
  END LOOP;
END $$;

-- ---- retire the interim light-monitor RPC (superseded by the bundle) --------
DROP FUNCTION IF EXISTS public.team_monitor_snapshot();

-- ---- the ONE gated bundle RPC (mirrors TeamDashboardV2 loader) --------------
CREATE OR REPLACE FUNCTION public.team_dashboard_bundle(
  p_start_of_day timestamptz,
  p_end_of_day   timestamptz,
  p_period_start date,
  p_period_end   date,
  p_today        date,
  p_cb_floor     date,
  p_month_start  timestamptz,
  p_month_end    timestamptz
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_out jsonb;
BEGIN
  -- GATE: viewer or admin/co_owner only; else empty object (no data leak).
  -- COALESCE(..., false) around the IN so a NULL role fails CLOSED — a bare
  -- `NULL IN (...)` yields NULL, and `false OR NULL` → NULL → PL/pgSQL IF treats
  -- NULL as false → the RETURN would be SKIPPED and the full bundle leak. This is
  -- the §41/§97.2 3VL trap; is_team_viewer() is already COALESCE'd to false.
  IF NOT (public.is_team_viewer()
          OR COALESCE(public.get_my_role() IN ('admin', 'co_owner'), false)) THEN
    RETURN '{}'::jsonb;
  END IF;

  SELECT jsonb_build_object(

    -- 1) reps  (users grid — sales/sales_manager/telecaller, active, by name)
    'reps', COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.name)
      FROM (
        SELECT id, name, team_role, city, daily_targets, is_active, profile_image_url, app_version  -- Phase 208
        FROM public.users
        WHERE team_role IN ('sales','sales_manager','telecaller')
          AND is_active = true
      ) r
    ), '[]'::jsonb),

    -- 2) sessions  (work_sessions for the day)
    'sessions', COALESCE((
      SELECT jsonb_agg(to_jsonb(s))
      FROM (
        SELECT user_id, check_in_at, check_out_at, auto_checked_out,
               check_out_source, daily_counters
        FROM public.work_sessions
        WHERE work_date = p_today
      ) s
    ), '[]'::jsonb),

    -- 3) calls  (lead-tied, >=10s, non-missed, in window)
    'calls', COALESCE((
      SELECT jsonb_agg(to_jsonb(c))
      FROM (
        SELECT user_id, outcome
        FROM public.call_logs
        WHERE call_at >= p_start_of_day AND call_at < p_end_of_day
          AND duration_seconds >= 10
          AND (direction IS NULL OR direction <> 'missed')
          AND lead_id IS NOT NULL
      ) c
    ), '[]'::jsonb),

    -- 4) new_leads_count  (leads created in window — count only)
    'new_leads_count', (
      SELECT count(*) FROM public.leads
      WHERE created_at >= p_start_of_day AND created_at < p_end_of_day
    ),

    -- 5) pipeline  (won quotes created in window)
    'pipeline', COALESCE((
      SELECT jsonb_agg(to_jsonb(q))
      FROM (
        SELECT total_amount, status
        FROM public.quotes
        WHERE status = 'won'
          AND created_at >= p_start_of_day AND created_at < p_end_of_day
      ) q
    ), '[]'::jsonb),

    -- 6) voice  (voice_logs in window)
    'voice', COALESCE((
      SELECT jsonb_agg(to_jsonb(v))
      FROM (
        SELECT user_id FROM public.voice_logs
        WHERE created_at >= p_start_of_day AND created_at < p_end_of_day
      ) v
    ), '[]'::jsonb),

    -- 7) pings  (latest ping per rep in window — mirrors latest_ping_per_user)
    'pings', COALESCE((
      SELECT jsonb_agg(to_jsonb(pg))
      FROM (
        SELECT DISTINCT ON (user_id) user_id, lat, lng, captured_at
        FROM public.gps_pings
        WHERE captured_at >= p_start_of_day AND captured_at < p_end_of_day
        ORDER BY user_id, captured_at DESC
      ) pg
    ), '[]'::jsonb),

    -- 8) policy  (active daily_targets rows)
    'policy', COALESCE((
      SELECT jsonb_agg(to_jsonb(dt))
      FROM (
        SELECT user_id, min_calls, min_qualified_weekly
        FROM public.daily_targets
        WHERE effective_to IS NULL
      ) dt
    ), '[]'::jsonb),

    -- 9) fu  (follow-ups: done-in-window OR open-dated-in-window)
    'fu', COALESCE((
      SELECT jsonb_agg(to_jsonb(f))
      FROM (
        SELECT assigned_to, is_done, follow_up_date, done_at, done_note
        FROM public.follow_ups
        WHERE (is_done = true  AND done_at >= p_start_of_day AND done_at < p_end_of_day)
           OR (is_done = false AND follow_up_date >= p_period_start AND follow_up_date < p_period_end)
      ) f
    ), '[]'::jsonb),

    -- 10) quote_sent  (all status='sent' quotes; chased client-side)
    'quote_sent', COALESCE((
      SELECT jsonb_agg(to_jsonb(q))
      FROM (
        SELECT id, created_by, status, updated_at, total_amount
        FROM public.quotes WHERE status = 'sent'
      ) q
    ), '[]'::jsonb),

    -- 11) quote_won  (all status='won' quotes; joined to payments client-side)
    'quote_won', COALESCE((
      SELECT jsonb_agg(to_jsonb(q))
      FROM (
        SELECT id, created_by, status, total_amount
        FROM public.quotes WHERE status = 'won'
      ) q
    ), '[]'::jsonb),

    -- 12) payments  (all rows; summed per quote_id client-side)
    'payments', COALESCE((
      SELECT jsonb_agg(to_jsonb(p))
      FROM (
        SELECT quote_id, amount_received, approval_status
        FROM public.payments
      ) p
    ), '[]'::jsonb),

    -- 13) overdue_fu  (open follow-ups past today — always-now, not windowed)
    'overdue_fu', COALESCE((
      SELECT jsonb_agg(to_jsonb(o))
      FROM (
        SELECT assigned_to FROM public.follow_ups
        WHERE follow_up_date < p_today AND is_done = false
      ) o
    ), '[]'::jsonb),

    -- 14) act_geo  (geo-tagged meeting/site_visit pins, last 90d, latest 500)
    'act_geo', COALESCE((
      SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC)
      FROM (
        SELECT la.id, la.created_at, la.created_by, la.activity_type, la.outcome,
               la.gps_lat, la.gps_lng,
               (SELECT jsonb_build_object('id', l.id, 'name', l.name, 'company', l.company)
                  FROM public.leads l WHERE l.id = la.lead_id) AS lead
        FROM public.lead_activities la
        WHERE la.activity_type IN ('meeting','site_visit')
          AND la.created_at >= (now() - interval '90 days')
        ORDER BY la.created_at DESC
        LIMIT 500
      ) a
    ), '[]'::jsonb),

    -- 15) qualified  (TC positive-outcome calls in window)
    'qualified', COALESCE((
      SELECT jsonb_agg(to_jsonb(qa))
      FROM (
        SELECT created_by FROM public.lead_activities
        WHERE activity_type = 'call' AND outcome = 'positive'
          AND created_at >= p_start_of_day AND created_at < p_end_of_day
      ) qa
    ), '[]'::jsonb),

    -- 16) callbacks  (open callbacks due: cb_floor..today)
    'callbacks', COALESCE((
      SELECT jsonb_agg(to_jsonb(cb))
      FROM (
        SELECT assigned_to, lead_id, id FROM public.follow_ups
        WHERE is_done = false
          AND follow_up_date >= p_cb_floor AND follow_up_date <= p_today
      ) cb
    ), '[]'::jsonb),

    -- 17) month_quotes  (quotes created this calendar month, per created_by)
    'month_quotes', COALESCE((
      SELECT jsonb_agg(to_jsonb(mq))
      FROM (
        SELECT created_by, total_amount FROM public.quotes
        WHERE created_at >= p_month_start AND created_at < p_month_end
      ) mq
    ), '[]'::jsonb),

    -- 18) month_won  (quotes won this calendar month, per created_by)
    'month_won', COALESCE((
      SELECT jsonb_agg(to_jsonb(mw))
      FROM (
        SELECT created_by, total_amount FROM public.quotes
        WHERE status = 'won'
          AND updated_at >= p_month_start AND updated_at < p_month_end
      ) mw
    ), '[]'::jsonb),

    -- 19) push_subs  (freshest push row per rep — for the Push/Online pills;
    --     only user_id + last_seen_at, never the endpoint/keys)
    'push_subs', COALESCE((
      SELECT jsonb_agg(to_jsonb(ps))
      FROM (
        SELECT DISTINCT ON (user_id) user_id, last_seen_at
        FROM public.push_subscriptions
        ORDER BY user_id, last_seen_at DESC
      ) ps
    ), '[]'::jsonb),

    -- 20) gps_off  (OPEN gps-off events per rep — for the GPS on/off pill)
    'gps_off', COALESCE((
      SELECT jsonb_agg(to_jsonb(go))
      FROM (
        SELECT user_id, toggled_off_at
        FROM public.gps_off_events
        WHERE toggled_on_at IS NULL
      ) go
    ), '[]'::jsonb)

  ) INTO v_out;

  RETURN v_out;
END $function$;

GRANT EXECUTE ON FUNCTION public.team_dashboard_bundle(
  timestamptz, timestamptz, date, date, date, date, timestamptz, timestamptz
) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY
-- ============================================================================
-- SELECT count(*) AS leak_policies FROM pg_policies
--   WHERE schemaname='public' AND policyname LIKE '%\_team\_viewer\_read';        -- 0
-- SELECT to_regprocedure('public.team_monitor_snapshot()')   IS NULL AS snapshot_gone;  -- t
-- SELECT to_regprocedure('public.team_dashboard_bundle(timestamptz,timestamptz,date,date,date,date,timestamptz,timestamptz)')
--        IS NOT NULL AS bundle_present;                                          -- t
-- As admin/viewer (today):
--   SELECT jsonb_array_length((public.team_dashboard_bundle(
--     now()::date::timestamptz, (now()::date + 1)::timestamptz,
--     now()::date, (now()::date + 1), now()::date, (now()::date - 7),
--     date_trunc('month', now())::timestamptz, (date_trunc('month', now()) + interval '1 month')::timestamptz
--   ))->'reps');                                                                 -- rep count
