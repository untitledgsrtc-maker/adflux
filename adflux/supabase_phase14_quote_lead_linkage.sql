-- =====================================================================
-- Phase 14 — Lead ↔ Quote linkage column
-- =====================================================================
-- Phase 12 added leads.quote_id (lead → quote). This adds the reverse
-- pointer quotes.lead_id so we can render "from lead X" on the quote
-- detail page and audit which leads converted.
--
-- Quote-lead is 1:1: a lead can spawn multiple quotes (versioning),
-- but each quote points to at most one originating lead.
-- =====================================================================

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_quotes_lead_id ON public.quotes (lead_id) WHERE lead_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- VERIFY:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'quotes' AND column_name = 'lead_id';
--   -- expect: 1 row
-- =====================================================================
