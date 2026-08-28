-- ============================================================================
-- supabase_ops_p7_tech_detail.sql — Operations command-center per-tech drill-down
-- (owner "manage 10 techs" brainstorm, 2026-08-28). ONE server-side bundle RPC
-- behind the command-center scorecard: tap a tech → their stations + faults +
-- uptime + calls + attendance. Read-only, gated admin/co_owner/operation_head,
-- fail-closed on NULL role. Additive (a NEW function, single home from birth §71).
--
-- Also re-run supabase_ops_p6_admin_cockpit.sql (its leaderboard now carries
-- 'user_id' + 'on_duty' so the scorecard rows are tappable). Owner runs both.
--
-- Idempotent (CREATE OR REPLACE). §66 server-side aggregation. Brand: no UI.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ops_tech_detail(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role   text := public.get_my_role();
  v_today  date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_mstart date := date_trunc('month', v_today)::date;
  v_name   text;
BEGIN
  -- fail-closed: only the ops managers may drill in
  IF v_role IS NULL OR v_role NOT IN ('admin', 'co_owner', 'operation_head') THEN
    RETURN '{}'::jsonb;
  END IF;

  -- the target must be a live field tech (never leak an arbitrary user)
  SELECT u.name INTO v_name
    FROM public.users u
   WHERE u.id = p_user_id AND u.role = 'operation_executive' AND u.is_active;
  IF v_name IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'name', v_name,
    'uptime_pct', COALESCE((SELECT round(avg(uptime_pct), 1) FROM public.ops_uptime_daily o
                             WHERE o.user_id = p_user_id AND o.work_date >= v_mstart AND o.screens_total > 0), 0),
    'on_duty', EXISTS (SELECT 1 FROM public.work_sessions ws WHERE ws.user_id = p_user_id
                        AND ws.work_date = v_today AND ws.check_in_at IS NOT NULL
                        AND ws.check_out_at IS NULL AND COALESCE(ws.auto_checked_out, false) = false),
    'checked_in_today', EXISTS (SELECT 1 FROM public.work_sessions ws WHERE ws.user_id = p_user_id
                        AND ws.work_date = v_today AND ws.check_in_at IS NOT NULL),
    'open_tickets', (SELECT count(*) FROM public.ops_tickets t
                      WHERE t.assigned_to = p_user_id AND t.status IN ('open', 'in_progress')),
    'fixed_month', (SELECT count(*) FROM public.ops_tickets t
                     WHERE t.assigned_to = p_user_id AND t.status = 'resolved' AND t.resolved_at >= v_mstart),
    'avg_fix_hours', COALESCE((SELECT round(avg(extract(epoch FROM (t.resolved_at - t.opened_at)) / 3600), 1)
                                FROM public.ops_tickets t
                               WHERE t.assigned_to = p_user_id AND t.status = 'resolved' AND t.resolved_at >= v_mstart), 0),
    'km_month', COALESCE((SELECT round(sum(km_traveled), 1) FROM public.daily_ta ta
                           WHERE ta.user_id = p_user_id AND ta.ta_date >= v_mstart), 0),
    'calls_today', (SELECT count(*) FROM public.call_logs c
                     WHERE c.user_id = p_user_id AND (c.call_at AT TIME ZONE 'Asia/Kolkata')::date = v_today),
    'calls_month', (SELECT count(*) FROM public.call_logs c
                     WHERE c.user_id = p_user_id AND c.call_at >= (v_mstart::timestamp AT TIME ZONE 'Asia/Kolkata')),
    'stations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', s.id, 'name', s.name, 'total', s.total, 'offline', s.offline, 'camera_off', s.camoff
             ) ORDER BY s.offline DESC, s.name)
      FROM (
        SELECT d.id, d.name,
               count(sc.id)                                          AS total,
               count(sc.id) FILTER (WHERE sc.status = 'offline')     AS offline,
               count(sc.id) FILTER (WHERE sc.camera_active = false)  AS camoff
          FROM public.ops_depots d
          LEFT JOIN public.ops_screens sc ON sc.depot_id = d.id AND sc.is_active
         WHERE d.assigned_to = p_user_id AND d.is_active
         GROUP BY d.id, d.name
      ) s
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL     ON FUNCTION public.ops_tech_detail(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.ops_tech_detail(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY:
-- SELECT to_regprocedure('public.ops_tech_detail(uuid)') IS NOT NULL AS fn,
--        (SELECT prosecdef FROM pg_proc WHERE proname='ops_tech_detail') AS is_definer;
-- -- as the head, with a real exec id:
-- SELECT public.ops_tech_detail('<operation_executive user id>');
-- ============================================================================
