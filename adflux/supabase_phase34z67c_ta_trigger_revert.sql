-- supabase_phase34z67c_ta_trigger_revert.sql
--
-- Phase 34Z.67c — revert TA trigger throttle.
-- 15 May 2026
--
-- Owner pivot (15 May 2026) on Phase 34Z.67b: "Every 5 min × 8-15
-- reps × 8 hrs = 100-200 trigger calls/hour. Is perfect one."
--
-- He wants the every-ping behavior. Restore the Phase 34Z.67
-- function body — fire compute_daily_ta on EVERY gps_pings insert,
-- no source filter. Rep gets live TA updates as they move.
-- 100-200/hr is well within Supabase's budget; the haversine +
-- detect_city per-ping math is cheap.

CREATE OR REPLACE FUNCTION public.tg_recompute_ta_on_ping()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_date date;
BEGIN
  IF NEW.user_id IS NULL OR NEW.captured_at IS NULL THEN
    RETURN NEW;
  END IF;
  v_date := (NEW.captured_at AT TIME ZONE 'Asia/Kolkata')::date;
  PERFORM public.compute_daily_ta(NEW.user_id, v_date);
  RETURN NEW;
END $$;

NOTIFY pgrst, 'reload schema';

SELECT
  (SELECT count(*) FROM pg_trigger WHERE tgname = 'tg_ta_on_ping')           AS trigger_present,
  (SELECT count(*) FROM pg_proc    WHERE proname = 'tg_recompute_ta_on_ping') AS function_present;
