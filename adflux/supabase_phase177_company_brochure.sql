-- supabase_phase177_company_brochure.sql
-- Phase 177 (2026-06-20) — brochure PDF per company, attached to PRIVATE-lead
-- intro emails (LeadDetailV2 Email action, Phase 177 frontend).
--
-- Admin uploads it via Master -> Companies (the existing `company-assets`
-- bucket, kind=brochure). The lead-email reads it from the segment='PRIVATE'
-- company row (per §4 — never hardcoded). Government leads do NOT use it.
--
-- Idempotent. No RLS change (companies already readable by authenticated;
-- company-assets bucket policy from Phase 80 already covers admin upload).

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS brochure_url text;

NOTIFY pgrst, 'reload schema';

-- VERIFY — expect the column to exist.
SELECT column_name
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'companies'
   AND column_name = 'brochure_url';

SELECT 'Phase 177 companies.brochure_url added' AS status;
