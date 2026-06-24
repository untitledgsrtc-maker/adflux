-- =====================================================
-- UNTITLED ADFLUX — PHASE 2 SCHEMA ADDITIONS (IDEMPOTENT)
-- =====================================================
-- RUN THIS ONCE in your Supabase SQL Editor AFTER Phase 1.
-- This file is ADDITIVE and SAFE TO RE-RUN — it drops and
-- recreates policies/triggers/functions so if you ran an
-- earlier version and got the "policy already exists" error,
-- just run this whole file again.
-- =====================================================

-- =====================================================
-- 1. INCENTIVE PAYOUTS — admin punches actual paid amounts
--    (full or partial) against a staff/month.
-- =====================================================

CREATE TABLE IF NOT EXISTS incentive_payouts (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_id          uuid REFERENCES users(id) ON DELETE CASCADE,
  month_year        text NOT NULL,                 -- 'YYYY-MM'
  amount_paid       numeric NOT NULL,
  is_full_payment   boolean DEFAULT false,
  note              text,
  paid_date         date DEFAULT CURRENT_DATE,
  paid_by           uuid REFERENCES users(id),
  created_at        timestamptz DEFAULT now()
);

ALTER TABLE incentive_payouts ENABLE ROW LEVEL SECURITY;

-- Drop first so re-running is safe
DROP POLICY IF EXISTS "ip_admin_all" ON incentive_payouts;
DROP POLICY IF EXISTS "ip_sales_own" ON incentive_payouts;

CREATE POLICY "ip_admin_all" ON incentive_payouts FOR ALL
  USING (get_my_role() = 'admin');

CREATE POLICY "ip_sales_own" ON incentive_payouts FOR SELECT
  USING (get_my_role() = 'sales' AND staff_id = auth.uid());

-- =====================================================
-- 2. PAYMENT POLICIES — sales can now add/edit/delete
--    their OWN non-final payments on their OWN quotes.
-- =====================================================

DROP POLICY IF EXISTS "payments_sales_update_own" ON payments;
DROP POLICY IF EXISTS "payments_sales_delete_own" ON payments;

-- Sales UPDATE: allowed only if the row is currently non-final
-- AND stays non-final AND belongs to the sales user's own quote.
CREATE POLICY "payments_sales_update_own" ON payments FOR UPDATE
  USING (
    get_my_role() = 'sales'
    AND is_final_payment = false
    AND quote_id IN (SELECT id FROM quotes WHERE created_by = auth.uid())
  )
  WITH CHECK (
    get_my_role() = 'sales'
    AND is_final_payment = false
    AND quote_id IN (SELECT id FROM quotes WHERE created_by = auth.uid())
  );

-- Sales DELETE: allowed only if the row is non-final AND belongs
-- to the sales user's own quote.
CREATE POLICY "payments_sales_delete_own" ON payments FOR DELETE
  USING (
    get_my_role() = 'sales'
    AND is_final_payment = false
    AND quote_id IN (SELECT id FROM quotes WHERE created_by = auth.uid())
  );

-- =====================================================
-- 3. FINAL-PAYMENT RECALC — the original trigger only fired on
--    INSERT / UPDATE-to-true. We now also need to REVERSE the
--    monthly_sales_data credit if a final payment is edited or
--    deleted.
-- =====================================================

-- When a final payment is UPDATED (e.g. amount changed, or final
-- flag turned OFF), this function rebuilds monthly_sales_data for
-- that staff+month from scratch. Safer than diffing.
-- -------------------------------------------------------------------------
-- rebuild_monthly_sales REMOVED from this file (Phase 178).
-- Canonical: db/functions/rebuild_monthly_sales.sql (MONEY — sales ledger core).
-- Do NOT re-add it here. Edit the canonical file only (§71).
-- -------------------------------------------------------------------------

-- Handle UPDATE: if the payment's final flag or amount changed,
-- or if it moved between months, rebuild affected month(s).
-- -------------------------------------------------------------------------
-- handle_payment_update REMOVED from this file (Phase 178).
-- Canonical: db/functions/handle_payment_update.sql (MONEY — payment->monthly_sales sync).
-- Do NOT re-add it here. Edit the canonical file only (§71). Trigger wiring stays.
-- -------------------------------------------------------------------------

DROP TRIGGER IF EXISTS payments_update_recalc ON payments;
CREATE TRIGGER payments_update_recalc
  AFTER UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION handle_payment_update();

-- Handle DELETE: if a final payment is removed, rebuild its month.
-- -------------------------------------------------------------------------
-- handle_payment_delete REMOVED from this file (Phase 178).
-- Canonical: db/functions/handle_payment_delete.sql (MONEY — payment->monthly_sales sync).
-- Do NOT re-add it here. Edit the canonical file only (§71). Trigger wiring stays.
-- -------------------------------------------------------------------------

DROP TRIGGER IF EXISTS payments_delete_recalc ON payments;
CREATE TRIGGER payments_delete_recalc
  AFTER DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION handle_payment_delete();

-- =====================================================
-- 4. REALTIME — add incentive_payouts so the dashboard
--    reflects paid-out incentive live.
-- =====================================================

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.incentive_payouts;
        EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.follow_ups;
        EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.quote_cities;
        EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- =====================================================
-- DONE. No data was changed. Safe to re-run this whole
-- file again if anything errors next time.
-- =====================================================
