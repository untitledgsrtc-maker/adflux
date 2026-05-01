-- =====================================================================
-- ADFLUX → UNTITLED OS  •  PHASE 4F  (Sprint 1 fix-up)
-- Migration: complete the payments RLS — close gaps left by phase4e
-- =====================================================================
--
-- WHY THIS EXISTS:
--   Phase 4E updated the sales-side RLS for quotes / quote_cities /
--   payments-read / payments-insert / follow_ups, but missed two things:
--
--   1. The original phase3c `payments_sales_insert_own` policy required
--      `approval_status = 'pending'` on insert — preventing a sales rep
--      from inserting a payment as already-approved and bypassing
--      admin review. Phase4E dropped+recreated this policy WITHOUT that
--      guard, opening a hole. This migration restores it.
--
--   2. Phase 3C also added `payments_sales_update_own` (UPDATE) and
--      `payments_sales_delete_own` (DELETE) policies. Phase4E never
--      touched these, so they still enforce ownership but NOT segment
--      scope. A Private rep with a payment row's UUID could in
--      principle update or delete a payment on a Government quote.
--      This migration adds the segment check.
--
-- WHAT EACH RESTORED RULE MEANS IN PLAIN LANGUAGE:
--
--   INSERT — A sales rep can record a new payment only when:
--     (a) the quote belongs to them,
--     (b) the payment goes in as 'pending' (admin must approve before
--         it counts toward revenue/incentive), and
--     (c) the quote is in their segment (Private rep cannot record
--         payments for Government quotes, and vice versa).
--
--   UPDATE — A sales rep can edit a payment only when:
--     (a) the quote belongs to them,
--     (b) the row is still pending (once approved/rejected, only
--         admin can touch it),
--     (c) it's not a final-payment row (final flag is sensitive), and
--     (d) the quote is in their segment.
--
--   DELETE — A sales rep can delete a payment only when ALL of the
--   above are true (own quote, pending, not final, segment match).
--
-- ADMIN policies are untouched — admin retains full access regardless
-- of segment.
--
-- IDEMPOTENT: drop + create with same policy names.
-- =====================================================================


-- 1) PAYMENTS INSERT — restore pending-only + add segment check ------
DROP POLICY IF EXISTS "payments_sales_insert_own" ON public.payments;
CREATE POLICY "payments_sales_insert_own" ON public.payments FOR INSERT
  WITH CHECK (
    public.get_my_role() = 'sales'
    AND approval_status = 'pending'
    AND quote_id IN (
      SELECT id FROM public.quotes
       WHERE created_by = auth.uid()
         AND public.get_my_segment_access() IN ('ALL', segment)
    )
  );


-- 2) PAYMENTS UPDATE — preserve pending+non-final + add segment check
DROP POLICY IF EXISTS "payments_sales_update_own" ON public.payments;
CREATE POLICY "payments_sales_update_own" ON public.payments FOR UPDATE
  USING (
    public.get_my_role() = 'sales'
    AND is_final_payment = false
    AND approval_status  = 'pending'
    AND quote_id IN (
      SELECT id FROM public.quotes
       WHERE created_by = auth.uid()
         AND public.get_my_segment_access() IN ('ALL', segment)
    )
  )
  WITH CHECK (
    public.get_my_role() = 'sales'
    AND is_final_payment = false
    AND approval_status  = 'pending'
    AND quote_id IN (
      SELECT id FROM public.quotes
       WHERE created_by = auth.uid()
         AND public.get_my_segment_access() IN ('ALL', segment)
    )
  );


-- 3) PAYMENTS DELETE — preserve pending+non-final + add segment check
DROP POLICY IF EXISTS "payments_sales_delete_own" ON public.payments;
CREATE POLICY "payments_sales_delete_own" ON public.payments FOR DELETE
  USING (
    public.get_my_role() = 'sales'
    AND is_final_payment = false
    AND approval_status  = 'pending'
    AND quote_id IN (
      SELECT id FROM public.quotes
       WHERE created_by = auth.uid()
         AND public.get_my_segment_access() IN ('ALL', segment)
    )
  );


-- =====================================================================
-- VERIFY:
--
--   SELECT tablename, policyname, cmd
--     FROM pg_policies
--    WHERE schemaname = 'public'
--      AND tablename = 'payments'
--      AND policyname LIKE '%sales%'
--    ORDER BY policyname;
--
--   -- expect 4 rows:
--   --   payments | payments_sales_delete_own | DELETE
--   --   payments | payments_sales_insert_own | INSERT
--   --   payments | payments_sales_read_own   | SELECT
--   --   payments | payments_sales_update_own | UPDATE
--
--   -- And re-run the full sprint-1 check:
--   SELECT tablename, policyname, cmd
--     FROM pg_policies
--    WHERE schemaname = 'public'
--      AND tablename IN ('quotes', 'quote_cities', 'payments', 'follow_ups')
--      AND policyname LIKE '%sales%'
--    ORDER BY tablename, policyname;
--   -- expect 7 rows total.
-- =====================================================================
