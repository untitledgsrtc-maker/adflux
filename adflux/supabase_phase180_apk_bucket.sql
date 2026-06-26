-- ============================================================================
-- Phase 180 — `apk` storage bucket: hosts the signed APK for the in-app updater
-- ============================================================================
-- The branded download URL https://app.untitledad.in/apk (vercel.json redirect)
-- resolves to this bucket's public file `apk/untitled-os.apk`. The in-app updater
-- (AppUpdateBanner) downloads from app_version.apk_url; the rep's browser-fallback
-- bootstrap downloads from the same /apk redirect.
--
-- RELEASE FLOW: rebuild + sign the APK → upload it here, OVERWRITING
-- `apk/untitled-os.apk` (fixed name so the redirect never changes) → INSERT an
-- app_version row with apk_url = 'https://app.untitledad.in/apk?v=<versionCode>'
-- (the ?v= busts the CDN cache so reps get the new file, not a stale cached one).
--
-- Public read (anyone with the link can download — same as letterheads / avatars /
-- user-avatars). Write = admin / co_owner only. 60 MB cap (APK ~9-15 MB + headroom).
-- ADDITIVE — new bucket + its own policies. Touches no existing bucket.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('apk', 'apk', true, 62914560)   -- 60 MB
ON CONFLICT (id) DO UPDATE
  SET public          = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit;

-- Public SELECT — anyone with the link can download the APK.
DROP POLICY IF EXISTS apk_public_read ON storage.objects;
CREATE POLICY apk_public_read ON storage.objects
  FOR SELECT
  USING (bucket_id = 'apk');

-- INSERT / UPDATE / DELETE — admin / co_owner only (you publish releases).
DROP POLICY IF EXISTS apk_admin_insert ON storage.objects;
CREATE POLICY apk_admin_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'apk' AND public.get_my_role() IN ('admin', 'co_owner'));

DROP POLICY IF EXISTS apk_admin_update ON storage.objects;
CREATE POLICY apk_admin_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'apk' AND public.get_my_role() IN ('admin', 'co_owner'))
  WITH CHECK (bucket_id = 'apk' AND public.get_my_role() IN ('admin', 'co_owner'));

DROP POLICY IF EXISTS apk_admin_delete ON storage.objects;
CREATE POLICY apk_admin_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'apk' AND public.get_my_role() IN ('admin', 'co_owner'));

NOTIFY pgrst, 'reload schema';

-- VERIFY (read-only): expect bucket_public=true, policy_count=4.
-- SELECT
--   (SELECT public FROM storage.buckets WHERE id = 'apk')                     AS bucket_public,
--   (SELECT count(*) FROM pg_policy WHERE polrelid = 'storage.objects'::regclass
--      AND polname LIKE 'apk_%')                                              AS policy_count;
