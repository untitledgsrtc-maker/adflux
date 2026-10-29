-- ============================================================================
-- Phase 529 — client proof (Google review screenshot or testimonial video) on payments
-- ============================================================================
-- Owner 2026-10-29: when a Private-segment payment is added, the rep must attach
-- proof that the client left a Google review or recorded a testimonial video.
-- The proof rides the EXISTING payment approval, so admin sees it when approving.
--
-- ADDITIVE ONLY: two nullable columns on payments, one nullable column on
-- companies, one data value. No policy, trigger or function is changed.
--   payments.proof_type  — 'google_review' | 'video'
--   payments.proof_path  — object path inside the PRIVATE `quote-attachments`
--                          bucket: <quote_id>/payment-proof-<ts>-<name>
--                          (that bucket's existing RLS already limits read/write
--                          to the quote's creator + admin/co_owner, so no new
--                          storage policy is needed)
--   companies.google_review_url — the review-request link shown to the rep
--                          (§4: read from the company row, never hardcoded)
-- ============================================================================

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS proof_type text,
  ADD COLUMN IF NOT EXISTS proof_path text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.payments'::regclass
       AND conname  = 'payments_proof_type_check'
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_proof_type_check
      CHECK (proof_type IS NULL OR proof_type IN ('google_review', 'video'));
  END IF;
END $$;

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS google_review_url text;

UPDATE public.companies
   SET google_review_url = 'https://g.page/r/CSnHVzLS-vIREBM/review'
 WHERE segment = 'PRIVATE'
   AND google_review_url IS NULL;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY — expect: payments_cols = 2, review_link_set = 1, constraint_present = true
-- ============================================================================
-- SELECT
--   (SELECT count(*) FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='payments'
--       AND column_name IN ('proof_type','proof_path'))                        AS payments_cols,
--   (SELECT count(*) FROM public.companies
--     WHERE segment='PRIVATE' AND google_review_url IS NOT NULL)               AS review_link_set,
--   EXISTS (SELECT 1 FROM pg_constraint
--            WHERE conname='payments_proof_type_check')                        AS constraint_present;
