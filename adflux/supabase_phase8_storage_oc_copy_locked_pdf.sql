-- =====================================================================
-- ADFLUX → UNTITLED OS  •  PHASE 8
-- File storage + locked proposal PDF + OC copy mandatory upload
-- =====================================================================
--
-- WHAT THIS DOES:
--   1. Creates the `quote-attachments` Supabase Storage bucket (private)
--      with RLS — authenticated users can read/write, the existing
--      RLS on the quotes table controls who can read which quote.
--   2. Adds OC_COPY (display_order 7) to attachment_templates for both
--      AUTO_HOOD and GSRTC_LED — mandatory before Mark Sent. This is
--      the stamped/signed acknowledgment slip the delivery person
--      brings back from the government body proving receipt.
--   3. Adds locked_proposal_pdf_url + locked_proposal_pdf_at columns
--      to quotes — populated when status flips to 'sent'. Snapshots
--      the rendered Gujarati letter as PDF so future quote edits do
--      NOT change what the agency was sent. Future-proof per owner
--      requirement (1 May 2026).
--
-- WHY A SNAPSHOT:
--   The Gujarati proposal letter renders correctly in HTML today, but
--   editing the quote (recipient name, date, line items, signer)
--   should not retroactively rewrite what was sent on hand-delivery.
--   The locked PDF is the single source of truth for "what reached
--   the government body".
--
-- BUCKET DESIGN:
--   - private (`public = false`) — only authenticated app users get
--     access. Govt bodies receive the consolidated PDF physically,
--     not via cloud links.
--   - file_size_limit = 100 MB per file. Some PDFs (e.g. the 198-page
--     Untitled Advertising list) can be sizeable.
--   - storage path convention: `<quote_id>/<display_order>-<slug>.<ext>`
--     enforced by app code, not DB.
--
-- IDEMPOTENT.
-- =====================================================================


-- 1) Storage bucket --------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('quote-attachments', 'quote-attachments', false, 104857600)
ON CONFLICT (id) DO UPDATE
  SET file_size_limit = EXCLUDED.file_size_limit,
      public          = EXCLUDED.public;


-- 2) Bucket RLS policies --------------------------------------------
-- Read: any authenticated user. App-level filtering already restricts
-- which quotes a user can see; if they can read the quote_id from URL
-- they're already authorized to see its attachments.
DROP POLICY IF EXISTS "qa_read_authenticated" ON storage.objects;
CREATE POLICY "qa_read_authenticated"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'quote-attachments' AND auth.uid() IS NOT NULL);

-- Insert: any authenticated user. App enforces path scoping.
DROP POLICY IF EXISTS "qa_insert_authenticated" ON storage.objects;
CREATE POLICY "qa_insert_authenticated"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'quote-attachments' AND auth.uid() IS NOT NULL);

-- Update: any authenticated user.
DROP POLICY IF EXISTS "qa_update_authenticated" ON storage.objects;
CREATE POLICY "qa_update_authenticated"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'quote-attachments' AND auth.uid() IS NOT NULL);

-- Delete: any authenticated user. (Sales reps can clean up their own
-- mistakes; admin can delete anything.)
DROP POLICY IF EXISTS "qa_delete_authenticated" ON storage.objects;
CREATE POLICY "qa_delete_authenticated"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'quote-attachments' AND auth.uid() IS NOT NULL);


-- 3) Locked proposal PDF columns on quotes -------------------------
-- locked_proposal_pdf_url  → storage path inside `quote-attachments`
-- locked_proposal_pdf_at   → timestamp of the snapshot, so we know
--                            which version of the quote was sent.
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS locked_proposal_pdf_url text,
  ADD COLUMN IF NOT EXISTS locked_proposal_pdf_at  timestamptz;


-- 4) OC copy template — display_order 7 for both govt media types --
-- We slot it AFTER the 6 existing items (which were 1-6 in Phase 7)
-- to keep the historical order stable. App code keys off the label,
-- not the order, when checking "is OC copy uploaded?".
INSERT INTO public.attachment_templates
  (segment,      media_type,  display_order, label,                              is_required, notes)
VALUES
  ('GOVERNMENT', 'AUTO_HOOD', 7,             'OC copy (acknowledgment receipt)', true,
   'Stamped/signed acknowledgment slip the delivery person brings back from the government body. Required to mark proposal as Sent.'),
  ('GOVERNMENT', 'GSRTC_LED', 7,             'OC copy (acknowledgment receipt)', true,
   'Stamped/signed acknowledgment slip the delivery person brings back from the government body. Required to mark proposal as Sent.')
ON CONFLICT (segment, media_type, display_order) DO NOTHING;


-- =====================================================================
-- VERIFY:
--
--   -- Bucket exists, private, 100MB limit:
--   SELECT id, public, file_size_limit FROM storage.buckets
--    WHERE id = 'quote-attachments';
--
--   -- 4 RLS policies on storage.objects:
--   SELECT polname FROM pg_policy
--    WHERE polrelid = 'storage.objects'::regclass
--      AND polname LIKE 'qa_%'
--    ORDER BY polname;
--
--   -- 14 attachment templates (7 per segment+media combo):
--   SELECT segment, media_type, display_order, label
--     FROM public.attachment_templates
--    WHERE segment = 'GOVERNMENT'
--    ORDER BY media_type, display_order;
--
--   -- New columns on quotes:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'quotes'
--      AND column_name IN ('locked_proposal_pdf_url', 'locked_proposal_pdf_at');
--
-- =====================================================================
