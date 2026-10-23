-- Phase 474: accounts (Diya) can see a rep's whole day (meetings, calls, route) when she opens a TA/DA row.
-- Her own RLS only reads gps_pings + daily_ta, so meetings/calls/session came back empty (section 275 known gap).
-- Fix = ONE gated read-only SECURITY DEFINER RPC (the section 84/193 pattern), NOT broad RLS. Only the gate changed
-- (admin -> admin + accounts) from the live function; everything else byte-identical. SUPERSEDES the copy in
-- supabase_phase194_team_drilldowns.sql. UNDO: re-run that file's team_rep_daytrack block.
CREATE OR REPLACE FUNCTION public.team_rep_daytrack(p_user_id uuid, p_start timestamp with time zone, p_end timestamp with time zone, p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_out jsonb;
BEGIN
  IF NOT (public.is_team_viewer()
          OR COALESCE(public.get_my_role() IN ('admin','accounts'), false)) THEN   -- admin + accounts (Phase 474: Diya verifies TA km + meetings); NOT co_owner (Vishal is govt-scoped, §42)
    RETURN '{}'::jsonb;
  END IF;

  SELECT jsonb_build_object(
    'user', (SELECT to_jsonb(u) FROM (
      SELECT id, name, role, team_role, city FROM public.users WHERE id = p_user_id
    ) u),
    'pings', COALESCE((SELECT jsonb_agg(to_jsonb(pg) ORDER BY pg.captured_at ASC) FROM (
      SELECT id, captured_at, lat, lng, accuracy_m, source
      FROM public.gps_pings
      WHERE user_id = p_user_id AND captured_at >= p_start AND captured_at <= p_end
    ) pg), '[]'::jsonb),
    'session', (SELECT to_jsonb(ws) FROM (
      SELECT check_in_at, check_out_at, daily_counters, planned_meetings,
             morning_plan_text, evening_summary
      FROM public.work_sessions
      WHERE user_id = p_user_id AND work_date = p_date
      LIMIT 1
    ) ws),
    'activities', COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC) FROM (
      SELECT la.id, la.created_at, la.activity_type, la.outcome, la.notes,
             la.next_action, la.gps_lat, la.gps_lng,
             (SELECT jsonb_build_object('id', l.id, 'name', l.name, 'company', l.company)
                FROM public.leads l WHERE l.id = la.lead_id) AS lead
      FROM public.lead_activities la
      WHERE la.created_by = p_user_id AND la.created_at >= p_start AND la.created_at <= p_end
      ORDER BY la.created_at DESC LIMIT 50
    ) a), '[]'::jsonb),
    'voice', COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.created_at DESC) FROM (
      SELECT vl.id, vl.created_at, vl.transcript, vl.language_detected, vl.status, vl.classified,
             (SELECT jsonb_build_object('id', l.id, 'name', l.name, 'company', l.company)
                FROM public.leads l WHERE l.id = vl.lead_id) AS lead
      FROM public.voice_logs vl
      WHERE vl.user_id = p_user_id AND vl.created_at >= p_start AND vl.created_at <= p_end
      ORDER BY vl.created_at DESC LIMIT 20
    ) v), '[]'::jsonb),
    'gps_off', COALESCE((SELECT jsonb_agg(to_jsonb(go) ORDER BY go.toggled_off_at DESC) FROM (
      SELECT id, toggled_off_at, toggled_on_at, duration_seconds, source
      FROM public.gps_off_events
      WHERE user_id = p_user_id AND toggled_off_at >= p_start AND toggled_off_at <= p_end
    ) go), '[]'::jsonb),
    'calls', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.call_at DESC) FROM (
      SELECT cl.id, cl.call_at, cl.duration_seconds, cl.outcome, cl.direction,
             cl.client_phone, cl.notes,
             (SELECT jsonb_build_object('id', l.id, 'name', l.name, 'company', l.company)
                FROM public.leads l WHERE l.id = cl.lead_id) AS lead
      FROM public.call_logs cl
      WHERE cl.user_id = p_user_id AND cl.call_at >= p_start AND cl.call_at <= p_end
      ORDER BY cl.call_at DESC LIMIT 2000
    ) c), '[]'::jsonb),
    'ta_km', (SELECT km_traveled FROM public.daily_ta
              WHERE user_id = p_user_id AND ta_date = p_date LIMIT 1)
  ) INTO v_out;

  RETURN v_out;
END $function$;

REVOKE ALL ON FUNCTION public.team_rep_daytrack(uuid, timestamptz, timestamptz, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_rep_daytrack(uuid, timestamptz, timestamptz, date) TO authenticated, service_role;
SELECT pg_get_functiondef('public.team_rep_daytrack(uuid,timestamptz,timestamptz,date)'::regprocedure) LIKE '%''admin'',''accounts''%' AS gate_has_accounts,
       has_function_privilege('anon','public.team_rep_daytrack(uuid,timestamptz,timestamptz,date)','EXECUTE') AS anon_can_run_should_be_false;
