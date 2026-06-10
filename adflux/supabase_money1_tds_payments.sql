-- =====================================================================
-- MONEY TRUTH 1 — TDS columns on payments (before the first Govt cheque)
-- 2026-06-10
--
-- THE WALL (CLAUDE.md §23 #1): Govt clients deduct TDS (2% income + 2% GST
-- = ~4%) from every payment. payments has no TDS fields, so a Govt cheque
-- recorded at its cash value never sums to the quote total → the deal sits
-- "partial paid" forever → the rep's incentive revenue never books.
--
-- THE DESIGN (zero change to any paid-sum logic):
--   amount_received KEEPS its existing meaning — the GROSS amount credited
--   toward the quote (what every total/balance/derived-status already sums).
--   tds_amount records the part of that gross withheld as TDS (breakdown,
--   not an addition): cash actually banked = amount_received - tds_amount.
--   So a ₹1,00,000 milestone paid by a ₹96,000 cheque + ₹4,000 TDS is
--   entered as amount_received=100000, tds_amount=4000 → deal closes at the
--   quote total, TDS is on record for accounts, NO derived logic changes.
--
-- UI: the TDS field shows ONLY on GOVERNMENT-segment quotes (private
-- payment flow stays visually byte-identical).
--
-- SAFE (§45): two additive nullable columns. No existing row, sum, RLS, or
-- flow changes. Idempotent.
-- =====================================================================

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS tds_amount numeric;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS tds_pct    numeric;

-- Sanity: TDS can never exceed the gross it is part of (NULL-tolerant).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payments_tds_within_gross'
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_tds_within_gross
      CHECK (tds_amount IS NULL OR (tds_amount >= 0 AND tds_amount <= amount_received));
  END IF;
END $$;

-- self-register (tolerant if the register table isn't created yet)
DO $$
BEGIN
  IF to_regclass('public.applied_migrations') IS NOT NULL THEN
    INSERT INTO public.applied_migrations (name, note)
    VALUES ('supabase_money1_tds_payments.sql', 'Money Truth - TDS breakdown columns on payments')
    ON CONFLICT (name) DO NOTHING;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'payments'
       AND column_name IN ('tds_amount', 'tds_pct'))                       AS tds_columns,     -- 2
  (SELECT count(*) FROM pg_constraint
     WHERE conname = 'payments_tds_within_gross')                          AS tds_check;       -- 1

SELECT 'Money 1 TDS payment columns applied' AS status;
