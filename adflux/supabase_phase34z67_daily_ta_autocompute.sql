-- supabase_phase34z67_daily_ta_autocompute.sql
--
-- Phase 34Z.67 — auto-punch daily TA for every rep.
-- 15 May 2026
--
-- Owner question (15 May 2026): "How does TA auto-punch daily?"
-- Answer before this file: it doesn't. compute_daily_ta(user, date)
-- exists from Phase 33Q but no cron, no trigger calls it — daily_ta
-- rows never get written automatically. Admin had to invoke it by
-- hand for each rep + date. Same gap that Phase 34Z.66 just closed
-- for the performance score.
--
-- Three additions:
--
-- 1. AFTER INSERT trigger on gps_pings — when a rep's first ping of
--    the day lands, AND every subsequent ping, recompute their
--    daily_ta for that IST date. TA updates live as the rep moves.
--    (Idempotent — compute_daily_ta upserts.)
--
-- 2. Nightly cron at 23:50 IST = 18:20 UTC. Calls compute_daily_ta
--    for every active rep for today. Safety net: catches reps whose
--    pings didn't fire the trigger for any reason, and ensures end-
--    of-day totals are stable before admin runs payroll.
--
-- 3. Backfill helper: walks every (active rep × every IST workday
--    this month) and computes TA. Owner runs once after deploy so
--    daily_ta has the historical rows the admin TA dashboard reads.
--
-- All idempotent.

-- ─── 1. Trigger: recompute on gps_pings INSERT ───────────────────
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

DROP TRIGGER IF EXISTS tg_ta_on_ping ON public.gps_pings;
CREATE TRIGGER tg_ta_on_ping
  AFTER INSERT ON public.gps_pings
  FOR EACH ROW EXECUTE FUNCTION public.tg_recompute_ta_on_ping();


-- ─── 2. Nightly cron ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.recompute_all_ta_today()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count int := 0;
  v_user  record;
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  FOR v_user IN
    SELECT id
      FROM users
     WHERE role IN ('sales','agency','telecaller')
       AND COALESCE(is_active, true) = true
  LOOP
    PERFORM public.compute_daily_ta(v_user.id, v_today);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public.recompute_all_ta_today() TO authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('untitled-recompute-ta-nightly');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'untitled-recompute-ta-nightly',
  '20 18 * * *',  -- 18:20 UTC = 23:50 IST
  $$ SELECT public.recompute_all_ta_today(); $$
);


-- ─── 3. Backfill ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.backfill_daily_ta_month(
  p_month_start date DEFAULT NULL
) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_start date := COALESCE(p_month_start,
                           date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata')::date)::date);
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_d     date;
  v_user  record;
  v_count int := 0;
BEGIN
  v_d := v_start;
  WHILE v_d <= v_today LOOP
    FOR v_user IN
      SELECT id FROM users
       WHERE role IN ('sales','agency','telecaller')
         AND COALESCE(is_active, true) = true
    LOOP
      PERFORM public.compute_daily_ta(v_user.id, v_d);
      v_count := v_count + 1;
    END LOOP;
    v_d := v_d + 1;
  END LOOP;
  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public.backfill_daily_ta_month(date) TO authenticated;


NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM pg_trigger WHERE tgname = 'tg_ta_on_ping')              AS trigger_present,
  (SELECT count(*) FROM cron.job   WHERE jobname = 'untitled-recompute-ta-nightly') AS cron_present;

-- Owner: run this once to fill the current-month gap.
-- SELECT public.backfill_daily_ta_month();
