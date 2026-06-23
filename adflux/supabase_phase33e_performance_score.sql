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
-- -------------------------------------------------------------------------
-- compute_daily_score REMOVED from this file (Phase 178 consolidation).
-- The ONE canonical version now lives in: db/functions/compute_daily_score.sql
-- Do NOT re-add it here. To change the score, edit the canonical file only (§71).
-- -------------------------------------------------------------------------

-- ─── 3. monthly_score for a rep ─────────────────────────────────────
-- Returns: average score %, working day count, variable amount,
-- total comp (base + variable), based on staff_incentive_profiles.
-- monthly_salary as the TOTAL comp budget.

-- -------------------------------------------------------------------------
-- monthly_score REMOVED from this file (Phase 178).
-- Canonical: db/functions/monthly_score.sql (feeds compute_monthly_salary).
-- Do NOT re-add it here. Edit the canonical file only (§71).
-- -------------------------------------------------------------------------

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
