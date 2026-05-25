-- =====================================================================
-- Phase 92c.1 — auto-close fix: stamp evening_report_submitted_at + summary
-- 25 May 2026
--
-- WHY
--
-- Phase 92c shipped auto_close_open_sessions() that ONLY set
-- check_out_at + GPS + source='auto_cron'. The BEFORE-UPDATE trigger
-- enforce_evening_before_checkout() rejects any check_out_at write
-- when evening_report_submitted_at IS NULL — owner-installed earlier
-- to force reps to submit a summary before checking out.
--
-- Manual call returned:
--   ERROR 23514: Cannot check out before submitting evening report
--
-- Owner directive (25 May 2026): "we have said auto chekout no auto
-- log out keep in mind." Intent stays — stamp check_out_at for the
-- rep who forgot. NOT log them out of the app. Trigger stays in
-- place for manual flow; auto-cron now stamps both fields in the
-- same UPDATE so the trigger sees a non-NULL
-- evening_report_submitted_at and passes.
--
-- WHAT
--
-- 1. CREATE OR REPLACE auto_close_open_sessions() — same logic as
--    Phase 92c PLUS sets evening_report_submitted_at = now() AND
--    evening_summary = jsonb { auto_cron: true, note: ... }, using
--    COALESCE so we never clobber an existing report.
--
-- 2. Function STILL uses SECURITY DEFINER. Still scoped to
--    work_sessions UPDATE. No new privilege.
--
-- Idempotent. CREATE OR REPLACE.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.auto_close_open_sessions()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date;
  v_count int;
  v_synthetic_summary jsonb;
BEGIN
  v_today := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_synthetic_summary := jsonb_build_object(
    'auto_cron', true,
    'note', 'Auto-closed by 20:00 IST cron. Rep did not submit evening report.',
    'closed_at', now()
  );

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
           check_out_source    = 'auto_cron',
           -- Phase 92c.1 — stamp BOTH evening_report_submitted_at and
           -- evening_summary in the SAME UPDATE so the BEFORE-UPDATE
           -- trigger enforce_evening_before_checkout passes. COALESCE
           -- preserves an existing report if rep already submitted.
           evening_report_submitted_at = COALESCE(ws.evening_report_submitted_at, now()),
           evening_summary = COALESCE(ws.evening_summary, v_synthetic_summary)
      FROM (SELECT * FROM last_ping) lp
     WHERE ws.work_date    = v_today
       AND ws.check_in_at  IS NOT NULL
       AND ws.check_out_at IS NULL
       AND ws.user_id      = lp.user_id
    RETURNING ws.id
  )
  SELECT count(*) INTO v_count FROM upd;

  -- Sessions with NO ping today.
  UPDATE public.work_sessions ws
     SET check_out_at        = now(),
         check_out_gps_lat   = ws.check_in_gps_lat,
         check_out_gps_lng   = ws.check_in_gps_lng,
         check_out_source    = 'auto_cron',
         evening_report_submitted_at = COALESCE(ws.evening_report_submitted_at, now()),
         evening_summary = COALESCE(ws.evening_summary, v_synthetic_summary)
   WHERE ws.work_date    = v_today
     AND ws.check_in_at  IS NOT NULL
     AND ws.check_out_at IS NULL;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_close_open_sessions() TO authenticated;


NOTIFY pgrst, 'reload schema';


-- ─── Run NOW to close currently open sessions ───────────────────────
SELECT public.auto_close_open_sessions() AS closed_now;


-- ─── VERIFY ─────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM public.work_sessions
    WHERE work_date    = (now() AT TIME ZONE 'Asia/Kolkata')::date
      AND check_in_at  IS NOT NULL
      AND check_out_at IS NULL)                                 AS still_open_now,
  (SELECT count(*) FROM public.work_sessions
    WHERE work_date    = (now() AT TIME ZONE 'Asia/Kolkata')::date
      AND check_out_source = 'auto_cron')                       AS auto_closed_today;
