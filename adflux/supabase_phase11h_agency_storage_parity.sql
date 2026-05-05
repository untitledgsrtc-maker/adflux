-- =====================================================================
-- ADFLUX → UNTITLED OS  •  PHASE 11h
-- Fix agency storage RLS — make it sales-equivalent, NOT admin-equivalent
-- =====================================================================
--
-- WHY (CRITICAL — security audit, 5 May 2026):
--
--   Phase 11 storage policies were written before the 'agency' role
--   existed at full feature parity. When agency was added in Phase
--   11g, I wrongly bumped agency into the PRIVILEGED set across
--   READ/INSERT/UPDATE — meaning any agency user can read/write/
--   modify ANY quote's storage objects regardless of which user owns
--   the parent quote.
--
--   Audit confirms this exposes:
--     • OC copies (signed govt acknowledgements)
--     • Locked proposal PDFs (full GSTIN, bank, contract terms)
--     • Payment proofs (cheque scans, UPI receipts)
--   …of every other rep's quotes.
--
--   Symmetric bug: agency was EXCLUDED from DELETE entirely.
--   Sales can delete their own draft attachments. Agency cannot.
--
--   Owner spec is "agency = same as sales but different name". This
--   migration restores parity:
--     READ/INSERT/UPDATE: own quotes only (drop from privileged set)
--     DELETE:             own DRAFT quotes (add to EXISTS branch)
--
--   Idempotent — DROP + CREATE on every policy.
-- =====================================================================


-- 1) READ — agency NO LONGER privileged; falls through to ownership check
DROP POLICY IF EXISTS "qa_read_authenticated"   ON storage.objects;
DROP POLICY IF EXISTS "qa_read_owner_or_admin"  ON storage.objects;
CREATE POLICY "qa_read_owner_or_admin"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'quote-attachments'
    AND auth.uid() IS NOT NULL
    AND (
      public.get_my_role() IN ('admin', 'owner', 'co_owner')
      OR EXISTS (
        SELECT 1 FROM public.quotes q
         WHERE q.id = public.storage_path_to_quote_id(storage.objects.name)
           AND q.created_by = auth.uid()
      )
    )
  );


-- 2) INSERT — same fix
DROP POLICY IF EXISTS "qa_insert_authenticated"  ON storage.objects;
DROP POLICY IF EXISTS "qa_insert_owner_or_admin" ON storage.objects;
CREATE POLICY "qa_insert_owner_or_admin"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'quote-attachments'
    AND auth.uid() IS NOT NULL
    AND (
      public.get_my_role() IN ('admin', 'owner', 'co_owner')
      OR EXISTS (
        SELECT 1 FROM public.quotes q
         WHERE q.id = public.storage_path_to_quote_id(storage.objects.name)
           AND q.created_by = auth.uid()
      )
    )
  );


-- 3) UPDATE — same fix
DROP POLICY IF EXISTS "qa_update_authenticated"  ON storage.objects;
DROP POLICY IF EXISTS "qa_update_owner_or_admin" ON storage.objects;
CREATE POLICY "qa_update_owner_or_admin"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'quote-attachments'
    AND auth.uid() IS NOT NULL
    AND (
      public.get_my_role() IN ('admin', 'owner', 'co_owner')
      OR EXISTS (
        SELECT 1 FROM public.quotes q
         WHERE q.id = public.storage_path_to_quote_id(storage.objects.name)
           AND q.created_by = auth.uid()
      )
    )
  );


-- 4) DELETE — admin = all; sales OR agency = own DRAFT quotes only
DROP POLICY IF EXISTS "qa_delete_authenticated"  ON storage.objects;
DROP POLICY IF EXISTS "qa_delete_owner_or_admin" ON storage.objects;
CREATE POLICY "qa_delete_owner_or_admin"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'quote-attachments'
    AND auth.uid() IS NOT NULL
    AND (
      public.get_my_role() IN ('admin', 'owner', 'co_owner')
      OR EXISTS (
        SELECT 1 FROM public.quotes q
         WHERE q.id = public.storage_path_to_quote_id(storage.objects.name)
           AND q.created_by = auth.uid()
           AND q.status = 'draft'
      )
    )
  );


-- 5) Refresh PostgREST cache
NOTIFY pgrst, 'reload schema';
