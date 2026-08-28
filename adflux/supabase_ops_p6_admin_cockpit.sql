-- ============================================================================
-- supabase_ops_p6_admin_cockpit.sql — Operations module Phase 6 (§230/§233).
-- ============================================================================
-- One server-side aggregation RPC feeding the admin owner cockpit (/ops-admin):
-- uptime health + trend, per-tech leaderboard, ticket flow, and (ADMIN ONLY)
-- payroll. Gated admin/co_owner/operation_head, fail-closed NULL. All reads
-- (no writes) over ops_* + daily_ta + work_sessions + staff_incentive_profiles.
-- Server-side aggregation (§66 — never pull-and-count). Additive.
--
-- §153: the `payroll` field is populated ONLY for role='admin'. co_owner
-- (Vishal, government_partner) must NOT see org-wide ops payroll.
--
-- Idempotent (CREATE OR REPLACE). Owner runs it.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ops_admin_cockpit(p_days int DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role     text    := public.get_my_role();
  v_is_admin boolean := (v_role = 'admin');
  v_today    date    := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_mstart   date    := date_trunc('month', v_today)::date;
  v_since    date    := v_today - GREATEST(COALESCE(p_days, 30), 1);
  v_total int; v_online int; v_offline int;
  v_open int; v_faults int; v_fix numeric; v_photo int; v_photo_hrs numeric;
  v_techs int; v_onduty int; v_up_month numeric;
  v_result jsonb;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin', 'co_owner', 'operation_head') THEN
    RETURN '{}'::jsonb;
  END IF;

  SELECT count(*), count(*) FILTER (WHERE status = 'online'), count(*) FILTER (WHERE status = 'offline')
    INTO v_total, v_online, v_offline
    FROM public.ops_screens WHERE is_active;

  SELECT round(avg(uptime_pct), 1) INTO v_up_month
    FROM public.ops_uptime_daily WHERE work_date >= v_mstart AND screens_total > 0;

  SELECT count(*) FILTER (WHERE status IN ('open', 'in_progress')),
         count(*) FILTER (WHERE type = 'fault' AND created_at >= v_mstart),
         round(avg(extract(epoch FROM (resolved_at - opened_at)) / 3600)
               FILTER (WHERE type = 'fault' AND status = 'resolved' AND resolved_at >= v_mstart), 1),
         count(*) FILTER (WHERE type = 'photo_request' AND status = 'resolved' AND resolved_at >= v_mstart),
         round(avg(extract(epoch FROM (resolved_at - opened_at)) / 3600)
               FILTER (WHERE type = 'photo_request' AND status = 'resolved' AND resolved_at >= v_mstart), 1)
    INTO v_open, v_faults, v_fix, v_photo, v_photo_hrs
    FROM public.ops_tickets;

  SELECT count(*) INTO v_techs FROM public.users WHERE role = 'operation_executive' AND is_active;
  SELECT count(*) INTO v_onduty
    FROM public.work_sessions ws
    JOIN public.users u ON u.id = ws.user_id AND u.role = 'operation_executive'
   WHERE ws.work_date = v_today AND ws.check_in_at IS NOT NULL
     AND ws.check_out_at IS NULL AND COALESCE(ws.auto_checked_out, false) = false;

  v_result := jsonb_build_object(
    'uptime_today', CASE WHEN (v_online + v_offline) > 0 THEN round(v_online::numeric / (v_online + v_offline) * 100, 1) ELSE 0 END,
    'uptime_month', COALESCE(v_up_month, 0),
    'screens', jsonb_build_object('total', v_total, 'online', v_online, 'offline', v_offline, 'unknown', v_total - v_online - v_offline),
    'tickets', jsonb_build_object('open', v_open, 'faults_month', v_faults, 'avg_fix_hours', COALESCE(v_fix, 0), 'photo_month', v_photo, 'avg_photo_hours', COALESCE(v_photo_hrs, 0)),
    'techs', jsonb_build_object('total', v_techs, 'on_duty', v_onduty),
    'uptime_trend', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('day', d.work_date, 'pct', d.pct) ORDER BY d.work_date)
      FROM (SELECT work_date, round(avg(uptime_pct), 1) AS pct
              FROM public.ops_uptime_daily
             WHERE work_date >= v_since AND screens_total > 0
             GROUP BY work_date) d
    ), '[]'::jsonb),
    'leaderboard', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', u.id,
        'name', u.name,
        'uptime_pct', COALESCE((SELECT round(avg(uptime_pct), 1) FROM public.ops_uptime_daily o WHERE o.user_id = u.id AND o.work_date >= v_mstart AND o.screens_total > 0), 0),
        'tickets_closed', (SELECT count(*) FROM public.ops_tickets t WHERE t.assigned_to = u.id AND t.status = 'resolved' AND t.resolved_at >= v_mstart),
        'avg_fix_hours', COALESCE((SELECT round(avg(extract(epoch FROM (t.resolved_at - t.opened_at)) / 3600), 1) FROM public.ops_tickets t WHERE t.assigned_to = u.id AND t.status = 'resolved' AND t.resolved_at >= v_mstart), 0),
        'km', COALESCE((SELECT round(sum(km_traveled), 1) FROM public.daily_ta ta WHERE ta.user_id = u.id AND ta.ta_date >= v_mstart), 0),
        'attendance', (SELECT count(*) FROM public.work_sessions ws WHERE ws.user_id = u.id AND ws.work_date >= v_mstart AND ws.check_in_at IS NOT NULL),
        'on_duty', EXISTS (SELECT 1 FROM public.work_sessions ws WHERE ws.user_id = u.id AND ws.work_date = v_today AND ws.check_in_at IS NOT NULL AND ws.check_out_at IS NULL AND COALESCE(ws.auto_checked_out, false) = false)
      ) ORDER BY u.name)
      FROM public.users u WHERE u.role = 'operation_executive' AND u.is_active
    ), '[]'::jsonb),
    'worst_stations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', w.name, 'screens', w.total, 'offline', w.offline) ORDER BY w.offline DESC, w.name)
      FROM (SELECT d.name,
                   count(s.id) AS total,
                   count(s.id) FILTER (WHERE s.status = 'offline') AS offline
              FROM public.ops_depots d
              JOIN public.ops_screens s ON s.depot_id = d.id AND s.is_active
             WHERE d.is_active
             GROUP BY d.name
            HAVING count(s.id) FILTER (WHERE s.status = 'offline') > 0
             ORDER BY offline DESC
             LIMIT 8) w
    ), '[]'::jsonb)
  );

  -- Money (payroll) — ADMIN ONLY (§153).
  IF v_is_admin THEN
    v_result := v_result || jsonb_build_object('payroll', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', u.name,
        'salary', COALESCE((SELECT monthly_salary FROM public.staff_incentive_profiles sip WHERE sip.user_id = u.id), 0),
        'uptime_pct', COALESCE((SELECT round(avg(uptime_pct), 1) FROM public.ops_uptime_daily o WHERE o.user_id = u.id AND o.work_date >= v_mstart AND o.screens_total > 0), 0)
      ) ORDER BY u.name)
      FROM public.users u WHERE u.role = 'operation_executive' AND u.is_active
    ), '[]'::jsonb));
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL     ON FUNCTION public.ops_admin_cockpit(int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.ops_admin_cockpit(int) TO authenticated;

-- ── the field tech's OWN uptime → pay (self-scoped; for the /ops "your pay" card) ──
CREATE OR REPLACE FUNCTION public.ops_my_uptime_pay()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    uuid    := auth.uid();
  v_mstart date    := date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata')::date)::date;
  v_up     numeric;
  v_sal    numeric;
BEGIN
  IF v_uid IS NULL THEN RETURN '{}'::jsonb; END IF;
  SELECT round(avg(uptime_pct), 1) INTO v_up
    FROM public.ops_uptime_daily WHERE user_id = v_uid AND work_date >= v_mstart AND screens_total > 0;
  SELECT monthly_salary INTO v_sal
    FROM public.staff_incentive_profiles WHERE user_id = v_uid;
  RETURN jsonb_build_object('uptime_pct', COALESCE(v_up, 0), 'salary', COALESCE(v_sal, 0), 'has_data', v_up IS NOT NULL);
END;
$$;
REVOKE ALL     ON FUNCTION public.ops_my_uptime_pay() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.ops_my_uptime_pay() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY:
-- SELECT to_regprocedure('public.ops_admin_cockpit(int)') IS NOT NULL AS fn,
--        (SELECT prosecdef FROM pg_proc WHERE proname='ops_admin_cockpit') AS is_definer;
-- SELECT public.ops_admin_cockpit(30);   -- as admin: full payload incl. payroll
-- ============================================================================
