-- =====================================================================
-- ADFLUX → UNTITLED OS  •  PHASE 11f
-- company-assets storage bucket + companies branding columns
-- =====================================================================
--
-- WHY (owner spec, 4 May 2026):
--   Two things in one shot:
--     1. The Companies tab needs FILE UPLOAD (not text URL paste) for
--        letterhead and logo. Build the public storage bucket they
--        upload into.
--     2. Owner reported "Save failed: Could not find the 'letterhead_url'
--        column" — the Phase 10b column-add migration was never run.
--        Re-add the columns here so this single file is enough.
--
--   Bucket is PUBLIC because letterheads need to be readable by every
--   authenticated user when they render a proposal PDF. Writes are
--   admin/owner/co_owner only — sales reps can't change branding.
--
-- DESIGN:
--   Path convention: <segment>/<kind>-<timestamp>.<ext>
--     e.g. GOVERNMENT/letterhead-1714824000000.png
--          PRIVATE/logo-1714824000000.png
--
-- IDEMPOTENT.
-- =====================================================================


-- 0) Re-ensure the branding columns exist on companies. ----------------
--    Idempotent — does nothing if Phase 10b already ran. Owner hit
--    "letterhead_url column not found" because that earlier migration
--    was skipped; this guarantees the column is there before the
--    Companies tab tries to UPDATE it.
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS letterhead_url text,
  ADD COLUMN IF NOT EXISTS logo_url       text;

-- Force PostgREST to refresh its schema cache so the new columns
-- become available to the API immediately (no manual restart needed).
NOTIFY pgrst, 'reload schema';


-- 1) Bucket -----------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('company-assets', 'company-assets', true, 10485760)  -- 10 MB cap
ON CONFLICT (id) DO UPDATE
  SET file_size_limit = EXCLUDED.file_size_limit,
      public          = EXCLUDED.public;


-- 2) Read: anyone authenticated --------------------------------------
DROP POLICY IF EXISTS "ca_read_authenticated" ON storage.objects;
CREATE POLICY "ca_read_authenticated"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'company-assets' AND auth.uid() IS NOT NULL);


-- 3) Insert / Update / Delete: admin / owner / co_owner only ---------
DROP POLICY IF EXISTS "ca_insert_admin"  ON storage.objects;
CREATE POLICY "ca_insert_admin"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'company-assets'
    AND public.get_my_role() IN ('admin', 'owner', 'co_owner')
  );

DROP POLICY IF EXISTS "ca_update_admin"  ON storage.objects;
CREATE POLICY "ca_update_admin"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'company-assets'
    AND public.get_my_role() IN ('admin', 'owner', 'co_owner')
  );

DROP POLICY IF EXISTS "ca_delete_admin"  ON storage.objects;
CREATE POLICY "ca_delete_admin"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'company-assets'
    AND public.get_my_role() IN ('admin', 'owner', 'co_owner')
  );


-- =====================================================================
-- VERIFY:
--   SELECT id, name, public, file_size_limit
--     FROM storage.buckets
--    WHERE id = 'company-assets';
--
--   SELECT polname, polcmd
--     FROM pg_policy
--    WHERE polrelid = 'storage.objects'::regclass
--      AND polname LIKE 'ca_%'
--    ORDER BY polname;
-- =====================================================================
