-- supabase_phase34z66_daily_performance_autocompute.sql
--
-- Phase 34Z.66 — fix "No score yet this month" for active reps.
-- 15 May 2026
--
-- Owner reported (15 May 2026): rep with many lead_activities rows
-- still shows "No score yet this month" on /my-performance. Root
-- cause chain:
--
--   monthly_score reads daily_performance
--    ↓
--   daily_performance only fills when compute_daily_score is called
--    ↓
--   compute_daily_score has no cron + no trigger → never runs in
--   production
--    ↓
--   table stays empty → working_days = 0 → empty state renders
--
-- Plus a second bug: compute_daily_score counted meetings from
-- work_sessions.daily_counters->meetings (a cache that gets bumped
-- by client-side code on LogMeetingModal save). Reps logging
-- meetings via PostCallOutcomeModal, LeadFormV2 meeting-mode, or
-- LogActivityModal didn't touch that cache, so even when the cron
-- did run the count was wrong.
--
-- Three fixes:
--
-- 1. Rewrite compute_daily_score to count meetings from
--    lead_activities directly (activity_type='meeting',
--    created_by=user, created_at on p_date IST). Single source of
--    truth.
--
-- 2. AFTER INSERT trigger on lead_activities — when a meeting row
--    is inserted, recompute that rep's score for today. Score
--    updates live as the rep logs meetings.
--
-- 3. Nightly cron at 23:45 IST = 18:15 UTC — recompute every active
--    rep's score for today. Safety net.
--
-- 4. Backfill: compute_daily_score for every active rep on every
--    workday in the current month. Fills in everything the empty
--    table missed.

-- ─── 1. Rewrite compute_daily_score ──────────────────────────────
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
  -- Sunday → not a workday.
  v_dow := EXTRACT(DOW FROM p_date)::int;
  IF v_dow = 0 THEN
    v_excluded := true;
    v_reason   := 'Sunday';
  END IF;

  -- National / Gujarat / company holiday.
  IF NOT v_excluded AND EXISTS (
    SELECT 1 FROM holidays
    WHERE holiday_date = p_date AND is_active = true
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

  -- Target from users.daily_targets, default 5.
  SELECT daily_targets INTO v_targets FROM users WHERE id = p_user_id;
  v_target := COALESCE((v_targets->>'meetings')::int, 5);

  -- Phase 34Z.66 — count meetings from lead_activities directly so
  -- the score reflects EVERY meeting the rep logged, not just the
  -- ones that updated the work_sessions.daily_counters cache.
  -- Date boundary in IST (Asia/Kolkata) so "today" matches the rep.
  SELECT COUNT(*)
    INTO v_done
    FROM lead_activities la
   WHERE la.created_by    = p_user_id
     AND la.activity_type = 'meeting'
     AND (la.created_at AT TIME ZONE 'Asia/Kolkata')::date = p_date;

  -- Compute %, cap 100.
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


-- ─── 2. Trigger: recompute on every lead_activities meeting ──────
-- AFTER INSERT only — UPDATE / DELETE on lead_activities is rare
-- and not worth recomputing for. The nightly cron picks up edge
-- cases.
CREATE OR REPLACE FUNCTION public.tg_recompute_score_on_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_date date;
BEGIN
  IF NEW.activity_type IS NULL OR NEW.activity_type <> 'meeting' THEN
    RETURN NEW;
  END IF;
  IF NEW.created_by IS NULL THEN
    RETURN NEW;
  END IF;
  v_date := (COALESCE(NEW.created_at, now()) AT TIME ZONE 'Asia/Kolkata')::date;
  PERFORM public.compute_daily_score(NEW.created_by, v_date);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_score_on_activity ON public.lead_activities;
CREATE TRIGGER tg_score_on_activity
  AFTER INSERT ON public.lead_activities
  FOR EACH ROW EXECUTE FUNCTION public.tg_recompute_score_on_activity();


-- ─── 3. Nightly cron — recompute every active rep's score ───────
-- 23:45 IST = 18:15 UTC. Picks up any rep whose activities for the
-- day didn't trigger the live recompute (e.g. inserted via bulk
-- backfill or admin SQL).
CREATE OR REPLACE FUNCTION public.recompute_all_scores_today()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count int := 0;
  v_user record;
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  FOR v_user IN
    SELECT id
      FROM users
     WHERE role IN ('sales','agency','telecaller')
       AND COALESCE(is_active, true) = true
  LOOP
    PERFORM public.compute_daily_score(v_user.id, v_today);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public.recompute_all_scores_today() TO authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('untitled-recompute-scores-nightly');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'untitled-recompute-scores-nightly',
  '15 18 * * *',  -- 18:15 UTC = 23:45 IST
  $$ SELECT public.recompute_all_scores_today(); $$
);


-- ─── 4. Backfill — current month ─────────────────────────────────
-- Walks every workday from p_month_start (default = first of this
-- IST month) up to today and calls compute_daily_score for every
-- active rep. Fills the table so monthly_score returns real numbers
-- on next read.
CREATE OR REPLACE FUNCTION public.backfill_daily_performance_month(
  p_month_start date DEFAULT NULL
) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_start  date := COALESCE(p_month_start,
                            date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata')::date)::date);
  v_today  date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_d      date;
  v_user   record;
  v_count  int := 0;
BEGIN
  v_d := v_start;
  WHILE v_d <= v_today LOOP
    FOR v_user IN
      SELECT id FROM users
       WHERE role IN ('sales','agency','telecaller')
         AND COALESCE(is_active, true) = true
    LOOP
      PERFORM public.compute_daily_score(v_user.id, v_d);
      v_count := v_count + 1;
    END LOOP;
    v_d := v_d + 1;
  END LOOP;
  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public.backfill_daily_performance_month(date) TO authenticated;


NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────
-- 1. Trigger present.
-- 2. Cron present.
-- 3. Backfill the current month and read score for one rep.

SELECT
  (SELECT count(*) FROM pg_trigger WHERE tgname = 'tg_score_on_activity')          AS trigger_present,
  (SELECT count(*) FROM cron.job   WHERE jobname = 'untitled-recompute-scores-nightly') AS cron_present;

-- Owner: run this once to fill the current-month gap.
-- SELECT public.backfill_daily_performance_month();
-- Then re-open /my-performance — the score should populate.
