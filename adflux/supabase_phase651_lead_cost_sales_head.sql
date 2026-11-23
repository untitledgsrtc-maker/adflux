-- =============================================================================
-- Phase 651 · Cost column for the sales head (2026-11-23, owner-approved)
--
-- Supersedes the function body in supabase_phase640_lead_cost_per_lead.sql.
-- lead_cost_for: admin unchanged (everyone's cost). An active sales head
-- (is_sales_manager) now gets a cost too, built ONLY from his own reps'
-- calls / meetings / salary / travel (users.manager_id = him); never his own,
-- never other teams. Everyone else still gets zero rows. Safe to re-run.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.lead_cost_for(p_lead_ids uuid[])
RETURNS TABLE (lead_id uuid, cost numeric, touch_days int)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_role text := public.get_my_role();
  v_team boolean := false;   -- Phase 651: sales head = only his reps' touches
BEGIN
  IF auth.uid() IS NULL OR v_role IS NULL THEN RETURN; END IF;
  IF v_role <> 'admin' THEN
    IF NOT public.is_sales_manager() THEN RETURN; END IF;   -- everyone else sees nothing
    v_team := true;
  END IF;
  IF p_lead_ids IS NULL OR cardinality(p_lead_ids) = 0 THEN RETURN; END IF;
  IF cardinality(p_lead_ids) > 500 THEN
    RAISE EXCEPTION 'Too many leads in one call (max 500)' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH touch AS (   -- what each person did with these leads, per IST day
    SELECT c.user_id AS uid, c.lead_id AS lid, (c.call_at AT TIME ZONE 'Asia/Kolkata')::date AS dt,
           sum(c.duration_seconds)::numeric AS secs, 0 AS meets
    FROM call_logs c
    WHERE c.lead_id = ANY (p_lead_ids) AND c.duration_seconds >= 10 AND coalesce(c.direction, '') <> 'missed'
    GROUP BY 1, 2, 3
    UNION ALL
    SELECT a.created_by, a.lead_id, (a.created_at AT TIME ZONE 'Asia/Kolkata')::date, 0, 1
    FROM lead_activities a
    WHERE a.lead_id = ANY (p_lead_ids)
      AND a.activity_type IN ('meeting', 'site_visit')
      AND coalesce(a.notes, '') NOT LIKE 'Meeting scheduled%'
      AND coalesce(a.notes, '') NOT LIKE 'I''m here · auto-check-in%'
    GROUP BY 1, 2, 3
  ),
  t AS (SELECT uid, lid, dt, sum(secs) AS secs, max(meets) AS met FROM touch GROUP BY 1, 2, 3),
  pairs AS (
    SELECT DISTINCT t.uid, t.dt, u.role FROM t JOIN users u ON u.id = t.uid
    WHERE u.role IN ('sales', 'telecaller')
      AND (NOT v_team OR u.manager_id = auth.uid())   -- Phase 651: head sees his reps' cost only, never his own
  ),
  dayc AS (   -- the person's whole day, looked up only for days that touched these leads
    SELECT p.uid, p.dt, p.role,
      coalesce(s.monthly_salary, 0) / 26.0 AS sal_day,
      greatest(0, extract(epoch FROM (
        least(coalesce(la.t, w.check_out_at), coalesce(w.check_out_at, la.t)) - w.check_in_at)) / 60.0) AS work_min,
      coalesce(tk.secs, 0) AS day_secs,
      coalesce(mt.n, 0) AS day_meets,
      coalesce(ta.amt, 0) AS travel
    FROM pairs p
    JOIN work_sessions w ON w.user_id = p.uid AND w.work_date = p.dt AND w.check_in_at IS NOT NULL
    LEFT JOIN staff_incentive_profiles s ON s.user_id = p.uid
    CROSS JOIN LATERAL (
      SELECT (p.dt::timestamp AT TIME ZONE 'Asia/Kolkata') AS ds,
             ((p.dt + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') AS de
    ) r
    LEFT JOIN LATERAL (
      SELECT max(x) AS t FROM (
        SELECT max(a.created_at) AS x FROM lead_activities a WHERE a.created_by = p.uid AND a.created_at >= r.ds AND a.created_at < r.de
        UNION ALL
        SELECT max(c.call_at + make_interval(secs => coalesce(c.duration_seconds, 0))) FROM call_logs c
          WHERE c.user_id = p.uid AND c.call_at >= r.ds AND c.call_at < r.de
        UNION ALL
        SELECT max(g.captured_at) FROM gps_pings g WHERE g.user_id = p.uid AND g.captured_at >= r.ds AND g.captured_at < r.de
      ) z
    ) la ON true
    LEFT JOIN LATERAL (
      SELECT sum(c.duration_seconds)::numeric AS secs FROM call_logs c
      WHERE c.user_id = p.uid AND c.call_at >= r.ds AND c.call_at < r.de
        AND c.duration_seconds >= 10 AND coalesce(c.direction, '') <> 'missed'
    ) tk ON true
    LEFT JOIN LATERAL (
      SELECT count(DISTINCT coalesce(a.lead_id, a.id)) AS n FROM lead_activities a
      WHERE a.created_by = p.uid AND a.created_at >= r.ds AND a.created_at < r.de
        AND a.activity_type IN ('meeting', 'site_visit')
        AND coalesce(a.notes, '') NOT LIKE 'Meeting scheduled%'
        AND coalesce(a.notes, '') NOT LIKE 'I''m here · auto-check-in%'
    ) mt ON true
    LEFT JOIN LATERAL (
      SELECT d.total_amount AS amt FROM daily_ta d
      WHERE d.user_id = p.uid AND d.ta_date = p.dt AND coalesce(d.status, '') <> 'rejected'
    ) ta ON true
  ),
  share AS (
    SELECT t.lid, t.dt,
      CASE
        WHEN d.role = 'telecaller' THEN
          CASE WHEN d.day_secs > 0 THEN d.sal_day * t.secs / d.day_secs ELSE 0 END
        ELSE
          (CASE WHEN d.work_min > 0 THEN least(d.sal_day, d.sal_day * (t.secs / 60.0) / d.work_min) ELSE 0 END)
          + (CASE WHEN t.met = 1 AND d.day_meets > 0 THEN
               (d.sal_day - CASE WHEN d.work_min > 0 THEN least(d.sal_day, d.sal_day * (d.day_secs / 60.0) / d.work_min) ELSE 0 END
                + d.travel) / d.day_meets
             ELSE 0 END)
      END AS amt
    FROM t JOIN dayc d ON d.uid = t.uid AND d.dt = t.dt
  )
  SELECT s.lid, round(sum(s.amt)), count(DISTINCT s.dt)::int
  FROM share s GROUP BY s.lid;
END $$;

REVOKE ALL ON FUNCTION public.lead_cost_for(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lead_cost_for(uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';


-- VERIFY:
-- As admin: unchanged. As the sales head: cost only on leads his reps worked.
