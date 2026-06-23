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
-- -------------------------------------------------------------------------
-- compute_daily_score REMOVED from this file (Phase 178 consolidation).
-- The ONE canonical version now lives in: db/functions/compute_daily_score.sql
-- Do NOT re-add it here. To change the score, edit the canonical file only (§71).
-- -------------------------------------------------------------------------


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
