-- supabase_phase392_work_quiet_pc_timers.sql
-- Phase 392 (17 Oct 2026): a timer must not keep running after the person's PC went quiet.
-- Case: Safika's PC app recorded until 18:45 on 16 Oct but her timer (started 17:53) ran until 20:39.
-- PART 1 fixes that one entry (backup first). PART 2 adds a 10-minute sweep: a RUNNING entry that already has PC activity
-- slices, whose newest slice is older than 20 minutes, is stopped at that last slice + 1 minute (marked auto_stopped).
-- Phone-only entries have no slices, so they are never touched. Hours are reporting only (no pay effect). Idempotent.

-- ===== PART 1: trim Safika's 16 Oct entry to the last PC minute =====
CREATE TABLE IF NOT EXISTS public._bak_work_time_entries_p392 AS SELECT * FROM public.work_time_entries WHERE false;
ALTER TABLE public._bak_work_time_entries_p392 ENABLE ROW LEVEL SECURITY;
INSERT INTO public._bak_work_time_entries_p392
SELECT e.* FROM public.work_time_entries e
 WHERE e.id = '25efdcc6-3e85-4369-a20f-5b357dd6feaa'
   AND e.ended_at > '2026-10-16 18:46:00+05:30'
   AND NOT EXISTS (SELECT 1 FROM public._bak_work_time_entries_p392 b WHERE b.id = e.id);
UPDATE public.work_time_entries
   SET ended_at = '2026-10-16 18:46:00+05:30',
       note = COALESCE(note || ' · ', '') || 'Trimmed to last PC activity (18:45) - timer had kept running'
 WHERE id = '25efdcc6-3e85-4369-a20f-5b357dd6feaa'
   AND ended_at > '2026-10-16 18:46:00+05:30';

-- ===== PART 2: sweep =====
CREATE OR REPLACE FUNCTION public.work_stop_quiet_pc_timers() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_n int := 0;
BEGIN
  BEGIN
    WITH last_slice AS (
      SELECT s.entry_id, max(s.slice_start) AS last_at
        FROM public.work_activity_slices s
       WHERE s.entry_id IN (SELECT id FROM public.work_time_entries WHERE ended_at IS NULL)
       GROUP BY s.entry_id),
    stopped AS (
      UPDATE public.work_time_entries e
         SET ended_at = GREATEST(l.last_at + interval '1 minute', e.started_at + interval '1 second'),
             auto_stopped = true,
             note = COALESCE(e.note || ' · ', '') || 'Stopped: PC went quiet'
        FROM last_slice l
       WHERE e.id = l.entry_id AND e.ended_at IS NULL
         AND l.last_at < now() - interval '20 minutes'
      RETURNING 1)
    SELECT count(*) INTO v_n FROM stopped;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'work_stop_quiet_pc_timers failed: %', SQLERRM;
    v_n := 0;
  END;
  RETURN v_n;
END $$;
REVOKE EXECUTE ON FUNCTION public.work_stop_quiet_pc_timers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.work_stop_quiet_pc_timers() TO service_role;

SELECT cron.unschedule('work-stop-quiet-pc') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'work-stop-quiet-pc');
SELECT cron.schedule('work-stop-quiet-pc', '*/10 * * * *', $c$SELECT public.work_stop_quiet_pc_timers()$c$);
NOTIFY pgrst, 'reload schema';
-- VERIFY: SELECT (SELECT ended_at FROM work_time_entries WHERE id='25efdcc6-3e85-4369-a20f-5b357dd6feaa') AS fixed_end_utc,
--                (SELECT count(*) FROM cron.job WHERE jobname='work-stop-quiet-pc') AS cron,
--                has_function_privilege('anon','public.work_stop_quiet_pc_timers()','EXECUTE') AS anon_exec;  -- 18:46 IST / 1 / false
