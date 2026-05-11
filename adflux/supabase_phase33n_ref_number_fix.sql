-- supabase_phase33n_ref_number_fix.sql
--
-- Phase 33N fix 3 — drop ref_number from the payment-FU functions.
--
-- Discovered by the smoke test (T7):
--   ERROR 42703: column 'ref_number' does not exist
--   CONTEXT: create_payment_collection_followups(uuid)
--
-- Root cause: when I wrote Phase 33G.7 (payment FU on Won) and
-- Phase 33L (regen_payment_fu_notes), I referenced ref_number in
-- COALESCE(quote_number, ref_number, id::text). Schema check missed.
-- ref_number is NOT a column on quotes — it exists in CLAUDE.md as
-- the locked ref format spec but was never added as a column.
--
-- This is a real production bug. Marking ANY quote as Won right now
-- triggers tg_quote_won_payment_followups → create_payment_collection_followups
-- → that bad SELECT → 23502 abort. The Won status flip rolls back too.
-- Effectively no quote can be Marked Won until this is patched.
--
-- Fix: replace both functions using only quote_number (which is NOT
-- NULL on every row per Phase 1 schema). Cosmetic loss only — the
-- label in the FU note becomes the quote_number alone, which is
-- still uniquely identifying.
--
-- Idempotent: CREATE OR REPLACE on both.

-- ─── 1. create_payment_collection_followups ──────────────────────
CREATE OR REPLACE FUNCTION public.create_payment_collection_followups(p_quote_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quote    record;
  v_existing int;
BEGIN
  -- Phase 33N fix — dropped ref_number from the COALESCE.
  SELECT id, created_by, total_amount,
         COALESCE(quote_number, id::text) AS label
    INTO v_quote
    FROM quotes
   WHERE id = p_quote_id;

  IF NOT FOUND THEN
    RAISE NOTICE 'create_payment_collection_followups: quote % not found', p_quote_id;
    RETURN;
  END IF;

  -- Skip if payment FUs already exist for this quote (duplicate-Won guard).
  SELECT COUNT(*) INTO v_existing
    FROM follow_ups
   WHERE quote_id = p_quote_id
     AND note LIKE 'Payment collection%';

  IF v_existing > 0 THEN
    RAISE NOTICE 'create_payment_collection_followups: already exist for %, skipping', p_quote_id;
    RETURN;
  END IF;

  INSERT INTO follow_ups (quote_id, assigned_to, follow_up_date, note) VALUES
    (p_quote_id, v_quote.created_by, (CURRENT_DATE + INTERVAL '7 days')::date,
     'Payment collection: ₹' || to_char(v_quote.total_amount, 'FM99,99,99,999') || ' due (' || v_quote.label || ')'),
    (p_quote_id, v_quote.created_by, (CURRENT_DATE + INTERVAL '15 days')::date,
     'Payment collection: 2nd reminder · ₹' || to_char(v_quote.total_amount, 'FM99,99,99,999')),
    (p_quote_id, v_quote.created_by, (CURRENT_DATE + INTERVAL '30 days')::date,
     'Payment collection: final reminder · escalate if unpaid');
END $$;

GRANT EXECUTE ON FUNCTION public.create_payment_collection_followups(uuid) TO authenticated;

-- ─── 2. regen_payment_fu_notes ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.regen_payment_fu_notes(p_quote_id uuid)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_quote    record;
  v_paid     numeric := 0;
  v_outstand numeric := 0;
  v_count    int;
BEGIN
  -- Phase 33N fix — dropped ref_number from the COALESCE.
  SELECT id, total_amount,
         COALESCE(quote_number, id::text) AS label
    INTO v_quote
    FROM quotes WHERE id = p_quote_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  SELECT COALESCE(SUM(amount_received), 0) INTO v_paid
    FROM payments
   WHERE quote_id = p_quote_id AND approval_status = 'approved';

  v_outstand := GREATEST(0, v_quote.total_amount - v_paid);

  UPDATE follow_ups
     SET note = CASE
       WHEN note LIKE '%2nd reminder%' THEN
         'Payment collection: 2nd reminder · ₹' || to_char(v_outstand, 'FM99,99,99,999') || ' outstanding'
       WHEN note LIKE '%final reminder%' THEN
         'Payment collection: final reminder · ₹' || to_char(v_outstand, 'FM99,99,99,999') || ' outstanding'
       ELSE
         'Payment collection: ₹' || to_char(v_outstand, 'FM99,99,99,999') || ' outstanding (' || v_quote.label || ')'
     END
   WHERE quote_id = p_quote_id
     AND note LIKE 'Payment collection%'
     AND is_done = false;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public.regen_payment_fu_notes(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY:
-- After this runs, the smoke test T7 should pass:
--   SELECT * FROM supabase_phase33n_smoke_tests.sql (the whole file)
-- OR test manually:
--   1. Find a draft quote, mark it sent then won.
--   2. SELECT * FROM follow_ups WHERE quote_id = '<id>'
--        AND note LIKE 'Payment collection%';
--   Expect: 3 rows.
