-- =====================================================================
-- supabase_phase344_lead_owner_quote_share.sql
-- Phase 344: the current owner of a lead may SEND the quote on that lead (WhatsApp /
-- email / PDF link). Run AFTER db/functions/get_lead_quote.sql (needs is_lead_quote_owner).
--
-- Adds ONLY two policies on pdf_share_tokens:
--   * read the live share token (so her link is the SAME stable branded link),
--   * mint a token that is created_by herself (the existing self_insert policy requires
--     quotes.created_by = her, which a lead-owner is not).
-- pdf_share_tokens is read client-side by exactly one file (QuotePDFHtml.jsx), so these
-- two policies cannot pollute any list or dashboard. NO policy on quotes / quote_cities /
-- payments / leads / users is touched. No UPDATE / DELETE. Idempotent.
-- =====================================================================
DO $$
BEGIN
  IF to_regprocedure('public.is_lead_quote_owner(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Run db/functions/get_lead_quote.sql FIRST (helper missing)';
  END IF;
END $$;

DROP POLICY IF EXISTS pdf_share_tokens_lead_owner_read ON public.pdf_share_tokens;
CREATE POLICY pdf_share_tokens_lead_owner_read ON public.pdf_share_tokens
  FOR SELECT TO authenticated
  USING (public.is_lead_quote_owner(quote_id));

DROP POLICY IF EXISTS pdf_share_tokens_lead_owner_insert ON public.pdf_share_tokens;
CREATE POLICY pdf_share_tokens_lead_owner_insert ON public.pdf_share_tokens
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid()
              AND public.is_lead_quote_owner(quote_id)
              -- bounds (security review): the app always mints 90 days + a 43-char token;
              -- a non-creator may not mint a never-expiring or guessable link.
              AND expires_at <= now() + interval '91 days'
              AND length(token) >= 32);

COMMENT ON POLICY pdf_share_tokens_lead_owner_read ON public.pdf_share_tokens IS
  'Phase 344: current owner of the quote''s lead may reuse the live share token (stable branded link).';
COMMENT ON POLICY pdf_share_tokens_lead_owner_insert ON public.pdf_share_tokens IS
  'Phase 344: current owner may mint a token (created_by must be herself). No UPDATE/DELETE.';

NOTIFY pgrst, 'reload schema';

-- VERIFY (every column must be TRUE):
-- SELECT
--   (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pdf_share_tokens'
--       AND policyname IN ('pdf_share_tokens_lead_owner_read', 'pdf_share_tokens_lead_owner_insert')) = 2          AS two_policies,
--   (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pdf_share_tokens') = 6          AS six_total_on_tokens,
--   NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname LIKE '%lead_owner%' AND cmd NOT IN ('SELECT', 'INSERT')) AS no_write_grant_leaked,
--   NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('quotes', 'quote_cities', 'payments')
--                 AND (COALESCE(qual, '') || COALESCE(with_check, '')) ILIKE '%leads%')                            AS tripwire_no_quote_policy_reads_leads,
--   NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('leads', 'users')
--                 AND (COALESCE(qual, '') || COALESCE(with_check, '')) ~* '(quotes|quote_cities|payments|pdf_share_tokens)') AS tripwire_no_recursion_edge,
--   (SELECT count(*) FROM public.leads WHERE telecaller_id IS NOT NULL AND assigned_to IS NOT NULL AND telecaller_id <> assigned_to) = 0 AS tripwire_owner_union_equals_coalesce;

-- ROLLBACK (no data touched):
--   DROP POLICY IF EXISTS pdf_share_tokens_lead_owner_insert ON public.pdf_share_tokens;
--   DROP POLICY IF EXISTS pdf_share_tokens_lead_owner_read   ON public.pdf_share_tokens;
--   NOTIFY pgrst, 'reload schema';
