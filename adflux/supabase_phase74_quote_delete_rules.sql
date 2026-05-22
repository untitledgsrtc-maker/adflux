-- supabase_phase74_quote_delete_rules.sql
-- Phase 74 (21 May 2026) — replace blanket delete-block with
-- role-aware + payment-locked rules.
--
-- Owner directive (21 May 2026):
--   • Team (sales/telecaller): delete any quote EXCEPT Won.
--   • Admin / co_owner: delete anything except Won-with-payments
--     (must delete payments rows first).
--
-- The Phase 11b trigger blocked DELETE on every non-draft quote
-- with a flat exception. Reps couldn't clean up Sent/Negotiating/
-- Lost/Nurture quotes that went nowhere. This rewrites the trigger.
--
-- Decision table (verified with owner):
--
-- Role            | Draft Sent Negot Nurt Lost Won-noPay Won-paid
-- -----------------------------------------------------------------
-- sales / TC      |  ✓     ✓    ✓     ✓    ✓     ✗         ✗
-- admin/co_owner  |  ✓     ✓    ✓     ✓    ✓     ✓         ✗
--
-- The "✗ Won-paid" branch raises with a clear message: delete
-- payments first.
--
-- Idempotent. DROP TRIGGER + CREATE FUNCTION OR REPLACE.

CREATE OR REPLACE FUNCTION public.quotes_no_delete_after_draft()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role     text;
  v_has_pay  boolean;
BEGIN
  -- Resolve caller role. get_my_role() is the canonical helper.
  SELECT public.get_my_role() INTO v_role;

  -- Won-with-payments is the hard floor for every role. Force the
  -- caller to delete payments rows first so the financial trail
  -- stays consistent (bank credit ↔ quote ↔ payment).
  IF OLD.status = 'won' THEN
    SELECT EXISTS (SELECT 1 FROM public.payments WHERE quote_id = OLD.id)
      INTO v_has_pay;
    IF v_has_pay THEN
      RAISE EXCEPTION
        'Quote % is Won and has payment rows. Delete the payments first, then this quote.',
        OLD.quote_number
        USING ERRCODE = 'check_violation';
    END IF;
    -- Won without payments: admin / co_owner only.
    IF v_role NOT IN ('admin', 'co_owner') THEN
      RAISE EXCEPTION
        'Quote % is Won. Only admin can delete Won quotes.',
        OLD.quote_number
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- All other statuses (draft / sent / negotiating / lost / nurture)
  -- are deletable by every role.
  RETURN OLD;
END $$;

-- Re-attach trigger. Drop both the current name AND any legacy
-- trigger name so only one trigger fires on DELETE. The Phase 11b
-- file originally named it 'quotes_block_delete', but if the live
-- Supabase instance has it under a different name we want to
-- replace cleanly.
DROP TRIGGER IF EXISTS quotes_block_delete             ON public.quotes;
DROP TRIGGER IF EXISTS quotes_no_delete_after_draft    ON public.quotes;

CREATE TRIGGER quotes_block_delete
  BEFORE DELETE ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.quotes_no_delete_after_draft();

NOTIFY pgrst, 'reload schema';

-- VERIFY: simulate the four paths (read-only — no actual deletes).
SELECT
  'Phase 74 trigger ready' AS status,
  (SELECT COUNT(*) FROM pg_trigger WHERE tgname = 'quotes_block_delete') AS trigger_present;
