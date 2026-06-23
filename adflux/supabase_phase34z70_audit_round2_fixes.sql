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
-- -------------------------------------------------------------------------
-- compute_daily_score REMOVED from this file (Phase 178 consolidation).
-- The ONE canonical version now lives in: db/functions/compute_daily_score.sql
-- Do NOT re-add it here. To change the score, edit the canonical file only (§71).
-- -------------------------------------------------------------------------


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
