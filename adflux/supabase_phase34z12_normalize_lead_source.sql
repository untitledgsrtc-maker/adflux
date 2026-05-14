-- =====================================================================
-- Phase 34Z.12 — normalize leads.source values
-- 14 May 2026
--
-- WHY
--
-- Owner reported (14 May 2026): the /leads Source filter dropdown
-- shows both "Manual" and "Manual Lead" as separate options because
-- LogMeetingModal in lead-mode wrote `source='Manual Lead'` while
-- LeadFormV2 wrote `source='Manual'`. Same intent, two strings, two
-- filter rows.
--
-- Phase 34Z.12 (JSX) pins both writers to 'Manual'. This migration
-- collapses the historical rows so the dropdown shows one option,
-- not two.
--
-- WHAT
--
-- UPDATE leads SET source = 'Manual' WHERE source = 'Manual Lead'.
-- Trim whitespace too while we're here so " Manual " variants merge.
-- No-op if nothing matches.
--
-- Idempotent. Re-runnable.
-- =====================================================================

-- Trim whitespace on every source value so " Manual" / "Manual "
-- collapse into "Manual".
UPDATE public.leads
   SET source = TRIM(source)
 WHERE source IS NOT NULL
   AND source <> TRIM(source);

-- Snap "Manual Lead" → "Manual".
UPDATE public.leads
   SET source = 'Manual'
 WHERE source = 'Manual Lead';

-- ─── VERIFY ──────────────────────────────────────────────────────────
-- After the run both counts below should be 0.
SELECT
  (SELECT count(*) FROM public.leads WHERE source = 'Manual Lead')              AS manual_lead_rows_remaining,
  (SELECT count(*) FROM public.leads WHERE source IS NOT NULL AND source <> TRIM(source)) AS untrimmed_source_rows;

NOTIFY pgrst, 'reload schema';
