-- supabase_phase33j_hygiene.sql
--
-- Phase 33J hygiene batch:
--   1. EXPIRED status auto-flag for stale quotes (cron via pg_cron OR
--      run manually from admin dashboard).
--   2. N1 verification — check whether any work_sessions row has
--      is_off_day=true WITHOUT a corresponding leaves row. If yes,
--      backfill them so the score function (which no longer reads
--      is_off_day after Phase 33I) doesn't silently re-count those
--      days as workdays.
--
-- Idempotent.

-- ─── 1. EXPIRED status auto-flag ─────────────────────────────────
-- Quotes that have a valid_until date in the past AND are still in
-- a non-terminal status (draft / sent / negotiating) get flagged as
-- expired. We don't change quotes.status (that enum doesn't include
-- 'expired' yet — Phase 1 schema). Instead we use a derived column
-- "is_expired" that the UI surfaces as a chip.
--
-- Adding a real "expired" enum value would force a CHECK constraint
-- migration on every existing row, and the owner has explicitly
-- locked the quote status enum (CLAUDE.md §23 known gap 3).
-- Derived flag keeps the data clean while still surfacing the state.

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS is_expired boolean DEFAULT false;

CREATE OR REPLACE FUNCTION public.refresh_expired_quotes()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  -- Flag newly-expired quotes.
  UPDATE public.quotes
     SET is_expired = true
   WHERE valid_until IS NOT NULL
     AND valid_until < CURRENT_DATE
     AND status IN ('draft', 'sent', 'negotiating')
     AND is_expired = false;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Un-flag if quote got moved to won/lost (status flipped after
  -- expiry — admin worked it back into the pipeline).
  UPDATE public.quotes
     SET is_expired = false
   WHERE is_expired = true
     AND status IN ('won', 'lost');

  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public.refresh_expired_quotes() TO authenticated;

-- Run it once now to backfill existing expired quotes.
SELECT public.refresh_expired_quotes() AS newly_flagged_expired;

-- ─── 2. N1 verification: orphan is_off_day rows ──────────────────
-- After Phase 33I dropped the is_off_day fallback from compute_daily_score,
-- any work_sessions row with is_off_day=true that didn't have a
-- corresponding leaves row would silently re-count as a workday.
-- The Phase 33G.8 backfill INSERTed leaves for every such row, but
-- new is_off_day=true rows could appear if any old code path is still
-- writing them. This SELECT finds them. Empty result = clean.
--
-- If non-empty, run the INSERT block below it to catch them up.

DO $$
DECLARE
  v_orphans int;
BEGIN
  SELECT COUNT(*) INTO v_orphans
    FROM work_sessions ws
   WHERE ws.is_off_day = true
     AND NOT EXISTS (
       SELECT 1 FROM leaves l
        WHERE l.user_id    = ws.user_id
          AND l.leave_date = ws.work_date
     );
  RAISE NOTICE 'N1 audit: % work_sessions rows with is_off_day=true have NO leaves row', v_orphans;
END $$;

-- Catch-up: copy any remaining is_off_day=true rows into leaves.
-- Idempotent because of ON CONFLICT.
INSERT INTO public.leaves (user_id, leave_date, leave_type, reason, status, created_by, created_at)
SELECT
  ws.user_id,
  ws.work_date,
  'personal',
  COALESCE(NULLIF(ws.off_reason, ''), 'Catch-up backfill (Phase 33J)'),
  'approved',
  ws.user_id,
  COALESCE(ws.created_at, now())
  FROM work_sessions ws
 WHERE ws.is_off_day = true
   AND ws.work_date IS NOT NULL
ON CONFLICT (user_id, leave_date) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- VERIFY:
-- 1. Expired flag count:
--    SELECT COUNT(*) FROM quotes WHERE is_expired = true;
-- 2. Orphan is_off_day count after catch-up — should be 0:
--    SELECT COUNT(*) FROM work_sessions ws
--    WHERE ws.is_off_day = true
--      AND NOT EXISTS (SELECT 1 FROM leaves l
--        WHERE l.user_id=ws.user_id AND l.leave_date=ws.work_date);
