-- Finance: WIPE ALL — clean slate for re-import
-- Deletes every bank transaction + every import-batch log.
-- Keeps the /finance module, tables, RLS, seeds (heads/banks/rules/tasks).
-- Idempotent: re-running is safe (0 rows the second time).

BEGIN;

DELETE FROM public.finance_transactions;
DELETE FROM public.finance_import_batches;

COMMIT;

-- VERIFY: both should be 0
SELECT
  (SELECT count(*) FROM public.finance_transactions) AS txns_left,
  (SELECT count(*) FROM public.finance_import_batches) AS batches_left;
