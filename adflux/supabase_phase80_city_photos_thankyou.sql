-- supabase_phase80_city_photos_thankyou.sql
--
-- Phase 80 — city photo upload + thank-you page asset for the
-- Private LED quotation PDF redesign (Phase 81).
--
-- Owner directive (22 May 2026):
--   "i want to upload a photos in city page and i want that whenever
--    persone selscted any city the phoot or image rendered with pdf
--    of quotation"
--   "last page thanks you page we will attched in mastr r"
--   "this is for private only / govt hase perfct flow"
--
-- Scope locked:
--   • Single photo per city (cities.photo_url already exists from
--     legacy schema — only the upload UX needs to replace the bare
--     text input in CityModal).
--   • One thank-you page asset per company (segment='PRIVATE').
--     companies.thank_you_url is the new column. Govt segment can
--     leave it null — its own renderer is untouched per owner.
--   • New storage bucket `city-photos` (public read, admin write).
--     Pattern mirrors Phase 11F `company-assets` bucket.
--   • `company-assets` bucket reused for the thank-you image — it
--     already exists, already admin-write, already public-read.
--
-- Idempotent.

-- ─────────────────────────────────────────────────────────────────
-- 1) companies.thank_you_url — admin-uploaded "Thank you" page
--    rendered as the final page of every Private LED quotation PDF.
--    Path/URL pattern mirrors letterhead_url + logo_url (Phase 10b):
--    either a Supabase storage URL or a root-relative path under
--    /public.
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS thank_you_url text;

-- ─────────────────────────────────────────────────────────────────
-- 2) city-photos storage bucket — public read, admin write.
--    Mirrors Phase 11F `company-assets` shape so MasterV2's upload
--    helper can be reused with only a bucket-name swap.
--
--    Path convention enforced by the frontend uploader:
--      city-photos/<city_id>/<slug>.<ext>
--    Owner-facing photo URL is the public Supabase URL — stored on
--    cities.photo_url. Older external URLs (owner pasted text URLs
--    in CityModal) keep working since the column is plain text.
-- ─────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('city-photos', 'city-photos', true, 10485760)  -- 10 MB cap
ON CONFLICT (id) DO UPDATE
  SET public          = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit;

-- Storage policies — public SELECT, authenticated INSERT/UPDATE/DELETE
-- gated by admin / co_owner role via public.get_my_role(). Mirrors
-- the Phase 11F pattern.

-- PUBLIC SELECT — anyone with the link can view the image. Same as
-- letterheads / logos / quote PDFs.
DROP POLICY IF EXISTS city_photos_public_read ON storage.objects;
CREATE POLICY city_photos_public_read ON storage.objects
  FOR SELECT
  USING (bucket_id = 'city-photos');

-- INSERT — admin + co_owner only.
DROP POLICY IF EXISTS city_photos_admin_insert ON storage.objects;
CREATE POLICY city_photos_admin_insert ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'city-photos'
    AND public.get_my_role() IN ('admin', 'co_owner')
  );

-- UPDATE — admin + co_owner only (replace existing object).
DROP POLICY IF EXISTS city_photos_admin_update ON storage.objects;
CREATE POLICY city_photos_admin_update ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'city-photos'
    AND public.get_my_role() IN ('admin', 'co_owner')
  )
  WITH CHECK (bucket_id = 'city-photos');

-- DELETE — admin + co_owner only.
DROP POLICY IF EXISTS city_photos_admin_delete ON storage.objects;
CREATE POLICY city_photos_admin_delete ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'city-photos'
    AND public.get_my_role() IN ('admin', 'co_owner')
  );

NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────
-- VERIFY
-- ─────────────────────────────────────────────────────────────────
--
-- SELECT column_name FROM information_schema.columns
--  WHERE table_schema = 'public'
--    AND table_name   = 'companies'
--    AND column_name  = 'thank_you_url';
--   → 1 row.
--
-- SELECT id, name, public, file_size_limit FROM storage.buckets
--  WHERE id = 'city-photos';
--   → 1 row, public=true, file_size_limit=10485760.
--
-- SELECT polname, polcmd FROM pg_policy
--  WHERE polrelid = 'storage.objects'::regclass
--    AND polname LIKE 'city_photos_%';
--   → 4 rows (public_read, admin_insert, admin_update, admin_delete).
