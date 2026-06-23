-- supabase_phase33i_fixes.sql
--
-- Phase 33I — fixes for the audit issues B4, B5.
--
-- B4: leaves delete doesn't fully undo a backfilled leave.
--     Root cause: compute_daily_score has a fallback path that reads
--     work_sessions.is_off_day. After the leaves backfill, BOTH rows
--     exist. Deleting a leaves row leaves is_off_day=true in place.
--     The score function still excludes the day via fallback.
--
--     Fix: drop the is_off_day fallback entirely. leaves table is now
--     the only source of truth for off-days. work_sessions.is_off_day
--     column stays in the schema (we're not breaking historical data)
--     but stops being consulted by the score function.
--
--     Safe because the Phase 33G.8 backfill already copied every
--     is_off_day=true row into the leaves table. So the score function
--     reading leaves only is equivalent for all existing data, and
--     correct for all future data.
--
-- B5: Vadodara local work pays zero for bike. Owner's TA doc lists
--     only 20 travel cities — Vadodara HQ wasn't defined. I assumed
--     zero. Owner clarification: reps doing local Vadodara work
--     should still be reimbursed for actual km traveled.
--
--     Fix: home city → DA = 0 (no daily allowance for being home),
--     but bike_amount STILL = km × bike_per_km (real fuel/wear
--     reimbursement).
--
-- Idempotent: CREATE OR REPLACE on both functions.

-- ─── B4: drop is_off_day fallback ────────────────────────────────
-- -------------------------------------------------------------------------
-- compute_daily_score REMOVED from this file (Phase 178 consolidation).
-- The ONE canonical version now lives in: db/functions/compute_daily_score.sql
-- Do NOT re-add it here. To change the score, edit the canonical file only (§71).
-- -------------------------------------------------------------------------

-- ─── B5: Vadodara local work pays bike (DA still 0) ──────────────
-- -------------------------------------------------------------------------
-- compute_daily_ta REMOVED from this file (Phase 178).
-- Canonical: db/functions/compute_daily_ta.sql  (MONEY function — TA payout)
-- Do NOT re-add it here. Edit the canonical file only (§71). Trigger wiring
-- (per-ping TA recompute + claim-approve) stays in the phase files.
-- -------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.compute_daily_ta(uuid, date) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY:
-- 1. Drop a leave for a rep + day → score for that day re-includes
--    that day in the average (no fallback excluding it):
--      DELETE FROM leaves WHERE user_id='<rep>' AND leave_date='<d>';
--      SELECT compute_daily_score('<rep>', '<d>');
--      SELECT is_excluded FROM daily_performance
--        WHERE user_id='<rep>' AND work_date='<d>';
--      Expect: is_excluded = false (unless Sunday/holiday).
--
-- 2. Backfill Vadodara local day:
--      SELECT compute_daily_ta('<rep>', '<d>');
--      SELECT * FROM daily_ta WHERE user_id='<rep>' AND ta_date='<d>';
--      Expect: primary_city='Vadodara', da_amount=0, bike_amount > 0
--      if rep moved within Vadodara.
