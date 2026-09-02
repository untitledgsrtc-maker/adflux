-- ============================================================================
-- supabase_phase277_cash_in_month.sql — my_cash_in_month RPC (owner 2026-09-02).
-- ============================================================================
-- The day-summary "Collected" line (my_quotes_won_month, phase238) counts only a
-- deal's FINAL, fully-approved payment this month → a rep who takes a PARTIAL
-- installment sees "Collected 0" even though real cash came in (Rima: won a ₹6k
-- deal, collected a ₹3k partial → Collected showed 0). This adds a companion
-- "Cash in" metric = ALL approved payments this month (partials + finals),
-- summed by amount_received — the actual money received.
--
-- Same self-scoped DEFINER pattern + same rep attribution (q.created_by =
-- auth.uid()) as my_quotes_won_month, so a telecaller (no direct payments RLS
-- policy) still gets their own figure. ADDITIVE — does NOT touch my_quotes_won_month
-- or "Collected". Display-only; no pay/score input. Idempotent. Owner runs it.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.my_cash_in_month(p_month text)   -- 'YYYY-MM'
RETURNS TABLE (cash_count int, cash_amount numeric)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT COALESCE(count(*), 0)::int,
         COALESCE(sum(p.amount_received), 0)
    FROM public.payments p
    JOIN public.quotes  q ON q.id = p.quote_id
   WHERE q.created_by = auth.uid()
     AND p.approval_status = 'approved'
     AND to_char(p.payment_date, 'YYYY-MM') = p_month;
$$;

REVOKE EXECUTE ON FUNCTION public.my_cash_in_month(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.my_cash_in_month(text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY (as a rep, or in Studio auth.uid() is NULL → 0/0, expected there):
--   SELECT * FROM public.my_cash_in_month('2026-09');
-- Cross-check a rep: sum of every approved payment this month on their own quotes.
-- ============================================================================
