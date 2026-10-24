-- ============================================================================
-- db/functions/ops_fault_report.sql - THE CANONICAL HOME (section 71) - Phase 502
-- Operations DAILY FAULT REPORT + TECHNICIAN SCORE. Read-only (STABLE), no pay anywhere.
--   ops_fault_block(user, day)           INTERNAL: one technician, one IST day, from ops_screen_faults
--   ops_fault_score(user, from, to)      INTERNAL: the technician score for a period
--   ops_my_fault_report(day)             a technician's OWN report (role operation_executive)
--   ops_head_fault_report(day)           everyone's report for admin / co_owner / operation_head
-- Spec: docs/superpowers/specs/2026-10-24-ops-fault-flow-design.md. Owner decisions 24 Oct:
--   both numbers shown (downtime from the first offline reading, response from In process);
--   only 07:00-21:00 IST minutes count (done inside ops_screen_faults.*_minutes);
--   score = REPORT ONLY, NO effect on pay (pay stays on screen uptime);
--   photo requests are NOT faults but their delivery counts in the score.
-- A technician owns the faults of the depots assigned to them (ops_depots.assigned_to).
-- SCORE (my call, weights changeable here only), over the 7 IST days ending the report day:
--   fixed / raised  40  (1.0 when nothing was raised)
--   response speed  25  (average In-process-to-fixed working minutes: <=120 full, >=480 zero, none = full)
--   no repeats      15  (share of faults that came back within 7 days of the last fix: fewer = better)
--   photos on time  20  (photo requests delivered within 48 h / asked, none asked = full)
-- Denied / no login / wrong role -> '{}'. Fail closed on NULL role (section 41).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ops_fault_score(p_user uuid, p_from timestamptz, p_to timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO public, pg_temp AS $fn$
DECLARE
  v_raised int; v_fixed int; v_resp numeric; v_rep int; v_total_rep int;
  v_pa int; v_pd int;
  s_fix numeric; s_speed numeric; s_rep numeric; s_photo numeric;
BEGIN
  SELECT count(*) FILTER (WHERE f.started_at >= p_from AND f.started_at < p_to),
         count(*) FILTER (WHERE f.status = 'fixed' AND f.fixed_at >= p_from AND f.fixed_at < p_to),
         avg(f.response_minutes) FILTER (WHERE f.status = 'fixed' AND f.fixed_at >= p_from AND f.fixed_at < p_to AND f.response_minutes IS NOT NULL)
    INTO v_raised, v_fixed, v_resp
    FROM public.ops_screen_faults f JOIN public.ops_depots d ON d.id = f.depot_id
   WHERE d.assigned_to = p_user AND f.kind IN ('offline','manual') AND f.status <> 'cancelled';

  SELECT count(*) FILTER (WHERE prev_fixed IS NOT NULL AND started_at - prev_fixed <= interval '7 days'), count(*)
    INTO v_rep, v_total_rep
    FROM (SELECT f.started_at, lag(f.fixed_at) OVER (PARTITION BY f.screen_id ORDER BY f.started_at) AS prev_fixed
            FROM public.ops_screen_faults f JOIN public.ops_depots d ON d.id = f.depot_id
           WHERE d.assigned_to = p_user AND f.kind IN ('offline','manual') AND f.status <> 'cancelled') x
   WHERE x.started_at >= p_from AND x.started_at < p_to;

  SELECT count(*) FILTER (WHERE t.opened_at >= p_from AND t.opened_at < p_to),
         count(*) FILTER (WHERE t.opened_at >= p_from AND t.opened_at < p_to AND t.status IN ('resolved','approved') AND t.resolved_at <= t.opened_at + interval '48 hours')
    INTO v_pa, v_pd
    FROM public.ops_tickets t WHERE t.type = 'photo_request' AND t.assigned_to = p_user AND t.status <> 'cancelled';

  s_fix   := CASE WHEN COALESCE(v_raised,0) = 0 THEN 40 ELSE 40 * LEAST(1, v_fixed::numeric / v_raised) END;
  s_speed := CASE WHEN v_resp IS NULL THEN 25 WHEN v_resp <= 120 THEN 25 WHEN v_resp >= 480 THEN 0 ELSE 25 * (480 - v_resp) / 360 END;
  s_rep   := CASE WHEN COALESCE(v_total_rep,0) = 0 THEN 15 ELSE 15 * (1 - v_rep::numeric / v_total_rep) END;
  s_photo := CASE WHEN COALESCE(v_pa,0) = 0 THEN 20 ELSE 20 * v_pd::numeric / v_pa END;
  RETURN jsonb_build_object('score', round(s_fix + s_speed + s_rep + s_photo),
    'parts', jsonb_build_object('fixed', round(s_fix), 'speed', round(s_speed), 'repeat', round(s_rep), 'photos', round(s_photo)),
    'raised', COALESCE(v_raised,0), 'fixed', COALESCE(v_fixed,0), 'avg_response_min', round(v_resp),
    'repeats', COALESCE(v_rep,0), 'photos_asked', COALESCE(v_pa,0), 'photos_on_time', COALESCE(v_pd,0));
END $fn$;

CREATE OR REPLACE FUNCTION public.ops_fault_block(p_user uuid, p_day date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO public, pg_temp AS $fn$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_day date := GREATEST(v_today - 7, LEAST(COALESCE(p_day, v_today), v_today));
  v_from timestamptz; v_to timestamptz;
  v_name text; v_off int; v_fix int; v_pend int; v_timer int; v_dt numeric; v_rs numeric;
  v_pa int; v_pd int; v_items jsonb;
BEGIN
  v_from := (v_day::timestamp AT TIME ZONE 'Asia/Kolkata');
  v_to   := ((v_day + 1)::timestamp AT TIME ZONE 'Asia/Kolkata');
  SELECT name INTO v_name FROM public.users WHERE id = p_user;

  SELECT count(*) FILTER (WHERE f.kind IN ('offline','manual') AND f.status <> 'cancelled' AND f.started_at >= v_from AND f.started_at < v_to),
         count(*) FILTER (WHERE f.kind IN ('offline','manual') AND f.status = 'fixed' AND f.fixed_at >= v_from AND f.fixed_at < v_to),
         count(*) FILTER (WHERE f.kind IN ('offline','manual') AND f.status = 'open'),
         count(*) FILTER (WHERE f.kind = 'timer' AND f.started_at >= v_from AND f.started_at < v_to),
         avg(f.downtime_minutes) FILTER (WHERE f.kind IN ('offline','manual') AND f.status = 'fixed' AND f.fixed_at >= v_from AND f.fixed_at < v_to),
         avg(f.response_minutes) FILTER (WHERE f.kind IN ('offline','manual') AND f.status = 'fixed' AND f.fixed_at >= v_from AND f.fixed_at < v_to)
    INTO v_off, v_fix, v_pend, v_timer, v_dt, v_rs
    FROM public.ops_screen_faults f JOIN public.ops_depots d ON d.id = f.depot_id WHERE d.assigned_to = p_user;

  SELECT count(*) FILTER (WHERE t.opened_at >= v_from AND t.opened_at < v_to),
         count(*) FILTER (WHERE t.status IN ('resolved','approved') AND t.resolved_at >= v_from AND t.resolved_at < v_to)
    INTO v_pa, v_pd FROM public.ops_tickets t WHERE t.type = 'photo_request' AND t.assigned_to = p_user AND t.status <> 'cancelled';

  SELECT COALESCE(jsonb_agg(i ORDER BY i->>'started'), '[]'::jsonb) INTO v_items FROM (
    SELECT jsonb_build_object('screen', s.name, 'station', d.name, 'kind', f.kind, 'status', f.status,
             'started', to_char(f.started_at AT TIME ZONE 'Asia/Kolkata', 'HH24:MI'),
             'fixed', to_char(f.fixed_at AT TIME ZONE 'Asia/Kolkata', 'HH24:MI'),
             'downtime_min', f.downtime_minutes, 'response_min', f.response_minutes) AS i
      FROM public.ops_screen_faults f JOIN public.ops_depots d ON d.id = f.depot_id JOIN public.ops_screens s ON s.id = f.screen_id
     WHERE d.assigned_to = p_user AND f.status <> 'cancelled' AND f.kind IN ('offline','manual')
       AND ((f.started_at >= v_from AND f.started_at < v_to) OR (f.fixed_at >= v_from AND f.fixed_at < v_to) OR f.status = 'open')
     ORDER BY f.started_at DESC LIMIT 30) q;

  RETURN jsonb_build_object('tech', jsonb_build_object('id', p_user, 'name', v_name),
    'went_off', COALESCE(v_off,0), 'fixed', COALESCE(v_fix,0), 'pending', COALESCE(v_pend,0), 'timer', COALESCE(v_timer,0),
    'avg_downtime_min', round(v_dt), 'avg_response_min', round(v_rs),
    'photos_asked', COALESCE(v_pa,0), 'photos_delivered', COALESCE(v_pd,0), 'items', v_items,
    'score', public.ops_fault_score(p_user, v_from - interval '6 days', v_to));
END $fn$;

CREATE OR REPLACE FUNCTION public.ops_my_fault_report(p_day date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO public, pg_temp AS $fn$
DECLARE v_role text; v_day date := GREATEST((now() AT TIME ZONE 'Asia/Kolkata')::date - 7, LEAST(COALESCE(p_day, (now() AT TIME ZONE 'Asia/Kolkata')::date), (now() AT TIME ZONE 'Asia/Kolkata')::date));
BEGIN
  SELECT role INTO v_role FROM public.users WHERE id = auth.uid() AND is_active;
  IF auth.uid() IS NULL OR v_role IS NULL OR v_role <> 'operation_executive' THEN RETURN '{}'::jsonb; END IF;
  RETURN jsonb_build_object('ok', true, 'day', v_day, 'as_of', to_char(now() AT TIME ZONE 'Asia/Kolkata', 'HH24:MI'), 'is_today', v_day = (now() AT TIME ZONE 'Asia/Kolkata')::date)
         || public.ops_fault_block(auth.uid(), v_day);
END $fn$;

CREATE OR REPLACE FUNCTION public.ops_head_fault_report(p_day date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO public, pg_temp AS $fn$
DECLARE v_role text; v_day date := GREATEST((now() AT TIME ZONE 'Asia/Kolkata')::date - 7, LEAST(COALESCE(p_day, (now() AT TIME ZONE 'Asia/Kolkata')::date), (now() AT TIME ZONE 'Asia/Kolkata')::date)); v_techs jsonb;
BEGIN
  SELECT role INTO v_role FROM public.users WHERE id = auth.uid() AND is_active;
  IF auth.uid() IS NULL OR v_role IS NULL OR v_role NOT IN ('admin','co_owner','operation_head') THEN RETURN '{}'::jsonb; END IF;
  SELECT COALESCE(jsonb_agg(public.ops_fault_block(u.id, v_day) ORDER BY u.name), '[]'::jsonb) INTO v_techs
    FROM public.users u WHERE u.role = 'operation_executive' AND u.is_active;
  RETURN jsonb_build_object('ok', true, 'day', v_day, 'as_of', to_char(now() AT TIME ZONE 'Asia/Kolkata', 'HH24:MI'),
    'is_today', v_day = (now() AT TIME ZONE 'Asia/Kolkata')::date, 'techs', v_techs,
    'totals', jsonb_build_object(
      'went_off', (SELECT COALESCE(sum((t->>'went_off')::int),0) FROM jsonb_array_elements(v_techs) t),
      'fixed',    (SELECT COALESCE(sum((t->>'fixed')::int),0)    FROM jsonb_array_elements(v_techs) t),
      'pending',  (SELECT COALESCE(sum((t->>'pending')::int),0)  FROM jsonb_array_elements(v_techs) t),
      'timer',    (SELECT COALESCE(sum((t->>'timer')::int),0)    FROM jsonb_array_elements(v_techs) t)));
END $fn$;

REVOKE ALL ON FUNCTION public.ops_fault_score(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_fault_block(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_fault_score(uuid, timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.ops_fault_block(uuid, date) TO service_role;
REVOKE ALL ON FUNCTION public.ops_my_fault_report(date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_head_fault_report(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ops_my_fault_report(date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ops_head_fault_report(date) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';

-- VERIFY (read-only): helpers locked, reports callable by authenticated only
-- SELECT has_function_privilege('authenticated','public.ops_fault_block(uuid,date)','EXECUTE') AS block_open_should_be_false,
--        has_function_privilege('anon','public.ops_head_fault_report(date)','EXECUTE') AS anon_should_be_false,
--        has_function_privilege('authenticated','public.ops_head_fault_report(date)','EXECUTE') AS auth_should_be_true;
