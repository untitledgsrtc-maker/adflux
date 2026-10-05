-- db/functions/team_dashboard_bundle.sql  —  CANONICAL home (CLAUDE.md §72). Phase 330.
--
-- Captured 2026-10-05 from the LIVE function (pg_get_functiondef), which already carried the Phase
-- 323 M21 `chase` arm. The ONLY change vs live: `new_leads_count` now adds `AND import_id IS NULL`
-- so CSV imports are not counted in the team-viewer's "New leads added today" (same rule as the
-- stored counter, useDaySummary and the admin TeamDashboardV2 query).
--
-- !! This SUPERSEDES the older copies in supabase_phase193_team_dashboard_gated.sql,
--    supabase_phase316_team_bundle_fn.sql and supabase_phase323_dashboard_agg_rpcs.sql. Re-running
--    ANY of those reverts this (193/316 also drop the M21 chase arm). Run THIS file only.
-- Function-only CREATE OR REPLACE: keeps the live ACL, takes no lock on gps_pings (a re-run of the
-- full 193 file deadlocked on it, §200).

CREATE OR REPLACE FUNCTION public.team_dashboard_bundle(p_start_of_day timestamp with time zone, p_end_of_day timestamp with time zone, p_period_start date, p_period_end date, p_today date, p_cb_floor date, p_month_start timestamp with time zone, p_month_end timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_out jsonb;
BEGIN
  -- GATE (UNCHANGED, §41/§97.2/§316): viewer or admin ONLY (co_owner excluded —
  -- Vishal is govt-scoped, §42). COALESCE around the IN so a NULL role fails
  -- CLOSED (bare NULL IN (...) yields NULL → false OR NULL → NULL → IF treats
  -- NULL as false → RETURN skipped → full bundle leak). is_team_viewer() is
  -- already COALESCE'd to false.
  IF NOT (public.is_team_viewer()
          OR COALESCE(public.get_my_role() = 'admin', false)) THEN
    RETURN '{}'::jsonb;
  END IF;

  SELECT jsonb_build_object(

    'reps', COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.name)
      FROM (
        SELECT id, name, team_role, city, daily_targets, is_active, profile_image_url, app_version
        FROM public.users
        WHERE team_role IN ('sales','sales_manager','telecaller')
          AND is_active = true
      ) r
    ), '[]'::jsonb),

    'sessions', COALESCE((
      SELECT jsonb_agg(to_jsonb(s))
      FROM (
        SELECT user_id, check_in_at, check_out_at, auto_checked_out,
               check_out_source, daily_counters
        FROM public.work_sessions
        WHERE work_date = p_today
      ) s
    ), '[]'::jsonb),

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

    -- Phase 330: CSV imports are not "added today" (import_id IS NULL), matching the stored
    -- counter trigger, useDaySummary and TeamDashboardV2's admin query.
    'new_leads_count', (
      SELECT count(*) FROM public.leads
      WHERE created_at >= p_start_of_day AND created_at < p_end_of_day
        AND import_id IS NULL
    ),

    'pipeline', COALESCE((
      SELECT jsonb_agg(to_jsonb(q))
      FROM (
        SELECT total_amount, status
        FROM public.quotes
        WHERE status = 'won'
          AND created_at >= p_start_of_day AND created_at < p_end_of_day
      ) q
    ), '[]'::jsonb),

    'voice', COALESCE((
      SELECT jsonb_agg(to_jsonb(v))
      FROM (
        SELECT user_id FROM public.voice_logs
        WHERE created_at >= p_start_of_day AND created_at < p_end_of_day
      ) v
    ), '[]'::jsonb),

    'pings', COALESCE((
      SELECT jsonb_agg(to_jsonb(pg))
      FROM (
        SELECT DISTINCT ON (user_id) user_id, lat, lng, captured_at
        FROM public.gps_pings
        WHERE captured_at >= p_start_of_day AND captured_at < p_end_of_day
        ORDER BY user_id, captured_at DESC
      ) pg
    ), '[]'::jsonb),

    'policy', COALESCE((
      SELECT jsonb_agg(to_jsonb(dt))
      FROM (
        SELECT user_id, min_calls, min_qualified_weekly
        FROM public.daily_targets
        WHERE effective_to IS NULL
      ) dt
    ), '[]'::jsonb),

    'fu', COALESCE((
      SELECT jsonb_agg(to_jsonb(f))
      FROM (
        SELECT assigned_to, is_done, follow_up_date, done_at, done_note
        FROM public.follow_ups
        WHERE (is_done = true  AND done_at >= p_start_of_day AND done_at < p_end_of_day)
           OR (is_done = false AND follow_up_date >= p_period_start AND follow_up_date < p_period_end)
      ) f
    ), '[]'::jsonb),

    -- 10) quote_sent  — M21: EMPTIED. Per-rep quote-chase now comes pre-aggregated
    --     in the `chase` arm (team_chase_counts). Was: jsonb_agg every status='sent'
    --     quote (O(all sent quotes)). Kept as '[]' so an old cached frontend that
    --     still reads b.quote_sent degrades cleanly (it uses team_chase_counts for
    --     the viewer regardless — chaseFromRpc → skips the arm consumer).
    'quote_sent', '[]'::jsonb,

    -- 11) quote_won   — M21: EMPTIED (was jsonb_agg every status='won' quote).
    'quote_won', '[]'::jsonb,

    -- 12) payments    — M21: EMPTIED (was jsonb_agg the WHOLE payments table,
    --     O(all payments) — the biggest download on this hot page).
    'payments', '[]'::jsonb,

    'overdue_fu', COALESCE((
      SELECT jsonb_agg(to_jsonb(o))
      FROM (
        SELECT f.assigned_to FROM public.follow_ups f
        LEFT JOIN public.leads l ON l.id = f.lead_id
        WHERE f.follow_up_date < p_today AND f.is_done = false
          AND COALESCE(l.stage, '') <> 'Lost'
          AND NOT COALESCE(l.stage = 'Nurture' AND COALESCE(f.cadence_type, '') <> 'nurture', false)
      ) o
    ), '[]'::jsonb),

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

    'qualified', COALESCE((
      SELECT jsonb_agg(to_jsonb(qa))
      FROM (
        SELECT created_by FROM public.lead_activities
        WHERE activity_type = 'call' AND outcome = 'positive'
          AND created_at >= p_start_of_day AND created_at < p_end_of_day
      ) qa
    ), '[]'::jsonb),

    'callbacks', COALESCE((
      SELECT jsonb_agg(to_jsonb(cb))
      FROM (
        SELECT assigned_to, lead_id, id FROM public.follow_ups
        WHERE is_done = false
          AND follow_up_date >= p_cb_floor AND follow_up_date <= p_today
      ) cb
    ), '[]'::jsonb),

    'month_quotes', COALESCE((
      SELECT jsonb_agg(to_jsonb(mq))
      FROM (
        SELECT created_by, total_amount FROM public.quotes
        WHERE created_at >= p_month_start AND created_at < p_month_end
      ) mq
    ), '[]'::jsonb),

    'month_won', COALESCE((
      SELECT jsonb_agg(to_jsonb(mw))
      FROM (
        SELECT created_by, total_amount FROM public.quotes
        WHERE status = 'won'
          AND updated_at >= p_month_start AND updated_at < p_month_end
      ) mw
    ), '[]'::jsonb),

    'push_subs', COALESCE((
      SELECT jsonb_agg(to_jsonb(ps))
      FROM (
        SELECT DISTINCT ON (user_id) user_id, last_seen_at
        FROM public.push_subscriptions
        ORDER BY user_id, last_seen_at DESC
      ) ps
    ), '[]'::jsonb),

    'gps_off', COALESCE((
      SELECT jsonb_agg(to_jsonb(go))
      FROM (
        SELECT user_id, toggled_off_at
        FROM public.gps_off_events
        WHERE toggled_on_at IS NULL
      ) go
    ), '[]'::jsonb),

    -- 21) chase  — M21 NEW: per-rep quote-chase + pay-chase, aggregated server-side.
    --     DELEGATES to team_chase_counts(p_period_end) so the chase logic has ONE
    --     definition (shared with the admin path — M17/H7). Both functions are
    --     SECURITY DEFINER; the inner gate (is_team_viewer() OR NULL OR admin)
    --     re-passes for the same caller the outer gate already validated. O(reps).
    'chase', COALESCE((
      SELECT jsonb_agg(to_jsonb(c))
      FROM public.team_chase_counts(p_period_end) c
    ), '[]'::jsonb)

  ) INTO v_out;

  RETURN v_out;
END $function$;

NOTIFY pgrst, 'reload schema';

-- VERIFY (expect t): the live function carries the import filter AND the M21 chase arm.
SELECT pg_get_functiondef(p.oid) LIKE '%import_id IS NULL%' AS has_import_filter,
       pg_get_functiondef(p.oid) LIKE '%chase%'           AS has_m21_chase_arm
FROM pg_proc p WHERE p.proname='team_dashboard_bundle' AND p.pronamespace='public'::regnamespace;
