-- =====================================================
-- UNTITLED ADFLUX — PHASE 3C SCHEMA ADDITIONS (IDEMPOTENT)
-- =====================================================
-- RUN THIS ONCE in your Supabase SQL Editor AFTER Phase 2.
-- This file is ADDITIVE and SAFE TO RE-RUN — it drops and
-- recreates policies/triggers/functions so re-running is fine.
--
-- WHAT IT DOES:
--   • Adds approval_status / approved_by / decided_at /
--     rejection_reason / sales_notified_at columns to payments.
--   • Backfills every existing row to approval_status='approved'
--     so historical revenue / incentive numbers don't change.
--   • Rewrites the payment triggers so monthly_sales_data only
--     counts payments where is_final_payment=true AND
--     approval_status='approved'.
--   • Tightens RLS: sales can only INSERT rows with
--     approval_status='pending' and can only EDIT/DELETE their
--     own still-pending rows. Only admins can approve/reject.
--   • Adds dismiss_payment_notification(uuid) RPC so a sales
--     user can clear their rejection banner (SECURITY DEFINER
--     so it can write sales_notified_at under RLS).
-- =====================================================

-- =====================================================
-- 1. NEW COLUMNS (idempotent via IF NOT EXISTS)
-- =====================================================

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS approval_status    text,
  ADD COLUMN IF NOT EXISTS approved_by        uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS decided_at         timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason   text,
  ADD COLUMN IF NOT EXISTS sales_notified_at  timestamptz;

-- Backfill — every pre-existing row is treated as already-approved
-- so we don't nuke historical revenue on the first migration run.
UPDATE payments
   SET approval_status = 'approved'
 WHERE approval_status IS NULL;

-- Lock the column down: NOT NULL + CHECK + DEFAULT 'pending' for
-- any future rows sales sends up.
DO $$ BEGIN
  ALTER TABLE payments ALTER COLUMN approval_status SET NOT NULL;
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE payments
    ADD CONSTRAINT payments_approval_status_chk
    CHECK (approval_status IN ('pending','approved','rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE payments ALTER COLUMN approval_status SET DEFAULT 'pending';

-- Helpful index for the admin "pending" queue.
CREATE INDEX IF NOT EXISTS payments_pending_idx
  ON payments (created_at DESC)
  WHERE approval_status = 'pending';

-- =====================================================
-- 2. REBUILD — rewrite rebuild_monthly_sales so it only
--    counts approved final payments.
-- =====================================================

CREATE OR REPLACE FUNCTION rebuild_monthly_sales(p_staff uuid, p_month text)
RETURNS void AS $$
DECLARE
  new_rev numeric := 0;
  ren_rev numeric := 0;
BEGIN
  SELECT
    COALESCE(SUM(CASE WHEN q.revenue_type = 'new'     THEN q.subtotal ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN q.revenue_type = 'renewal' THEN q.subtotal ELSE 0 END), 0)
  INTO new_rev, ren_rev
  FROM payments p
  JOIN quotes q ON q.id = p.quote_id
  WHERE p.is_final_payment = true
    AND p.approval_status  = 'approved'   -- NEW: approved only
    AND q.created_by       = p_staff
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

-- =====================================================
-- 3. INSERT TRIGGER — replace the old handle_final_payment
--    with one that's aware of approval_status.
-- =====================================================

DROP TRIGGER  IF EXISTS payments_final_trigger ON payments;
DROP FUNCTION IF EXISTS handle_final_payment();

CREATE OR REPLACE FUNCTION handle_payment_insert()
RETURNS TRIGGER AS $$
DECLARE
  staff_uid uuid;
  month_str text;
BEGIN
  -- Only credit revenue when the row lands as approved+final.
  -- (Admins recording payments get approval_status='approved'
  -- from the app; sales inserts come in as 'pending' and will
  -- be credited later via the UPDATE trigger at approval time.)
  IF NEW.is_final_payment = true
     AND NEW.approval_status = 'approved' THEN
    SELECT created_by INTO staff_uid FROM quotes WHERE id = NEW.quote_id;
    month_str := to_char(NEW.payment_date, 'YYYY-MM');
    PERFORM rebuild_monthly_sales(staff_uid, month_str);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payments_insert_recalc ON payments;
CREATE TRIGGER payments_insert_recalc
  AFTER INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION handle_payment_insert();

-- =====================================================
-- 4. UPDATE TRIGGER — now also reacts to approval_status
--    transitions (approve / reject / un-approve).
-- =====================================================

CREATE OR REPLACE FUNCTION handle_payment_update()
RETURNS TRIGGER AS $$
DECLARE
  old_counted boolean;
  new_counted boolean;
  old_staff   uuid;
  new_staff   uuid;
  old_month   text;
  new_month   text;
BEGIN
  old_counted := (OLD.is_final_payment = true AND OLD.approval_status = 'approved');
  new_counted := (NEW.is_final_payment = true AND NEW.approval_status = 'approved');

  -- If the row never touched the ledger in either state, no work.
  IF NOT old_counted AND NOT new_counted THEN
    RETURN NEW;
  END IF;

  SELECT created_by INTO old_staff FROM quotes WHERE id = OLD.quote_id;
  SELECT created_by INTO new_staff FROM quotes WHERE id = NEW.quote_id;
  old_month := to_char(OLD.payment_date, 'YYYY-MM');
  new_month := to_char(NEW.payment_date, 'YYYY-MM');

  -- Rebuild OLD side (removes the previous credit cleanly)
  IF old_counted THEN
    PERFORM rebuild_monthly_sales(old_staff, old_month);
  END IF;

  -- Rebuild NEW side (adds the new credit; safe to call even
  -- when staff+month are identical to OLD — rebuild is idempotent)
  IF new_counted
     AND (NOT old_counted OR old_staff <> new_staff OR old_month <> new_month) THEN
    PERFORM rebuild_monthly_sales(new_staff, new_month);
  ELSIF new_counted THEN
    -- Same staff+month: still rebuild once to pick up amount /
    -- quote reassignment edge cases.
    PERFORM rebuild_monthly_sales(new_staff, new_month);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payments_update_recalc ON payments;
CREATE TRIGGER payments_update_recalc
  AFTER UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION handle_payment_update();

-- =====================================================
-- 5. DELETE TRIGGER — only rebuild if the deleted row was
--    actually contributing (approved + final).
-- =====================================================

CREATE OR REPLACE FUNCTION handle_payment_delete()
RETURNS TRIGGER AS $$
DECLARE
  staff_uid uuid;
  month_str text;
BEGIN
  IF OLD.is_final_payment = true
     AND OLD.approval_status = 'approved' THEN
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
-- 6. RLS — sales can only INSERT with approval_status='pending',
--    can only EDIT/DELETE their own still-pending rows, and
--    CANNOT flip their own approval_status.
-- =====================================================

-- Keep admin-all policy; no change needed.

-- Rewrite sales-insert: forces 'pending'
DROP POLICY IF EXISTS "payments_sales_insert_own" ON payments;
CREATE POLICY "payments_sales_insert_own" ON payments FOR INSERT
  WITH CHECK (
    get_my_role() = 'sales'
    AND approval_status = 'pending'
    AND quote_id IN (SELECT id FROM quotes WHERE created_by = auth.uid())
  );

-- Rewrite sales-update: row must be pending AND stay pending
DROP POLICY IF EXISTS "payments_sales_update_own" ON payments;
CREATE POLICY "payments_sales_update_own" ON payments FOR UPDATE
  USING (
    get_my_role() = 'sales'
    AND is_final_payment = false
    AND approval_status  = 'pending'
    AND quote_id IN (SELECT id FROM quotes WHERE created_by = auth.uid())
  )
  WITH CHECK (
    get_my_role() = 'sales'
    AND is_final_payment = false
    AND approval_status  = 'pending'
    AND quote_id IN (SELECT id FROM quotes WHERE created_by = auth.uid())
  );

-- Rewrite sales-delete: only pending rows
DROP POLICY IF EXISTS "payments_sales_delete_own" ON payments;
CREATE POLICY "payments_sales_delete_own" ON payments FOR DELETE
  USING (
    get_my_role() = 'sales'
    AND is_final_payment = false
    AND approval_status  = 'pending'
    AND quote_id IN (SELECT id FROM quotes WHERE created_by = auth.uid())
  );

-- =====================================================
-- 7. RPC — let a sales user clear their rejection banner.
--    SECURITY DEFINER because sales_notified_at would
--    otherwise be blocked by the update policy above
--    (rejected rows are not 'pending', so sales can't UPDATE).
-- =====================================================

CREATE OR REPLACE FUNCTION dismiss_payment_notification(p_payment_id uuid)
RETURNS void AS $$
BEGIN
  UPDATE payments
     SET sales_notified_at = now()
   WHERE id = p_payment_id
     AND approval_status = 'rejected'
     AND quote_id IN (
       SELECT id FROM quotes WHERE created_by = auth.uid()
     );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION dismiss_payment_notification(uuid) TO authenticated;

-- =====================================================
-- DONE. No existing revenue numbers were changed.
-- Safe to re-run this whole file again if anything errors.
-- =====================================================
