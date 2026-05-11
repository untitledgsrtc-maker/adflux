-- =====================================================================
-- Phase 33E — Performance scoring + variable salary
-- 11 May 2026
--
-- Owner-locked model:
--   • Each rep: base = 70% fixed, variable = 30% tied to task %
--   • Task = daily meetings done vs target (Option 1 — meetings only,
--     GPS-verified, hardest to fake)
--   • Below 50% monthly avg → variable = 0
--   • At/above 50% → variable = (avg_pct / 100) × variable_amount
--   • Exclude Sundays, holidays, off-days from the average
--
-- Source: monthly_salary lives on staff_incentive_profiles.
-- Total comp = monthly_salary. Base = 70%, Variable cap = 30%.
-- =====================================================================

-- ─── 1. daily_performance table ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_performance (
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_date        date NOT NULL,
  meetings_done    int  NOT NULL DEFAULT 0,
  meetings_target  int  NOT NULL DEFAULT 5,
  score_pct        numeric NOT NULL DEFAULT 0,
  is_excluded      boolean NOT NULL DEFAULT false,
  excluded_reason  text,
  calculated_at    timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, work_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_performance_month
  ON daily_performance (user_id, work_date);

-- ─── 2. compute_daily_score(uid, date) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.compute_daily_score(
  p_user_id uuid, p_date date
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_done    int := 0;
  v_target  int := 5;
  v_pct     numeric;
  v_excluded boolean := false;
  v_reason  text;
  v_dow     int;
  v_off_day boolean := false;
  v_targets jsonb;
BEGIN
  -- Sunday? Skip — not a workday.
  v_dow := EXTRACT(DOW FROM p_date)::int;
  IF v_dow = 0 THEN
    v_excluded := true;
    v_reason   := 'Sunday';
  END IF;

  -- National / Gujarat / company holiday?
  IF NOT v_excluded AND EXISTS (
    SELECT 1 FROM holidays
    WHERE holiday_date = p_date AND is_active = true
  ) THEN
    v_excluded := true;
    SELECT name INTO v_reason FROM holidays
      WHERE holiday_date = p_date AND is_active = true LIMIT 1;
    v_reason := COALESCE('Holiday: ' || v_reason, 'Holiday');
  END IF;

  -- Off day on the rep's work_sessions row (approved leave proxy
  -- — Phase 12 uses is_off_day for this).
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

  -- Pull target from users.daily_targets (Phase 32M default 5).
  SELECT daily_targets INTO v_targets FROM users WHERE id = p_user_id;
  v_target := COALESCE((v_targets->>'meetings')::int, 5);

  -- Pull actual from work_sessions.daily_counters.
  SELECT COALESCE((daily_counters->>'meetings')::int, 0)
    INTO v_done
    FROM work_sessions
   WHERE user_id = p_user_id AND work_date = p_date;
  v_done := COALESCE(v_done, 0);

  -- Compute %. Cap at 100.
  IF v_target = 0 THEN
    v_pct := 100;
  ELSE
    v_pct := LEAST(100, (v_done::numeric / v_target::numeric) * 100);
  END IF;

  -- Upsert.
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

-- ─── 3. monthly_score for a rep ─────────────────────────────────────
-- Returns: average score %, working day count, variable amount,
-- total comp (base + variable), based on staff_incentive_profiles.
-- monthly_salary as the TOTAL comp budget.

CREATE OR REPLACE FUNCTION public.monthly_score(
  p_user_id uuid, p_month_start date
) RETURNS TABLE (
  user_id          uuid,
  month_start      date,
  working_days     int,
  avg_score_pct    numeric,
  monthly_salary   numeric,
  base_amount      numeric,
  variable_cap     numeric,
  variable_earned  numeric,
  total_payable    numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_avg     numeric := 0;
  v_days    int := 0;
  v_salary  numeric := 0;
  v_base    numeric;
  v_var_cap numeric;
  v_var_earned numeric;
BEGIN
  SELECT AVG(score_pct), COUNT(*)
    INTO v_avg, v_days
    FROM daily_performance
   WHERE user_id = p_user_id
     AND work_date >= p_month_start
     AND work_date < (p_month_start + INTERVAL '1 month')
     AND is_excluded = false;

  SELECT COALESCE(monthly_salary, 0) INTO v_salary
    FROM staff_incentive_profiles
   WHERE user_id = p_user_id;

  v_base    := v_salary * 0.70;
  v_var_cap := v_salary * 0.30;

  -- No working days (whole month leave) → full variable.
  IF v_days = 0 THEN
    v_avg := 100;
    v_var_earned := v_var_cap;
  -- Below 50% threshold → zero variable.
  ELSIF v_avg < 50 THEN
    v_var_earned := 0;
  -- Above 50% → linear scale (avg/100) × variable cap.
  ELSE
    v_var_earned := (v_avg / 100.0) * v_var_cap;
  END IF;

  RETURN QUERY
  SELECT p_user_id, p_month_start, v_days,
         ROUND(v_avg, 1), v_salary, ROUND(v_base, 0),
         ROUND(v_var_cap, 0), ROUND(v_var_earned, 0),
         ROUND(v_base + v_var_earned, 0);
END $$;

GRANT EXECUTE ON FUNCTION public.monthly_score(uuid, date) TO authenticated;

-- ─── 4. RLS — rep sees own; admin/co_owner sees all ────────────────
ALTER TABLE daily_performance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dp_own   ON daily_performance;
DROP POLICY IF EXISTS dp_admin ON daily_performance;

CREATE POLICY dp_own ON daily_performance
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY dp_admin ON daily_performance
  FOR ALL USING (public.get_my_role() IN ('admin','co_owner'))
  WITH CHECK (public.get_my_role() IN ('admin','co_owner'));

-- ─── 5. Backfill helper — compute last 30 days for a user ──────────
CREATE OR REPLACE FUNCTION public.backfill_performance(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE d date;
BEGIN
  FOR d IN
    SELECT generate_series(CURRENT_DATE - 30, CURRENT_DATE, '1 day')::date
  LOOP
    PERFORM public.compute_daily_score(p_user_id, d);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.backfill_performance(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.tables
    WHERE table_name='daily_performance') AS table_exists,
  (SELECT count(*) FROM pg_proc WHERE proname IN
    ('compute_daily_score','monthly_score','backfill_performance')) AS function_count;
