-- =====================================================================
-- Phase 212 — quote_cities gains impressions_month + impressions_day
-- 2026-07-07
--
-- WHY: the Private LED quote PDF (QuotePDFHtml) now computes CPM as
--   CPM = offer_price (offered_rate x screens) / real monthly impressions x 1000
--   (owner rule, 7 Jul 2026). The real monthly impressions live on the
--   CITIES master (cities.impressions_month) and are SNAPSHOTTED onto each
--   quote_cities row at save time so the PDF reads offer / real-impressions
--   instead of the old ~5,200/screen guess. These two columns did NOT exist
--   on quote_cities (they exist only on the cities master).
--
-- §45-safe: additive nullable columns, DEFAULT 0. No existing code reads
--   them; the new WizardShell save writes them; the PDF reads them with a
--   5,200/screen FALLBACK when 0 (so old quotes still show a CPM). Idempotent.
--
-- ⚠ RUN THIS FIRST, BEFORE deploying the Phase 212 JS. Without the columns,
--   every Private LED quote save (create AND edit) fails with
--   "column does not exist". Run here in Supabase Studio, confirm the VERIFY
--   rows, THEN push the code.
-- =====================================================================

ALTER TABLE public.quote_cities
  ADD COLUMN IF NOT EXISTS impressions_month integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS impressions_day   integer DEFAULT 0;

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY (expect BOTH rows present, default 0) ────────────────────
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'quote_cities'
  AND column_name IN ('impressions_month', 'impressions_day')
ORDER BY column_name;

SELECT 'Phase 212 quote_cities impressions columns added' AS status;
