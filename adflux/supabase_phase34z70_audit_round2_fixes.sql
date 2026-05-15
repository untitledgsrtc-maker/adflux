-- supabase_phase34z70_audit_round2_fixes.sql
-- Phase 34Z.70 — audit round-2 fixes.
-- 16 May 2026
--
-- Two SQL-side fixes from owner's second audit pass:
--
-- #6 (P2) — daily_performance only counted activity_type='meeting'.
--   Reps with many calls/site visits saw "No score yet this month."
--   Broaden the count to include 'call', 'meeting', 'site_visit'.
--   Phone calls + on-site visits ARE the rep's primary activities;
--   excluding them under-rewarded the road team.
--
-- #15 (P1) — per-task push triggers (Phase 34Z.55) had no audit
--   surface when notify-rep returns 5xx. Now that push_log records
--   every enqueue attempt (Phase 34Z.69), add a view that joins
--   push_log with net._http_response so admin can grep failures in
--   one query.
--
-- Idempotent.

-- ─── 1. compute_daily_score — count call + meeting + site_visit ──
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
  v_dow := EXTRACT(DOW FROM p_date)::int;
  IF v_dow = 0 THEN
    v_excluded := true;
    v_reason   := 'Sunday';
  END IF;

  IF NOT v_excluded AND EXISTS (
    SELECT 1 FROM holidays
    WHERE holiday_date = p_date AND is_active = true
  ) THEN
    v_excluded := true;
    SELECT name INTO v_reason FROM holidays
      WHERE holiday_date = p_date AND is_active = true LIMIT 1;
    v_reason := COALESCE('Holiday: ' || v_reason, 'Holiday');
  END IF;

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

  SELECT daily_targets INTO v_targets FROM users WHERE id = p_user_id;
  v_target := COALESCE((v_targets->>'meetings')::int, 5);

  -- Phase 34Z.70 fix #6 — count meeting + call + site_visit. Reps
  -- doing 10 calls and 1 meeting now get score for 11 touches, not
  -- 1. WhatsApp + notes intentionally excluded — those are async
  -- and don't represent the field-time the score is supposed to
  -- reward.
  SELECT COUNT(*)
    INTO v_done
    FROM lead_activities la
   WHERE la.created_by    = p_user_id
     AND la.activity_type IN ('meeting', 'call', 'site_visit')
     AND (la.created_at AT TIME ZONE 'Asia/Kolkata')::date = p_date;

  IF v_target = 0 THEN
    v_pct := 100;
  ELSE
    v_pct := LEAST(100, (v_done::numeric / v_target::numeric) * 100);
  END IF;

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


-- ─── 2. push_failures view (fix #15) ─────────────────────────────
-- Read-only view joining push_log to net._http_response so admin
-- can SELECT * FROM push_failures and see every push that didn't
-- 2xx in the last 7 days. No retry mechanism yet — visibility first,
-- retry can come later if needed.
CREATE OR REPLACE VIEW public.push_failures AS
SELECT
  pl.id                 AS log_id,
  pl.request_id,
  pl.user_id,
  pl.title,
  pl.body,
  pl.url,
  pl.tag,
  pl.enqueued_at,
  r.status_code,
  r.content::text       AS response_body,
  r.timed_out           AS timed_out
FROM public.push_log pl
LEFT JOIN net._http_response r ON r.id = pl.request_id
WHERE pl.enqueued_at >= now() - INTERVAL '7 days'
  AND (
    r.status_code IS NULL                -- still pending / lost
    OR r.status_code NOT BETWEEN 200 AND 299
  );

GRANT SELECT ON public.push_failures TO authenticated;


-- ─── 3. Re-backfill current month so the broader-activity score
--      shows up immediately on /my-performance ─────────────────
SELECT public.backfill_daily_performance_month();


NOTIFY pgrst, 'reload schema';

-- VERIFY
SELECT
  (SELECT count(*) FROM pg_proc WHERE proname = 'compute_daily_score')        AS fn_present,
  (SELECT count(*) FROM information_schema.views
    WHERE table_schema = 'public' AND table_name = 'push_failures')           AS view_present;
