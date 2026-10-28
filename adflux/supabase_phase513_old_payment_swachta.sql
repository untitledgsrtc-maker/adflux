-- Phase 513 - mark the old (pre-CRM) GSRTC credit "Swachta Order Before march" Rs 8,42,985 (28-10-2026) as revenue.
-- Owner: it is an old payment from before the CRM, amount WITHOUT GST. Reconcile no longer lists it as "not in CRM".
UPDATE public.finance_transactions
   SET counts_as_revenue = true, reconcile_ignored = true
 WHERE bucket = 'income' AND direction = 'in' AND media_type = 'GSRTC_LED'
   AND txn_date = DATE '2026-10-28' AND amount = 842985 AND description ILIKE 'Swachta Order Before march%';
-- UNDO: UPDATE public.finance_transactions SET counts_as_revenue=false, reconcile_ignored=false WHERE id = '<that row id>';
-- VERIFY: SELECT count(*) FROM public.finance_transactions WHERE counts_as_revenue;   -- 1
