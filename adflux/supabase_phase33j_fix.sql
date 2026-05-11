-- supabase_phase33j_fix.sql
--
-- Phase 33J fix — quotes table has no valid_until column. I assumed
-- it did when writing supabase_phase33j_hygiene.sql. The first SELECT
-- failed and rolled back the entire transaction, so the N1 catch-up
-- didn't run either.
--
-- This file replaces both. Run this INSTEAD of the original 33J file.
-- Safe even if you already ran the original (idempotent).
--
-- What changed from the original:
--   1. refresh_expired_quotes() now derives expiry from
--      `created_at + 30 days` instead of a nonexistent valid_until
--      column. 30 days is a reasonable default for quote validity
--      in this business (owner can override later by adding a real
--      valid_until column).
--   2. Added DROP COLUMN guard — if is_expired wasn't created yet
--      on a fresh run, CREATE COLUMN IF NOT EXISTS handles it.
--   3. N1 catch-up runs unconditionally at the end so the failed
--      original transaction's missing INSERT actually lands.

-- ─── 1. is_expired column (re-create-safe) ────────────────────────
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS is_expired boolean DEFAULT false;

-- ─── 2. refresh_expired_quotes — derived expiry ──────────────────
CREATE OR REPLACE FUNCTION public.refresh_expired_quotes()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  -- A quote is "expired" if it's been in a non-terminal status for
  -- more than 30 days since creation. No valid_until column exists
  -- in the schema; this is the most defensible proxy.
  -- (Owner can switch to a real valid_until column later by adding
  -- it and updating this function.)
  UPDATE public.quotes
     SET is_expired = true
   WHERE created_at < (CURRENT_DATE - INTERVAL '30 days')
     AND status IN ('draft', 'sent', 'negotiating')
     AND is_expired = false;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Un-flag if quote got moved to won/lost.
  UPDATE public.quotes
     SET is_expired = false
   WHERE is_expired = true
     AND status IN ('won', 'lost');

  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public.refresh_expired_quotes() TO authenticated;

-- Run it once to backfill flags.
SELECT public.refresh_expired_quotes() AS newly_flagged_expired;

-- ─── 3. N1 catch-up: orphan is_off_day → leaves ──────────────────
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
-- 1. Expired flag count (likely 0 if all quotes are fresh):
--    SELECT COUNT(*) FROM quotes WHERE is_expired = true;
--    SELECT COUNT(*) FROM quotes WHERE created_at < CURRENT_DATE - 30
--      AND status IN ('draft','sent','negotiating');
-- 2. Orphan is_off_day count after catch-up — should be 0:
--    SELECT COUNT(*) FROM work_sessions ws
--     WHERE ws.is_off_day = true
--       AND NOT EXISTS (SELECT 1 FROM leaves l
--         WHERE l.user_id=ws.user_id AND l.leave_date=ws.work_date);
