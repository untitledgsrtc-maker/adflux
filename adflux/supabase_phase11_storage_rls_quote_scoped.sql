-- =====================================================================
-- ADFLUX → UNTITLED OS  •  PHASE 11
-- Storage RLS — scope quote-attachments to quote owner / admin only
-- =====================================================================
--
-- WHY (CRITICAL):
--   Phase 8 created the quote-attachments bucket with these policies:
--
--     CREATE POLICY "qa_read_authenticated"
--       ON storage.objects FOR SELECT
--       USING (bucket_id = 'quote-attachments' AND auth.uid() IS NOT NULL);
--
--   That comment said "App-level filtering already restricts which
--   quotes a user can see; if they can read the quote_id from URL
--   they're already authorized to see its attachments."
--
--   That assumption is WRONG. RLS is the security boundary. A sales
--   rep on segment PRIVATE who knows or guesses a GOVT quote_id can:
--     • download OC copies (signed govt acknowledgements)
--     • download locked proposal PDFs (full GSTIN, bank, contract terms)
--     • download payment proof attachments (cheque images, UPI scans)
--     • delete any of the above
--   …regardless of which quote owns the file.
--
--   Path convention is `<quote_id>/<prefix>-<slug>.<ext>` (see
--   src/utils/proposalPdf.js:pathFor). The first segment of the path
--   is the quote_id, so we can extract it with split_part(name, '/', 1)
--   and JOIN to the quotes table to enforce ownership.
--
-- DESIGN:
--   • READ: admin/owner/co_owner = all; sales = own quotes only.
--   • INSERT: same — sales can only add attachments to their own quotes.
--   • UPDATE: same.
--   • DELETE: extra guard — sales can only delete attachments on quotes
--     in DRAFT status. Prevents a rep from "cleaning up" an OC copy
--     after a proposal was already sent (which would invalidate audit).
--
-- SAFE RE-RUN: drops + recreates each policy.
-- =====================================================================


-- 1) Helper to extract quote_id from a storage path -----------------
--    Returns NULL if the first segment isn't a valid UUID. Wrapped in
--    a function so the policies stay readable.
CREATE OR REPLACE FUNCTION public.storage_path_to_quote_id(path text)
RETURNS uuid
LANGUAGE sql IMMUTABLE
AS $$
  SELECT
    CASE
      WHEN split_part(path, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN split_part(path, '/', 1)::uuid
      ELSE NULL
    END
$$;


-- 2) READ: scope to admin OR owner of the parent quote ---------------
DROP POLICY IF EXISTS "qa_read_authenticated"   ON storage.objects;
DROP POLICY IF EXISTS "qa_read_owner_or_admin"  ON storage.objects;
CREATE POLICY "qa_read_owner_or_admin"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'quote-attachments'
    AND auth.uid() IS NOT NULL
    AND (
      public.get_my_role() IN ('admin', 'owner', 'co_owner', 'agency')
      OR EXISTS (
        SELECT 1 FROM public.quotes q
         WHERE q.id = public.storage_path_to_quote_id(storage.objects.name)
           AND q.created_by = auth.uid()
      )
    )
  );


-- 3) INSERT: same scope ---------------------------------------------
DROP POLICY IF EXISTS "qa_insert_authenticated"  ON storage.objects;
DROP POLICY IF EXISTS "qa_insert_owner_or_admin" ON storage.objects;
CREATE POLICY "qa_insert_owner_or_admin"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'quote-attachments'
    AND auth.uid() IS NOT NULL
    AND (
      public.get_my_role() IN ('admin', 'owner', 'co_owner', 'agency')
      OR EXISTS (
        SELECT 1 FROM public.quotes q
         WHERE q.id = public.storage_path_to_quote_id(storage.objects.name)
           AND q.created_by = auth.uid()
      )
    )
  );


-- 4) UPDATE: same scope ----------------------------------------------
DROP POLICY IF EXISTS "qa_update_authenticated"  ON storage.objects;
DROP POLICY IF EXISTS "qa_update_owner_or_admin" ON storage.objects;
CREATE POLICY "qa_update_owner_or_admin"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'quote-attachments'
    AND auth.uid() IS NOT NULL
    AND (
      public.get_my_role() IN ('admin', 'owner', 'co_owner', 'agency')
      OR EXISTS (
        SELECT 1 FROM public.quotes q
         WHERE q.id = public.storage_path_to_quote_id(storage.objects.name)
           AND q.created_by = auth.uid()
      )
    )
  );


-- 5) DELETE: admin = all; sales = own quotes in DRAFT only ----------
--    This is the strictest of the four — once a proposal is sent the
--    OC copy / locked PDF / payment proofs become legal evidence and
--    the rep should not be able to silently remove them. Admin can
--    still delete (for true cleanup like accidental dupe upload).
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


-- =====================================================================
-- VERIFY:
--
--   -- as a sales user: should see only own attachments
--   SELECT name FROM storage.objects WHERE bucket_id = 'quote-attachments';
--
--   -- list policies
--   SELECT polname, polcmd
--     FROM pg_policy
--    WHERE polrelid = 'storage.objects'::regclass
--      AND polname LIKE 'qa_%'
--    ORDER BY polname;
--   -- expected: 4 policies, all "qa_*_owner_or_admin"
-- =====================================================================
