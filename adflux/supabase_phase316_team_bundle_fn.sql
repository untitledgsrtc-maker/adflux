-- supabase_phase316_team_bundle_fn.sql
-- Phase 316 — FUNCTION-ONLY update of team_dashboard_bundle (the overdue_fu fix).
--
-- WHY THIS FILE (not re-running supabase_phase193_team_dashboard_gated.sql):
-- phase193 also DROP/CREATEs RLS policies on public.gps_pings — a HOT table reps
-- write to every few seconds. `DROP POLICY ... ON gps_pings` needs an exclusive
-- lock and DEADLOCKS against the live GPS inserts during business hours (the
-- 40P01 you hit). This file replaces ONLY the function, which locks just the
-- function (pg_proc) — safe to run anytime, no gps_pings contention.
--
-- Just paste + Run once. It's a CREATE OR REPLACE — idempotent, re-runnable.
-- The only change vs live: overdue_fu now excludes Lost + parked-Nurture rows so
-- the team-viewer (Jayna) overdue count matches the follow-ups list (§316).

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
  -- GATE: viewer or admin ONLY (co_owner excluded — Vishal is govt-scoped, §42);
  -- else empty object (no data leak).
  -- COALESCE(..., false) around the IN so a NULL role fails CLOSED — a bare
  -- `NULL IN (...)` yields NULL, and `false OR NULL` → NULL → PL/pgSQL IF treats
  -- NULL as false → the RETURN would be SKIPPED and the full bundle leak. This is
  -- the §41/§97.2 3VL trap; is_team_viewer() is already COALESCE'd to false.
  IF NOT (public.is_team_viewer()
          OR COALESCE(public.get_my_role() = 'admin', false)) THEN   -- admin only, NOT co_owner (Vishal is govt-scoped, §42)
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
        SELECT f.assigned_to FROM public.follow_ups f
        LEFT JOIN public.leads l ON l.id = f.lead_id
        WHERE f.follow_up_date < p_today AND f.is_done = false
          -- Phase 316 — match keepInFollowupQueue (§71): hide parked-Nurture +
          -- Lost rows so the card count == the FollowUpsV2 list (§133/§163).
          AND COALESCE(l.stage, '') <> 'Lost'
          -- COALESCE(...,false): a lead_id-NULL row (e.g. payment-collection
          -- follow-ups) has l.stage NULL → the Nurture test is NULL → keep it,
          -- matching the JS keepInFollowupQueue (undefined stage → true). Without
          -- this, NULL→false→row silently dropped → count-vs-list mismatch returns.
          AND NOT COALESCE(l.stage = 'Nurture' AND COALESCE(f.cadence_type, '') <> 'nurture', false)
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


-- VERIFY: the fix is present in the live function
-- SELECT pg_get_functiondef('public.team_dashboard_bundle(timestamptz,timestamptz,date,date,date,date,timestamptz,timestamptz)'::regprocedure) LIKE '%NOT COALESCE(l.stage%' AS overdue_fu_fixed;
