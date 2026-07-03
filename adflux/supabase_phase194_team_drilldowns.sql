-- ============================================================================
-- Phase 194 — team-viewer drill-downs: rep day-track + rep follow-ups (gated)
-- ============================================================================
-- Phase 193 gave the per-user viewer (can_view_team_dashboard) the real
-- /team-dashboard via a gated bundle RPC. From there she clicks a rep to open
-- their ROUTE ACTIVITY (/admin/gps/:userId) and their FOLLOW-UPS
-- (/follow-ups?rep=:id) — both admin drill-downs. Her own RLS is own-only, so
-- those pages returned nothing for another rep. These two SECURITY DEFINER RPCs
-- return exactly what each page loads for one rep, gated on is_team_viewer() OR
-- admin/co_owner (fail-closed on NULL role). READ-ONLY — no writes; she monitors,
-- she cannot act on another rep's rows (RLS still blocks any write she attempts).
--
-- Same MIRROR discipline as Phase 193: the sub-selects below match the two
-- pages' loaders (GpsTrackV2 lines ~195-329, FollowUpsV2 lines ~104-153)
-- column-for-column. Change a page query → update the matching branch here.
-- Idempotent + re-runnable-safe (§8/§71). No broad RLS.
-- ============================================================================

-- ---- 1) rep day-track bundle (GpsTrackV2) ----------------------------------
CREATE OR REPLACE FUNCTION public.team_rep_daytrack(
  p_user_id uuid,
  p_start   timestamptz,
  p_end     timestamptz,
  p_date    date
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_out jsonb;
BEGIN
  IF NOT (public.is_team_viewer()
          OR COALESCE(public.get_my_role() IN ('admin', 'co_owner'), false)) THEN
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

GRANT EXECUTE ON FUNCTION public.team_rep_daytrack(uuid, timestamptz, timestamptz, date)
  TO authenticated;

-- ---- 2) rep follow-ups + nurture leads (FollowUpsV2) -----------------------
CREATE OR REPLACE FUNCTION public.team_rep_followups(p_rep_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_out    jsonb;
  v_week_end date := ((now() AT TIME ZONE 'Asia/Kolkata')::date + 7);
BEGIN
  IF NOT (public.is_team_viewer()
          OR COALESCE(public.get_my_role() IN ('admin', 'co_owner'), false)) THEN
    RETURN '{}'::jsonb;
  END IF;

  SELECT jsonb_build_object(
    'follow_ups', COALESCE((SELECT jsonb_agg(to_jsonb(f)) FROM (
      SELECT fu.id, fu.follow_up_date, fu.follow_up_time, fu.note, fu.is_done,
             fu.auto_generated, fu.cadence_type, fu.sequence, fu.quote_id, fu.lead_id,
             (SELECT jsonb_build_object(
                'id', q.id, 'client_name', q.client_name, 'client_company', q.client_company,
                'client_phone', q.client_phone, 'segment', q.segment,
                'total_amount', q.total_amount, 'status', q.status,
                'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                    'amount_received', p.amount_received, 'approval_status', p.approval_status))
                  FROM public.payments p WHERE p.quote_id = q.id), '[]'::jsonb))
              FROM public.quotes q WHERE q.id = fu.quote_id) AS quote,
             (SELECT jsonb_build_object('id', l.id, 'name', l.name, 'company', l.company,
                'phone', l.phone, 'segment', l.segment, 'stage', l.stage)
              FROM public.leads l WHERE l.id = fu.lead_id) AS lead
      FROM public.follow_ups fu
      WHERE fu.assigned_to = p_rep_id AND fu.is_done = false
      ORDER BY fu.follow_up_date ASC, fu.follow_up_time ASC NULLS LAST
    ) f), '[]'::jsonb),
    'nurture_leads', COALESCE((SELECT jsonb_agg(to_jsonb(n)) FROM (
      SELECT id, name, company, phone, email, stage, revisit_date, segment, assigned_to
      FROM public.leads
      WHERE assigned_to = p_rep_id AND stage = 'Nurture'
        AND revisit_date IS NOT NULL AND revisit_date <= v_week_end
      ORDER BY revisit_date ASC LIMIT 50
    ) n), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END $function$;

GRANT EXECUTE ON FUNCTION public.team_rep_followups(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY
-- ============================================================================
-- SELECT to_regprocedure('public.team_rep_daytrack(uuid,timestamptz,timestamptz,date)') IS NOT NULL;  -- t
-- SELECT to_regprocedure('public.team_rep_followups(uuid)') IS NOT NULL;                               -- t
-- As a plain rep (no flag): both return '{}'. As admin/viewer: real payload.
