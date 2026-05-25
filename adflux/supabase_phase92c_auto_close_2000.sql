-- =====================================================================
-- Phase 92c — 20:00 IST hard auto-close for open work_sessions
-- 24 May 2026
--
-- WHY
--
-- Owner directive (24 May 2026):
--   "auto-checkout at 20:00 IST becs TA also calculating so"
--
-- daily_ta computation cuts at 20:00 IST. Sessions still open past
-- that point (rep forgot to check out) break TA accuracy. Auto-close
-- those sessions at 20:00 IST with the rep's last known GPS ping as
-- the checkout location.
--
-- The 20:00 cutoff is owner-decided and tied to the TA window — do
-- NOT change without explicit re-approval.
--
-- WHAT
--
-- 1. New column: work_sessions.check_out_source text — tracks how the
--    checkout happened. Values:
--       'manual'      — rep tapped Check Out button on /work
--       'auto_share'  — rep tapped Share summary (Phase 92a chained)
--       'auto_cron'   — this cron stamped it because rep forgot
--    Defaults to NULL on existing rows; backfill not attempted (admin
--    can infer manual from history).
--
-- 2. Helper function: auto_close_open_sessions() — for every open
--    session today (check_in_at NOT NULL AND check_out_at IS NULL),
--    stamp check_out_at = now() + last-known GPS from gps_pings +
--    mark check_out_source = 'auto_cron'. SECURITY DEFINER so the
--    pg_cron worker can write across users.
--
-- 3. Schedule via pg_cron at 14:30 UTC daily (= 20:00 IST). Same
--    pattern as Phase 34Z.61 morning push.
--
-- Idempotent. Re-runnable.
-- =====================================================================

-- ─── 1. check_out_source column ─────────────────────────────────────
ALTER TABLE public.work_sessions
  ADD COLUMN IF NOT EXISTS check_out_source text
    CHECK (check_out_source IS NULL
        OR check_out_source IN ('manual', 'auto_share', 'auto_cron'));

COMMENT ON COLUMN public.work_sessions.check_out_source IS
  'How the rep checked out. NULL = legacy / pre-Phase-92c. '
  '''manual'' = tapped Check Out button. ''auto_share'' = chained '
  'from Share summary (Phase 92a). ''auto_cron'' = 20:00 IST hard-close.';


-- ─── 2. auto_close_open_sessions() ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.auto_close_open_sessions()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date;
  v_count int;
BEGIN
  -- "Today IST" — strip time, anchored to Asia/Kolkata.
  v_today := (now() AT TIME ZONE 'Asia/Kolkata')::date;

  WITH last_ping AS (
    SELECT DISTINCT ON (user_id)
      user_id, lat, lng
    FROM public.gps_pings
    WHERE captured_at >= (v_today::timestamp AT TIME ZONE 'Asia/Kolkata')
      AND captured_at <  ((v_today + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')
    ORDER BY user_id, captured_at DESC
  ),
  upd AS (
    UPDATE public.work_sessions ws
       SET check_out_at        = now(),
           check_out_gps_lat   = COALESCE(lp.lat, ws.check_in_gps_lat),
           check_out_gps_lng   = COALESCE(lp.lng, ws.check_in_gps_lng),
           check_out_source    = 'auto_cron'
      FROM (SELECT * FROM last_ping) lp
     WHERE ws.work_date    = v_today
       AND ws.check_in_at  IS NOT NULL
       AND ws.check_out_at IS NULL
       AND ws.user_id      = lp.user_id
    RETURNING ws.id
  )
  SELECT count(*) INTO v_count FROM upd;

  -- Sessions with NO ping today — still close them, just with NULL GPS
  -- (better than leaving session open and breaking TA).
  UPDATE public.work_sessions ws
     SET check_out_at        = now(),
         check_out_gps_lat   = ws.check_in_gps_lat,
         check_out_gps_lng   = ws.check_in_gps_lng,
         check_out_source    = 'auto_cron'
   WHERE ws.work_date    = v_today
     AND ws.check_in_at  IS NOT NULL
     AND ws.check_out_at IS NULL;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_close_open_sessions() TO authenticated;


-- ─── 3. Schedule cron at 14:30 UTC = 20:00 IST ──────────────────────
-- Re-runnable: unschedule then schedule.
DO $$
BEGIN
  PERFORM cron.unschedule('untitled-auto-close-2000');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'untitled-auto-close-2000',
  '30 14 * * *',  -- 14:30 UTC = 20:00 IST daily
  $$ SELECT public.auto_close_open_sessions(); $$
);

NOTIFY pgrst, 'reload schema';


-- ─── VERIFY ─────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'work_sessions'
      AND column_name = 'check_out_source')                AS col_exists,
  (SELECT count(*) FROM pg_proc
    WHERE proname = 'auto_close_open_sessions')            AS fn_exists,
  (SELECT count(*) FROM cron.job
    WHERE jobname = 'untitled-auto-close-2000')            AS cron_present,
  -- Sessions that WOULD auto-close right now (preview).
  (SELECT count(*) FROM public.work_sessions
    WHERE work_date    = (now() AT TIME ZONE 'Asia/Kolkata')::date
      AND check_in_at  IS NOT NULL
      AND check_out_at IS NULL)                            AS would_close_now;
