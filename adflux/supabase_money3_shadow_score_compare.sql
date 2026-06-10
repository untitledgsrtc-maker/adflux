-- =====================================================================
-- MONEY TRUTH 3 — SHADOW score comparison (changes NOTHING, shows the gap)
-- 2026-06-10
--
-- The salary score (compute_daily_score) is LOOSER than every screen:
--   - TC: counts a call when outcome IS NOT NULL (reps mark ~every call
--     "connected") OR a >=10s log exists. Screens count ONLY >=10s logs.
--   - Sales: counts meeting rows with the §33 exclusions but NO same-lead
--     dedup (5 visits to one client = 5; the dashboard counts 1). Site
--     visits are NOT counted by the score but ARE by the dashboard.
--
-- This function computes the WOULD-BE score under the screen-aligned rules
-- and returns it NEXT TO the stored (paid) score, per rep per day range.
-- It writes NOTHING and replaces NOTHING — compute_daily_score, pay, and
-- every screen stay exactly as they are. Pure decision data for the owner.
--
-- NEW (screen-aligned) rules used for the shadow:
--   TC 'call' count  = call_logs rows, IST day, duration_seconds >= 10,
--                      direction <> 'missed' (the useDaySummary rule).
--   Sales 'meeting'  = meeting + site_visit rows, §33 exclusions, deduped
--                      to UNIQUE lead per day (COALESCE(lead_id, id)) —
--                      the dashboard/counter contract.
--   Targets, day-exclusions, and the 100-cap mirror the live function.
--
-- Run (any range; keep it to a week or two for readability):
--   SELECT * FROM public.shadow_score_compare(
--     (now() AT TIME ZONE 'Asia/Kolkata')::date - 7,
--     (now() AT TIME ZONE 'Asia/Kolkata')::date
--   ) ORDER BY rep_name, work_date;
--
-- Per-rep summary (the cutover decision table):
--   SELECT rep_name, role, count(*) AS days,
--          round(avg(old_score_pct),1) AS old_avg,
--          round(avg(new_score_pct),1) AS new_avg,
--          round(avg(old_score_pct) - avg(new_score_pct),1) AS gap
--     FROM public.shadow_score_compare(
--            (now() AT TIME ZONE 'Asia/Kolkata')::date - 7,
--            (now() AT TIME ZONE 'Asia/Kolkata')::date)
--    GROUP BY rep_name, role ORDER BY gap DESC;
--
-- SAFE (§45): one NEW read-only function, admin/co_owner-gated. No table,
-- trigger, or live function touched. Idempotent.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.shadow_score_compare(p_from date, p_to date)
RETURNS TABLE (
  rep_name      text,
  role          text,
  work_date     date,
  old_done      int,
  new_done      int,
  target        int,
  old_score_pct numeric,
  new_score_pct numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller_role text;
BEGIN
  SELECT u.role INTO v_caller_role FROM users u WHERE u.id = auth.uid();
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin', 'co_owner') THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  RETURN QUERY
  WITH days AS (
    SELECT d::date AS day FROM generate_series(p_from, p_to, interval '1 day') d
  ),
  reps AS (
    SELECT u.id, u.name, u.role AS urole, u.daily_targets
      FROM users u
     WHERE u.role IN ('sales', 'telecaller', 'agency')
       AND COALESCE(u.is_active, true)
  ),
  grid AS (
    SELECT r.id, r.name, r.urole, r.daily_targets, d.day
      FROM reps r CROSS JOIN days d
     WHERE EXTRACT(ISODOW FROM d.day) <> 7                         -- skip Sundays (mirrors live)
       AND NOT EXISTS (SELECT 1 FROM holidays h
                        WHERE h.holiday_date = d.day AND h.is_active = true)
  ),
  tc_new AS (                                                       -- screen rule: >=10s real logs
    SELECT cl.user_id,
           (COALESCE(cl.call_at, cl.created_at) AT TIME ZONE 'Asia/Kolkata')::date AS day,
           count(*) AS n
      FROM call_logs cl
     WHERE cl.duration_seconds >= 10
       AND (cl.direction IS NULL OR cl.direction <> 'missed')
       AND (COALESCE(cl.call_at, cl.created_at) AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to
     GROUP BY 1, 2
  ),
  meet_new AS (                                                     -- dashboard contract: §33 + unique lead/day
    SELECT la.created_by AS user_id,
           (la.created_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
           count(DISTINCT COALESCE(la.lead_id::text, la.id::text)) AS n
      FROM lead_activities la
     WHERE la.activity_type IN ('meeting', 'site_visit')
       AND (la.notes IS NULL OR la.notes NOT LIKE 'Meeting scheduled%')
       AND (la.notes IS NULL OR la.notes NOT LIKE 'I''m here · auto-check-in%')
       AND (la.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to
     GROUP BY 1, 2
  )
  SELECT
    g.name,
    g.urole,
    g.day,
    COALESCE(dp.meetings_done, 0)                                   AS old_done,
    CASE WHEN g.urole = 'telecaller'
         THEN COALESCE(tn.n, 0)::int
         ELSE COALESCE(mn.n, 0)::int END                            AS new_done,
    CASE WHEN g.urole = 'telecaller'
         THEN COALESCE((SELECT NULLIF(dt.min_calls, 0) FROM daily_targets dt
                         WHERE dt.user_id = g.id AND dt.effective_to IS NULL LIMIT 1), 50)
         ELSE COALESCE((g.daily_targets->>'meetings')::int, 5) END  AS target,
    COALESCE(dp.score_pct, 0)                                       AS old_score_pct,
    LEAST(100, (CASE WHEN g.urole = 'telecaller'
                     THEN COALESCE(tn.n, 0)
                     ELSE COALESCE(mn.n, 0) END)::numeric
               / NULLIF(CASE WHEN g.urole = 'telecaller'
                     THEN COALESCE((SELECT NULLIF(dt.min_calls, 0) FROM daily_targets dt
                                     WHERE dt.user_id = g.id AND dt.effective_to IS NULL LIMIT 1), 50)
                     ELSE COALESCE((g.daily_targets->>'meetings')::int, 5) END, 0)::numeric
               * 100)                                               AS new_score_pct
  FROM grid g
  LEFT JOIN daily_performance dp ON dp.user_id = g.id AND dp.work_date = g.day
  LEFT JOIN tc_new   tn ON tn.user_id = g.id AND tn.day = g.day AND g.urole = 'telecaller'
  LEFT JOIN meet_new mn ON mn.user_id = g.id AND mn.day = g.day AND g.urole <> 'telecaller'
  WHERE COALESCE(dp.is_excluded, false) = false;                    -- skip leave/excluded days
END $function$;

REVOKE EXECUTE ON FUNCTION public.shadow_score_compare(date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.shadow_score_compare(date, date) TO authenticated;  -- role-gated inside

-- self-register (tolerant if the register table isn't created yet)
DO $$
BEGIN
  IF to_regclass('public.applied_migrations') IS NOT NULL THEN
    INSERT INTO public.applied_migrations (name, note)
    VALUES ('supabase_money3_shadow_score_compare.sql', 'Money Truth - shadow score comparison (read-only)')
    ON CONFLICT (name) DO NOTHING;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM pg_proc WHERE proname = 'shadow_score_compare')        AS shadow_fn,        -- 1
  (SELECT position('compute_daily_score' in pg_get_functiondef(
      'public.shadow_score_compare(date,date)'::regprocedure)) = 0)            AS does_not_touch_live; -- t

-- ─── THE DECISION TABLE (run this after the VERIFY) ──────────────────
SELECT rep_name, role, count(*) AS days,
       round(avg(old_score_pct), 1) AS old_avg,
       round(avg(new_score_pct), 1) AS new_avg,
       round(avg(old_score_pct) - avg(new_score_pct), 1) AS gap
  FROM public.shadow_score_compare(
         (now() AT TIME ZONE 'Asia/Kolkata')::date - 7,
         (now() AT TIME ZONE 'Asia/Kolkata')::date)
 GROUP BY rep_name, role
 ORDER BY gap DESC;

SELECT 'Money 3 shadow score comparison applied' AS status;
