-- supabase_phase665_role_targets.sql (24-11-2026)
-- Owner approved 24-11-2026: role-based targets.
--   1. daily_targets gains min_meetings (the profile page already read/wrote it,
--      so its Edit KPI targets save always failed with "column does not exist").
--   2. compute_daily_score: sales meeting target reads min_meetings; agency not scored.
--      The function itself lives in db/functions/compute_daily_score.sql - run that
--      file right after this one.
-- No existing target or score changes: every current person keeps 5 meetings / 50 calls
-- until HR edits them. Past daily_performance rows are untouched.

ALTER TABLE public.daily_targets ADD COLUMN IF NOT EXISTS min_meetings int;

-- 3. Keep the old per-user setting (users.daily_targets->'meetings') in step, because the
--    rep's Today ring, the evening report and the admin dashboard still read it. One tiny
--    update on a rarely-written table; no hot path touched.
CREATE OR REPLACE FUNCTION public.sync_meeting_target_to_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.users
     SET daily_targets = COALESCE(daily_targets, '{}'::jsonb) || jsonb_build_object('meetings', NEW.min_meetings)
   WHERE id = NEW.user_id
     AND (daily_targets->>'meetings') IS DISTINCT FROM NEW.min_meetings::text;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.sync_meeting_target_to_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_daily_targets_sync_meetings ON public.daily_targets;
CREATE TRIGGER trg_daily_targets_sync_meetings
  AFTER INSERT OR UPDATE OF min_meetings, effective_to ON public.daily_targets
  FOR EACH ROW
  WHEN (NEW.effective_to IS NULL AND COALESCE(NEW.min_meetings, 0) > 0)
  EXECUTE FUNCTION public.sync_meeting_target_to_user();

NOTIFY pgrst, 'reload schema';

-- VERIFY: expect min_meetings_col = 1, sync_trigger = 1
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='daily_targets' AND column_name='min_meetings') AS min_meetings_col,
  (SELECT count(*) FROM pg_trigger WHERE tgname='trg_daily_targets_sync_meetings') AS sync_trigger;
