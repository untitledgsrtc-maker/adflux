-- supabase_phase238_quotes_won_month.sql
--
-- Phase 238 — "quotes won this month" for the CALLING rep, by the TRUE win date.
--
-- The day-summary report counted won = `quotes.status='won' AND updated_at in
-- month`. `updated_at` bumps on ANY later touch, so a July payment on a
-- June-won deal re-dated it into July; and a `status='won'` quote with NO
-- payment counted too. Owner confirmed (15 Jul): Dhara's "won ₹1.3L this month"
-- was 2 June wins (re-dated) + 1 no-payment quote.
--
-- The TRUE win = a FINAL, APPROVED payment whose `payment_date` is in the month
-- (the SAME rule as rebuild_monthly_sales / incentive — §71 single definition),
-- credited to `quotes.created_by`.
--
-- WHY A DEFINER RPC (not a client payments query): a telecaller may not have a
-- direct read policy on `payments` (the widened Phase 28c policy is unconfirmed
-- live; `my_chase_counts` is a DEFINER RPC for exactly this reason). A raw
-- client query would silently return 0 for a TC — a worse regression than the
-- over-count. This RPC is SECURITY DEFINER, HARD-SCOPED to
-- `q.created_by = auth.uid()` (the rep only ever counts THEIR OWN quotes' wins;
-- NULL uid → 0; anon REVOKED). Read-only, additive.

CREATE OR REPLACE FUNCTION public.my_quotes_won_month(p_month text)   -- 'YYYY-MM'
RETURNS TABLE (won_count int, won_amount numeric)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH won AS (
    SELECT DISTINCT p.quote_id
      FROM public.payments p
      JOIN public.quotes q ON q.id = p.quote_id
     WHERE q.created_by = auth.uid()
       AND p.is_final_payment = true
       AND p.approval_status = 'approved'
       AND to_char(p.payment_date, 'YYYY-MM') = p_month
  )
  SELECT COALESCE(count(*), 0)::int,
         COALESCE(sum(q.total_amount), 0)
    FROM won w
    JOIN public.quotes q ON q.id = w.quote_id;
$$;

REVOKE EXECUTE ON FUNCTION public.my_quotes_won_month(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.my_quotes_won_month(text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY (run as a rep, or in Studio it uses the service role so auth.uid() is
-- NULL → returns 0/0, which is expected there):
--   SELECT * FROM public.my_quotes_won_month('2026-07');
-- Cross-check one rep against the ledger:
--   SELECT q.created_by, count(DISTINCT p.quote_id) AS wins, sum(q.total_amount)
--     FROM public.payments p JOIN public.quotes q ON q.id = p.quote_id
--    WHERE p.is_final_payment AND p.approval_status='approved'
--      AND to_char(p.payment_date,'YYYY-MM')='2026-07'
--    GROUP BY q.created_by;
