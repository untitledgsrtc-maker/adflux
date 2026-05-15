-- supabase_phase34z67b_ta_trigger_throttle.sql
--
-- Phase 34Z.67b — throttle TA recompute trigger.
-- 15 May 2026
--
-- Owner concern (15 May 2026): "Are you counting TA every 5 min?
-- Because it will be too much call. So application might get down."
--
-- Phase 34Z.67's trigger fired compute_daily_ta on EVERY gps_pings
-- insert. With the 5-min interval auto-ping + 8-15 active reps that's
-- ~100+ calls/hour. Each call scans all pings for the day and
-- iterates haversine + detect_city per ping. Cheap in absolute
-- terms but wasteful.
--
-- Fix: only fire compute_daily_ta on meaningful events. Skip the
-- 5-min interval pings — the nightly cron at 23:50 IST picks up the
-- final state from all of them anyway.
--
-- New trigger condition: source IN ('checkin', 'checkout', 'manual').
-- That's ~3-5 calls per rep per day instead of ~100+.

-- ─── Replace trigger function ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_recompute_ta_on_ping()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_date date;
BEGIN
  IF NEW.user_id IS NULL OR NEW.captured_at IS NULL THEN
    RETURN NEW;
  END IF;
  -- Phase 34Z.67b — skip 'interval' (the 5-min auto-ping). Only
  -- meaningful events trigger an on-the-spot recompute. Nightly
  -- cron at 23:50 IST handles the rest. Cuts trigger volume from
  -- ~100/hour/rep down to 3-5/day/rep.
  IF NEW.source IS NOT NULL AND NEW.source NOT IN ('checkin', 'checkout', 'manual') THEN
    RETURN NEW;
  END IF;
  v_date := (NEW.captured_at AT TIME ZONE 'Asia/Kolkata')::date;
  PERFORM public.compute_daily_ta(NEW.user_id, v_date);
  RETURN NEW;
END $$;

-- Trigger itself (tg_ta_on_ping) already exists from Phase 34Z.67;
-- replacing the function is enough — the trigger picks up the new
-- body on next fire.

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────
-- Trigger still wired, function updated.
SELECT
  (SELECT count(*) FROM pg_trigger WHERE tgname = 'tg_ta_on_ping')                 AS trigger_present,
  (SELECT count(*) FROM pg_proc    WHERE proname = 'tg_recompute_ta_on_ping')       AS function_present;
