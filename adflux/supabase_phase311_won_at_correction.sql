-- ============================================================================
-- supabase_phase311_won_at_correction.sql
-- ----------------------------------------------------------------------------
-- FIX: on /quotes the Won tab shows EVERY won deal dated the same day
-- (e.g. "17 Aug 2026"). The Won-tab Date column shows quotes.won_at.
--
-- ROOT CAUSE: the Phase 311 (§214) one-time backfill dated existing won rows by
--   won_at = COALESCE(updated_at, created_at)
-- i.e. by LAST-TOUCH. A later bulk edit (a data backfill on 17 Aug) bumped every
-- quote's updated_at (via the update_updated_at trigger) to 17 Aug, so every
-- historical won deal's won_at collapsed to 17 Aug. Phase 311 itself flagged this
-- as needing "a separate one-time correction" — this is it.
--
-- THE FIX: re-derive won_at for existing won deals from the REAL win signal —
-- the FIRST approved payment_date (money-in ≈ when the deal closed), falling back
-- to created_at only when a won quote has no approved payment on file.
--
-- Going FORWARD nothing changes: the Phase 311 BEFORE-UPDATE trigger
-- (quote_stamp_won_at) already stamps won_at = now() on the actual
-- won-transition, so new wins are dated correctly on their own. This corrects
-- HISTORY only.
--
-- SAFE: won_at does NOT drive pay (incentive/salary read payments.payment_date via
-- rebuild_monthly_sales, unchanged). It drives (a) the /quotes Won-tab Date column
-- and (b) which MONTH a won deal is attributed to on the admin dashboard — both of
-- which are exactly what's wrong now and get CORRECTED here. Re-running the
-- UPDATE is idempotent (it recomputes the same value each time). The
-- quote_stamp_won_at trigger does NOT re-fire on this UPDATE (status stays 'won',
-- and NEW.won_at is set explicitly), so the correction sticks.
-- ============================================================================

-- ── PART 1 · DIAGNOSTIC (read-only) — see the damage BEFORE fixing ──────────
-- How many won quotes share each won_at date? A big count on one date = the bug.
SELECT won_at::date AS won_date, count(*) AS won_quotes
  FROM public.quotes
 WHERE status = 'won'
 GROUP BY won_at::date
 ORDER BY won_quotes DESC, won_date DESC;

-- ── PART 2 · THE CORRECTION ─────────────────────────────────────────────────
UPDATE public.quotes q
   SET won_at = COALESCE(
         (SELECT MIN(p.payment_date)
            FROM public.payments p
           WHERE p.quote_id = q.id
             AND p.approval_status = 'approved'
             AND p.payment_date IS NOT NULL),
         q.created_at)
 WHERE q.status = 'won';

NOTIFY pgrst, 'reload schema';

-- ── PART 3 · VERIFY — the dates should now be SPREAD across real months ─────
-- Expect: no single date holding most won deals; dates track each deal's first
-- approved payment (or its created_at where there was no payment).
SELECT won_at::date AS won_date, count(*) AS won_quotes
  FROM public.quotes
 WHERE status = 'won'
 GROUP BY won_at::date
 ORDER BY won_date DESC
 LIMIT 40;

-- Sanity: won deals still on file, and how many fell back to created_at
-- (i.e. won-but-no-approved-payment — a small number is normal).
SELECT
  count(*)                                                              AS won_total,
  count(*) FILTER (WHERE won_at::date = created_at::date)               AS dated_by_created_at,
  count(*) FILTER (WHERE won_at::date <> created_at::date)              AS dated_by_payment
  FROM public.quotes
 WHERE status = 'won';
-- ============================================================================
