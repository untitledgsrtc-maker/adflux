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
CREATE OR REPLACE FUNCTION rebuild_monthly_sales(p_staff uuid, p_month text)
RETURNS void AS $$
DECLARE
  new_rev numeric := 0;
  ren_rev numeric := 0;
BEGIN
  SELECT
    COALESCE(SUM(CASE WHEN q.revenue_type = 'new' THEN q.subtotal ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN q.revenue_type = 'renewal' THEN q.subtotal ELSE 0 END), 0)
  INTO new_rev, ren_rev
  FROM payments p
  JOIN quotes q ON q.id = p.quote_id
  WHERE p.is_final_payment = true
    AND q.created_by = p_staff
    AND to_char(p.payment_date, 'YYYY-MM') = p_month;

  INSERT INTO monthly_sales_data (staff_id, month_year, new_client_revenue, renewal_revenue)
  VALUES (p_staff, p_month, new_rev, ren_rev)
  ON CONFLICT (staff_id, month_year)
  DO UPDATE SET
    new_client_revenue = EXCLUDED.new_client_revenue,
    renewal_revenue    = EXCLUDED.renewal_revenue,
    updated_at         = now();
END;
$$ LANGUAGE plpgsql;

-- Handle UPDATE: if the payment's final flag or amount changed,
-- or if it moved between months, rebuild affected month(s).
CREATE OR REPLACE FUNCTION handle_payment_update()
RETURNS TRIGGER AS $$
DECLARE
  old_month text;
  new_month text;
  old_staff uuid;
  new_staff uuid;
BEGIN
  -- Only care about updates that touch the ledger.
  IF OLD.is_final_payment = false AND NEW.is_final_payment = false THEN
    RETURN NEW;
  END IF;

  SELECT created_by INTO old_staff FROM quotes WHERE id = OLD.quote_id;
  SELECT created_by INTO new_staff FROM quotes WHERE id = NEW.quote_id;

  old_month := to_char(OLD.payment_date, 'YYYY-MM');
  new_month := to_char(NEW.payment_date, 'YYYY-MM');

  -- Rebuild old side (covers: flag was true and is now false, or
  -- date moved to a different month, or quote assignment changed)
  IF OLD.is_final_payment = true THEN
    PERFORM rebuild_monthly_sales(old_staff, old_month);
  END IF;

  -- Rebuild new side (covers: flag just became true, or still true
  -- with changed amount/date/quote)
  IF NEW.is_final_payment = true
     AND (old_staff <> new_staff OR old_month <> new_month OR NOT (OLD.is_final_payment = true)) THEN
    PERFORM rebuild_monthly_sales(new_staff, new_month);
  ELSIF NEW.is_final_payment = true THEN
    -- same staff, same month, stayed-final — rebuild once to catch
    -- amount changes reflected via the quote's subtotal
    PERFORM rebuild_monthly_sales(new_staff, new_month);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payments_update_recalc ON payments;
CREATE TRIGGER payments_update_recalc
  AFTER UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION handle_payment_update();

-- Handle DELETE: if a final payment is removed, rebuild its month.
CREATE OR REPLACE FUNCTION handle_payment_delete()
RETURNS TRIGGER AS $$
DECLARE
  staff_uid uuid;
  month_str text;
BEGIN
  IF OLD.is_final_payment = true THEN
    SELECT created_by INTO staff_uid FROM quotes WHERE id = OLD.quote_id;
    month_str := to_char(OLD.payment_date, 'YYYY-MM');
    PERFORM rebuild_monthly_sales(staff_uid, month_str);
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

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
