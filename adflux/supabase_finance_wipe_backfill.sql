-- =====================================================================
-- FINANCE — wipe the loaded Apr–Jul backfill, start fresh (2026-08-07)
-- Owner: "i don't want that data, i will add new." Clears finance_transactions
-- so you can load your own via /finance → Import or + Add transaction.
-- SAFE: re-generable — re-run supabase_finance_p2_backfill.sql to get it back
-- (idempotent). This deletes ONLY transactions; banks / heads / rules / tasks stay.
-- =====================================================================

DELETE FROM public.finance_transactions;

-- VERIFY — should be 0
SELECT count(*) AS rows_left FROM public.finance_transactions;
