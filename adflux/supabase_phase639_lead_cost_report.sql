-- =============================================================================
-- Phase 639 · Cost per lead report (2026-11-21, owner-approved)
--
-- ONE read-only function: lead_cost_report(p_month date, p_user uuid).
-- Per sales / telecaller person, for one IST month:
--   salary cost  = monthly_salary / 26 x days worked (capped at the monthly salary)
--   real hours   = clock-in -> last real action that day (call / activity / GPS ping),
--                  never the 8 PM auto clock-out
--   calling cost = talk minutes x (salary cost / real minutes)   [telecaller: whole salary]
--   meeting cost = rest of the salary cost + travel (daily_ta, not rejected)
--   per meeting  = meeting cost / done meetings (section 33 exclusions, 1 per lead per day)
--   per lead     = total cost / leads worked (real call or done meeting)
--   won          = quotes won in the month (won_at, else updated_at), value = subtotal (excl GST)
--
-- Access: admin = everyone; any other caller gets ONLY their own row (p_user forced
-- to auth.uid()). co_owner is govt-scoped (section 42) so it gets only its own row too.
-- No table, no trigger, no change to any existing object. Safe to re-run.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.lead_cost_report(p_month date, p_user uuid DEFAULT NULL)
RETURNS TABLE (
  user_id uuid, name text, role text,
  days int, work_min numeric, talk_min numeric,
  tapped_calls int, real_calls int, meetings int, leads_touched int,
  km numeric, travel numeric,
  salary_month numeric, salary_cost numeric,
  call_cost numeric, meeting_cost numeric, total_cost numeric,
  cost_per_call numeric, cost_per_meeting numeric, cost_per_lead numeric,
  won_count int, won_value numeric, no_meetings boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_role text := public.get_my_role();
  v_uid  uuid := auth.uid();
  v_d0   date := date_trunc('month', p_month)::date;
  v_d1   date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_s    timestamptz := v_d0::timestamp AT TIME ZONE 'Asia/Kolkata';
  v_e    timestamptz := v_d1::timestamp AT TIME ZONE 'Asia/Kolkata';
BEGIN
  IF v_uid IS NULL OR v_role IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  IF v_role <> 'admin' THEN
    p_user := v_uid;   -- everyone except admin sees only themselves
  END IF;

  RETURN QUERY
  WITH ppl AS (
    SELECT u.id, u.name, u.role FROM users u
    WHERE u.role IN ('sales', 'telecaller') AND (p_user IS NULL OR u.id = p_user)
  ),
  ws AS (
    SELECT w.user_id, w.work_date, w.check_in_at, w.check_out_at FROM work_sessions w
    JOIN ppl ON ppl.id = w.user_id
    WHERE w.work_date >= v_d0 AND w.work_date < v_d1 AND w.check_in_at IS NOT NULL
  ),
  evt AS (
    SELECT a.created_by AS uid, a.created_at AS t FROM lead_activities a JOIN ppl ON ppl.id = a.created_by
      WHERE a.created_at >= v_s AND a.created_at < v_e
    UNION ALL
    SELECT c.user_id, c.call_at + make_interval(secs => coalesce(c.duration_seconds, 0)) FROM call_logs c JOIN ppl ON ppl.id = c.user_id
      WHERE c.call_at >= v_s AND c.call_at < v_e
    UNION ALL
    SELECT g.user_id, g.captured_at FROM gps_pings g JOIN ppl ON ppl.id = g.user_id
      WHERE g.captured_at >= v_s AND g.captured_at < v_e
  ),
  lastd AS (
    SELECT uid, (t AT TIME ZONE 'Asia/Kolkata')::date AS dt, max(t) AS t FROM evt GROUP BY 1, 2
  ),
  hrs AS (
    SELECT ws.user_id, count(*)::int AS days,
      sum(greatest(0, extract(epoch FROM (
        least(coalesce(l.t, ws.check_out_at), coalesce(ws.check_out_at, l.t)) - ws.check_in_at)) / 60.0)) AS work_min
    FROM ws LEFT JOIN lastd l ON l.uid = ws.user_id AND l.dt = ws.work_date
    GROUP BY 1
  ),
  done_meet AS (   -- section 33 done-meeting rule: COALESCE(lead_id, id), one per lead per IST day; walk-ins each count
    SELECT DISTINCT a.created_by AS uid, a.lead_id, coalesce(a.lead_id, a.id) AS mkey,
           (a.created_at AT TIME ZONE 'Asia/Kolkata')::date AS dt
    FROM lead_activities a JOIN ppl ON ppl.id = a.created_by
    WHERE a.created_at >= v_s AND a.created_at < v_e
      AND a.activity_type IN ('meeting', 'site_visit')
      AND coalesce(a.notes, '') NOT LIKE 'Meeting scheduled%'
      AND coalesce(a.notes, '') NOT LIKE 'I''m here · auto-check-in%'
  ),
  real_call AS (
    SELECT c.user_id AS uid, c.lead_id, c.duration_seconds FROM call_logs c JOIN ppl ON ppl.id = c.user_id
    WHERE c.call_at >= v_s AND c.call_at < v_e
      AND c.duration_seconds >= 10 AND coalesce(c.direction, '') <> 'missed'
  ),
  calls AS (
    SELECT c.user_id AS uid, count(*)::int AS tapped FROM call_logs c JOIN ppl ON ppl.id = c.user_id
    WHERE c.call_at >= v_s AND c.call_at < v_e GROUP BY 1
  ),
  rc AS (SELECT uid, count(*)::int AS n, sum(duration_seconds) / 60.0 AS talk FROM real_call GROUP BY 1),
  dm AS (SELECT uid, count(DISTINCT (mkey, dt))::int AS n FROM done_meet GROUP BY 1),
  lt AS (
    SELECT uid, count(DISTINCT lead_id)::int AS n FROM (
      SELECT uid, lead_id FROM real_call WHERE lead_id IS NOT NULL
      UNION SELECT uid, lead_id FROM done_meet WHERE lead_id IS NOT NULL
    ) x GROUP BY 1
  ),
  ta AS (
    SELECT t.user_id, sum(t.km_traveled) AS km, sum(t.total_amount) AS amt FROM daily_ta t JOIN ppl ON ppl.id = t.user_id
    WHERE t.ta_date >= v_d0 AND t.ta_date < v_d1 AND coalesce(t.status, '') <> 'rejected' GROUP BY 1
  ),
  won AS (
    SELECT q.created_by AS uid, count(*)::int AS n, sum(q.subtotal) AS amt FROM quotes q JOIN ppl ON ppl.id = q.created_by
    WHERE q.status = 'won' AND coalesce(q.won_at, q.updated_at) >= v_s AND coalesce(q.won_at, q.updated_at) < v_e
    GROUP BY 1
  ),
  base AS (
    SELECT ppl.id, ppl.name, ppl.role, h.days, h.work_min,
      coalesce(rc.talk, 0) AS talk, coalesce(calls.tapped, 0) AS tapped, coalesce(rc.n, 0) AS rcalls,
      coalesce(dm.n, 0) AS meets, coalesce(lt.n, 0) AS leads,
      coalesce(ta.km, 0) AS km, coalesce(ta.amt, 0) AS travel,
      coalesce(s.monthly_salary, 0) AS sal_m,
      least(coalesce(s.monthly_salary, 0), coalesce(s.monthly_salary, 0) / 26.0 * h.days) AS sal_c,
      coalesce(won.n, 0) AS won_n, coalesce(won.amt, 0) AS won_amt
    FROM ppl
    JOIN hrs h ON h.user_id = ppl.id
    LEFT JOIN staff_incentive_profiles s ON s.user_id = ppl.id
    LEFT JOIN rc ON rc.uid = ppl.id
    LEFT JOIN calls ON calls.uid = ppl.id
    LEFT JOIN dm ON dm.uid = ppl.id
    LEFT JOIN lt ON lt.uid = ppl.id
    LEFT JOIN ta ON ta.user_id = ppl.id
    LEFT JOIN won ON won.uid = ppl.id
  ),
  cost AS (
    SELECT b.*,
      CASE WHEN b.role = 'telecaller' THEN b.sal_c
           WHEN b.work_min > 0 THEN least(b.sal_c, b.talk * b.sal_c / b.work_min)
           ELSE 0 END AS c_call
    FROM base b
  )
  SELECT c.id, c.name, c.role, c.days, round(c.work_min), round(c.talk),
    c.tapped, c.rcalls, c.meets, c.leads,
    round(c.km), round(c.travel),
    round(c.sal_m), round(c.sal_c),
    round(c.c_call), round(c.sal_c - c.c_call + c.travel), round(c.sal_c + c.travel),
    round(c.c_call / nullif(c.rcalls, 0), 1),
    round((c.sal_c - c.c_call + c.travel) / nullif(c.meets, 0)),
    round((c.sal_c + c.travel) / nullif(c.leads, 0), 1),
    c.won_n, round(c.won_amt),
    (c.role = 'sales' AND c.meets = 0)
  FROM cost c
  ORDER BY c.role, c.name;
END $$;

REVOKE ALL ON FUNCTION public.lead_cost_report(date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lead_cost_report(date, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY:
-- SELECT proname, prosecdef FROM pg_proc WHERE proname = 'lead_cost_report';   -- 1 row, prosecdef = true
-- Run as admin in the app: October 2026 returns ~12 rows (sales + telecallers with work days).
