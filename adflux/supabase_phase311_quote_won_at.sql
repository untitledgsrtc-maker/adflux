-- supabase_phase311_quote_won_at.sql
-- Phase 311 (2026-08-17) — real WON date on quotes.
--
-- Owner report: a quote SENT in July but marked WON in August was missing from
-- the August Quotes view. Root cause: the Quotes list dated + filtered every
-- quote by quotes.created_at (the sent date), so an August filter returned only
-- August-CREATED quotes. A prior-month-sent deal won this month dropped out.
--
-- Fix = a real quotes.won_at date, stamped the first time a quote enters
-- status='won', so the Won tab can filter/show by the month it was WON.
-- Additive column + one BEFORE trigger + a one-time backfill. Idempotent.
--
-- NOTE (no won_at existed before this — CLAUDE.md §33). The agency commission
-- views (AgencyEarningsView / AgencyCommissionAdminV2) fake a client-side
-- won_at from updated_at; they can later read this real column instead
-- (out of scope here).
--
-- DEPLOY ORDER (hard): run THIS SQL first, THEN push the frontend. The frontend
-- filters the Won tab on won_at; if it deploys before the column exists, the
-- Won-tab date-range fetch 400s (column not found). SQL-first is safe.

-- ── 1. column ──────────────────────────────────────────────────────────────
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS won_at timestamptz;

-- ── 2. trigger fn — stamp won_at the FIRST time a quote becomes 'won' ───────
-- Fires BEFORE INSERT OR UPDATE OF status. Sets won_at=now() only on the
-- transition INTO 'won' (or an insert that is already won) AND only when won_at
-- is still NULL, so a later edit/payment on a won quote can NEVER re-date the
-- win (that is the exact updated_at-proxy flaw this replaces). A quote that
-- leaves 'won' keeps its won_at; if it is won again the original date stands.
CREATE OR REPLACE FUNCTION public.quote_stamp_won_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'won'
     AND NEW.won_at IS NULL
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'won')
  THEN
    NEW.won_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_quote_stamp_won_at ON public.quotes;
CREATE TRIGGER trg_quote_stamp_won_at
  BEFORE INSERT OR UPDATE OF status ON public.quotes
  FOR EACH ROW
  EXECUTE FUNCTION public.quote_stamp_won_at();

-- ── 3. one-time backfill for existing won quotes (won_at still NULL) ────────
-- Win date = the final APPROVED payment's date if the deal is paid (matches
-- rebuild_monthly_sales' definition of a realised sale, so incentive and the
-- Quotes view agree on the month), else the quote's last-touched (updated_at).
UPDATE public.quotes q
SET won_at = COALESCE(
  (SELECT max(p.payment_date)::timestamptz
     FROM public.payments p
    WHERE p.quote_id = q.id
      AND p.is_final_payment = true
      AND p.approval_status  = 'approved'),
  q.updated_at
)
WHERE q.status = 'won'
  AND q.won_at IS NULL;

NOTIFY pgrst, 'reload schema';

-- ── VERIFY ─────────────────────────────────────────────────────────────────
-- Expect: col_exists=t · trigger_present=1 · won_missing=0
-- SELECT
--   (SELECT count(*) FROM information_schema.columns
--      WHERE table_schema='public' AND table_name='quotes' AND column_name='won_at') = 1 AS col_exists,
--   (SELECT count(*) FROM pg_trigger WHERE tgname='trg_quote_stamp_won_at')            AS trigger_present,
--   (SELECT count(*) FROM public.quotes WHERE status='won' AND won_at IS NULL)         AS won_missing;
