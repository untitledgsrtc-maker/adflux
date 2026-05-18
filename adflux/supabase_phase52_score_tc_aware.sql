-- supabase_phase52_score_tc_aware.sql
-- Phase 52b — telecaller-aware performance score.
-- 18 May 2026
--
-- Owner directive: "what we created for tele-caller not applied in
-- real database". Phase 47/49 added daily_targets columns
-- (min_calls=50, min_connect_pct=30, min_qualified_weekly=5) but
-- compute_daily_score (Phase 34Z.66) only counts meetings against
-- daily_targets.meetings (default 5). Result: Rima's score stays
-- ~0% no matter how many calls she makes.
--
-- Fix:
--   1. compute_daily_score branches on users.role:
--      - role='telecaller' → count `call` activities, target =
--        users.daily_targets->>'calls' (default 50)
--      - else              → existing meeting logic (default 5)
--      Both TC head (auth_role='telecaller', team_role='sales_manager')
--      and regular TC (team_role='telecaller') match because both
--      carry role='telecaller'.
--   2. tg_recompute_score_on_activity fires on 'meeting' OR 'call'
--      inserts (was: meeting only). Skips notes / whatsapp / sms.
--   3. daily_performance.meetings_done / _target column names stay
--      semantic-loose ("activity_done / activity_target") — no rename
--      to avoid breaking the read path. UI labels swap per role.
--
-- Idempotent. CREATE OR REPLACE on both functions. No new columns,
-- no policy changes, no schema mutation beyond replacing two
-- function bodies.
--
-- Sales / agency / staff paths unchanged.


-- ─── 1. Patch compute_daily_score — TC branch ────────────────────
CREATE OR REPLACE FUNCTION public.compute_daily_score(
  p_user_id uuid,
  p_date    date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role       text;
  v_targets    jsonb;
  v_target     int;
  v_done       int;
  v_pct        numeric;
  v_excluded   boolean := false;
  v_reason     text    := NULL;
  v_off_day    boolean := false;
  v_dow        int;
  v_activity   text;
BEGIN
  -- Day-of-week (1=Mon..7=Sun, ISO).
  v_dow := EXTRACT(ISODOW FROM p_date);

  -- Sunday auto-excluded.
  IF v_dow = 7 THEN
    v_excluded := true;
    v_reason   := 'Sunday';
  END IF;

  -- Public holiday from `holidays`.
  IF NOT v_excluded AND EXISTS (
    SELECT 1 FROM holidays WHERE holiday_date = p_date AND is_active = true
  ) THEN
    v_excluded := true;
    SELECT name INTO v_reason FROM holidays
      WHERE holiday_date = p_date AND is_active = true LIMIT 1;
    v_reason := COALESCE('Holiday: ' || v_reason, 'Holiday');
  END IF;

  -- Off day on work_sessions (approved leave proxy).
  IF NOT v_excluded THEN
    SELECT COALESCE(is_off_day, false), COALESCE(off_reason, '')
      INTO v_off_day, v_reason
      FROM work_sessions
     WHERE user_id = p_user_id AND work_date = p_date;
    IF v_off_day THEN
      v_excluded := true;
      v_reason   := COALESCE(NULLIF(v_reason, ''), 'Approved leave');
    END IF;
  END IF;

  -- ── Phase 52b — TC branch ──
  -- Pull role + targets jsonb in one shot. Branch on role.
  SELECT role, daily_targets
    INTO v_role, v_targets
    FROM users
   WHERE id = p_user_id;

  IF v_role = 'telecaller' THEN
    -- TC scores against CALLS, not meetings.
    -- Default 50 calls/day (Phase 49 owner directive).
    v_target   := COALESCE((v_targets->>'calls')::int, 50);
    v_activity := 'call';
  ELSE
    -- Sales / agency / staff path — meetings, default 5.
    v_target   := COALESCE((v_targets->>'meetings')::int, 5);
    v_activity := 'meeting';
  END IF;

  -- Count activities for the day in IST. lead_activities is the
  -- canonical source (Phase 34Z.66 — work_sessions.daily_counters
  -- can lag).
  SELECT COUNT(*)
    INTO v_done
    FROM lead_activities la
   WHERE la.created_by    = p_user_id
     AND la.activity_type = v_activity
     AND (la.created_at AT TIME ZONE 'Asia/Kolkata')::date = p_date;

  -- Compute %, cap 100.
  IF v_target = 0 THEN
    v_pct := 100;
  ELSE
    v_pct := LEAST(100, (v_done::numeric / v_target::numeric) * 100);
  END IF;

  -- Upsert. Column names stay (meetings_done / _target) to avoid a
  -- schema rename + read-side patch. They now hold the activity
  -- count + target appropriate to the user's role.
  INSERT INTO daily_performance (
    user_id, work_date, meetings_done, meetings_target,
    score_pct, is_excluded, excluded_reason, calculated_at
  ) VALUES (
    p_user_id, p_date, v_done, v_target,
    v_pct, v_excluded, v_reason, now()
  )
  ON CONFLICT (user_id, work_date) DO UPDATE
    SET meetings_done   = EXCLUDED.meetings_done,
        meetings_target = EXCLUDED.meetings_target,
        score_pct       = EXCLUDED.score_pct,
        is_excluded     = EXCLUDED.is_excluded,
        excluded_reason = EXCLUDED.excluded_reason,
        calculated_at   = now();
END $$;

GRANT EXECUTE ON FUNCTION public.compute_daily_score(uuid, date) TO authenticated;


-- ─── 2. Patch tg_recompute_score_on_activity — widen fire set ────
-- Was: meeting only. Now: meeting OR call. Notes / whatsapp / sms /
-- site_visit still skip recompute.
CREATE OR REPLACE FUNCTION public.tg_recompute_score_on_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date date;
BEGIN
  IF NEW.activity_type IS NULL
     OR NEW.activity_type NOT IN ('meeting', 'call') THEN
    RETURN NEW;
  END IF;
  IF NEW.created_by IS NULL THEN
    RETURN NEW;
  END IF;

  -- IST-anchored date (matches compute_daily_score boundary).
  v_date := (NEW.created_at AT TIME ZONE 'Asia/Kolkata')::date;

  PERFORM public.compute_daily_score(NEW.created_by, v_date);
  RETURN NEW;
END $$;


-- Re-bind trigger so the updated function body takes effect on the
-- table-level reference (Phase 34Z.66 already created the trigger;
-- DROP + CREATE is idempotent and clears any stale plan cache).
DROP TRIGGER IF EXISTS trg_recompute_score_on_activity ON public.lead_activities;
CREATE TRIGGER trg_recompute_score_on_activity
  AFTER INSERT ON public.lead_activities
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_recompute_score_on_activity();


-- ─── 3. Backfill TC scores for current month ──────────────────────
-- After the function-body swap, existing TC rows still hold the old
-- 0% values written by the previous logic. Recompute the current
-- month for every TC so the UI surfaces the corrected score
-- without waiting for the next activity insert to trigger.
DO $$
DECLARE
  v_user uuid;
  v_day  date;
  v_month_start date := date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata')::date)::date;
  v_today       date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  FOR v_user IN
    SELECT id FROM users WHERE role = 'telecaller' AND is_active = true
  LOOP
    v_day := v_month_start;
    WHILE v_day <= v_today LOOP
      PERFORM public.compute_daily_score(v_user, v_day);
      v_day := v_day + 1;
    END LOOP;
  END LOOP;
END $$;


NOTIFY pgrst, 'reload schema';


-- ─── VERIFY ──────────────────────────────────────────────────────
-- Expected counts:
--   tc_users_present  ≥ 1   (Dhara / Rima / Renuka)
--   updated_function  = 1   (compute_daily_score body contains 'v_activity')
--   widened_trigger   = 1   (tg_recompute_score_on_activity body matches IN ('meeting','call'))
--   tc_perf_rows      ≥ 0   (rows written by the backfill DO block — 0 OK if TC made no calls today)
SELECT
  (SELECT count(*) FROM public.users
    WHERE role = 'telecaller' AND is_active = true)                                AS tc_users_present,
  (SELECT count(*) FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'compute_daily_score'
      AND pg_get_functiondef(p.oid) ILIKE '%v_activity%')                          AS updated_function,
  (SELECT count(*) FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'tg_recompute_score_on_activity'
      AND pg_get_functiondef(p.oid) ILIKE E'%IN (\'meeting\', \'call\')%')         AS widened_trigger,
  (SELECT count(*) FROM public.daily_performance dp
    JOIN public.users u ON u.id = dp.user_id
    WHERE u.role = 'telecaller'
      AND dp.work_date >= date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata')::date)::date)
                                                                                   AS tc_perf_rows;
