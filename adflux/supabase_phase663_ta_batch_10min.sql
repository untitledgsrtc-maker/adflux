-- supabase_phase663_ta_batch_10min.sql (24-11-2026)
--
-- TA / km recompute: every GPS ping -> once per 10 minutes per rep-day.
-- OWNER APPROVED 24-11-2026 ("yes approve, do every 10 minutes"), changing the
-- frozen Phase 34Z.67 contract (sec 28). History: 34Z.67b throttled it on 15 May,
-- 34Z.67c reverted because it was estimated at 100-200 recomputes/hour. Measured
-- 24-11-2026 (pg_stat_statements since 18 Oct): gps_pings INSERT = 697k of 874k s
-- of ALL database time (80%), ~1.8-2.9 s per insert, because each insert re-reads
-- the rep's whole day + detect_city per ping. That load is why compute went
-- Micro -> Medium (~$60/mo).
--
-- What changes:
--   * tg_recompute_ta_on_ping (same trigger tg_ta_on_ping) now only marks the
--     (user, IST day) as dirty in ta_dirty - one tiny upsert per ping.
--   * recompute_ta_dirty() runs every 10 min (cron 'recompute-ta-dirty') and calls
--     the UNCHANGED compute_daily_ta for each dirty rep-day. Same formula, same
--     result; km/TA is at most ~10 min behind instead of instant.
--   * Covers every role that pings (incl. operation_executive, which the nightly
--     recompute_all_ta_today does NOT cover).
--   * A rep's own evening-report share recomputes their day first (app side).
-- Also: daily purge of cron.job_run_details older than 7 days (log growth).
--
-- REVERT (back to per-ping): re-run supabase_phase34z67c_ta_trigger_revert.sql,
-- then SELECT cron.unschedule('recompute-ta-dirty'); and run
-- SELECT public.recompute_ta_dirty(); once to flush pending days.

CREATE TABLE IF NOT EXISTS public.ta_dirty (
  user_id   uuid        NOT NULL,
  work_date date        NOT NULL,
  marked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, work_date)
);
ALTER TABLE public.ta_dirty ENABLE ROW LEVEL SECURITY;   -- no policies: only definer functions touch it
REVOKE ALL ON public.ta_dirty FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.tg_recompute_ta_on_ping()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS NULL OR NEW.captured_at IS NULL THEN
    RETURN NEW;
  END IF;
  -- Phase 663: mark only; recompute_ta_dirty() (cron, every 10 min) does the work.
  INSERT INTO public.ta_dirty (user_id, work_date)
  VALUES (NEW.user_id, (NEW.captured_at AT TIME ZONE 'Asia/Kolkata')::date)
  -- DO UPDATE (not DO NOTHING): takes the row lock, so a ping racing a running
  -- recompute waits for its DELETE and re-marks the day instead of being missed.
  ON CONFLICT (user_id, work_date) DO UPDATE SET marked_at = now();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.recompute_ta_dirty()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  n int := 0;
BEGIN
  -- Take the batch first: pings arriving during this run re-mark their day for next time.
  FOR r IN DELETE FROM public.ta_dirty RETURNING user_id, work_date LOOP
    BEGIN
      PERFORM public.compute_daily_ta(r.user_id, r.work_date);
      n := n + 1;
    EXCEPTION WHEN OTHERS THEN
      -- keep it for the next run; one bad day must not block the rest
      INSERT INTO public.ta_dirty (user_id, work_date) VALUES (r.user_id, r.work_date)
      ON CONFLICT (user_id, work_date) DO NOTHING;
      RAISE WARNING 'Phase 663 recompute_ta_dirty failed for % %: %', r.user_id, r.work_date, SQLERRM;
    END;
  END LOOP;
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION public.recompute_ta_dirty() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('recompute-ta-dirty', '*/10 * * * *', $c$ SELECT public.recompute_ta_dirty(); $c$);
SELECT cron.schedule('cron-log-purge', '30 21 * * *',
  $c$ DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days'; $c$);

NOTIFY pgrst, 'reload schema';

-- VERIFY: expect ta_dirty_table=1, trigger_marks_only=true, batch_fn=1, cron_jobs=2
SELECT
  (SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='ta_dirty') AS ta_dirty_table,
  pg_get_functiondef('public.tg_recompute_ta_on_ping'::regproc) LIKE '%ta_dirty%'
    AND pg_get_functiondef('public.tg_recompute_ta_on_ping'::regproc) NOT LIKE '%PERFORM public.compute_daily_ta%' AS trigger_marks_only,
  (SELECT count(*) FROM pg_proc WHERE proname='recompute_ta_dirty') AS batch_fn,
  (SELECT count(*) FROM cron.job WHERE jobname IN ('recompute-ta-dirty','cron-log-purge')) AS cron_jobs;
