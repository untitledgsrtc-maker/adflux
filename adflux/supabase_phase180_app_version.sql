-- ============================================================================
-- Phase 180 — app_version: in-app APK update channel (2026-06-26)
-- ============================================================================
-- Backs the in-app "Update available" banner (AppUpdateBanner.jsx). The native
-- APK reads the latest active row, compares its installed versionCode, and if the
-- row is newer shows a dismissible banner -> tap -> download from apk_url.
--
-- HOW A RELEASE WORKS (after the self-updating APK is on devices):
--   1. Rebuild the signed APK with a bumped versionCode (android build.gradle).
--   2. Upload it to the apk_url host (app.untitledad.in/apk).
--   3. INSERT a new app_version row (version_code = the new versionCode).
--   Reps open the app -> banner -> 2 taps -> updated. No WhatsApp distribute.
--
-- SEED ROW = the CURRENT installed build (96010) so NO banner shows today — it
-- only appears once a NEWER row is inserted. ADDITIVE, new table, zero live touch.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.app_version (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_code int  NOT NULL,                 -- Android versionCode (the comparator)
  version_name text NOT NULL,                 -- human label, e.g. '0.96.11'
  apk_url      text NOT NULL,                 -- where the signed APK is downloaded from
  changelog    text,                          -- optional "what's new" (shown later)
  mandatory    boolean NOT NULL DEFAULT false, -- true = banner not dismissible (use sparingly)
  is_active    boolean NOT NULL DEFAULT true,  -- false = retire a bad release
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES public.users(id)
);

CREATE INDEX IF NOT EXISTS idx_app_version_active_code
  ON public.app_version (version_code DESC) WHERE is_active = true;

ALTER TABLE public.app_version ENABLE ROW LEVEL SECURITY;

-- Read: every authenticated user (the app needs to compare on launch).
DROP POLICY IF EXISTS app_version_read_all ON public.app_version;
CREATE POLICY app_version_read_all ON public.app_version
  FOR SELECT TO authenticated
  USING (true);

-- Write: admin / co_owner only (you publish releases).
DROP POLICY IF EXISTS app_version_admin_write ON public.app_version;
CREATE POLICY app_version_admin_write ON public.app_version
  FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin', 'co_owner'))
  WITH CHECK (public.get_my_role() IN ('admin', 'co_owner'));

-- Seed the CURRENT build so the banner stays hidden until the first real release.
INSERT INTO public.app_version (version_code, version_name, apk_url, changelog, is_active)
SELECT 96010, '0.96.10', 'https://app.untitledad.in/apk', 'Current build', true
WHERE NOT EXISTS (SELECT 1 FROM public.app_version);

NOTIFY pgrst, 'reload schema';

-- VERIFY (read-only): expect table_present=1, rls_count=2, latest = 96010 today.
-- SELECT
--   (SELECT count(*) FROM information_schema.tables
--      WHERE table_schema='public' AND table_name='app_version')                AS table_present,
--   (SELECT count(*) FROM pg_policies WHERE tablename='app_version')            AS rls_count,
--   (SELECT max(version_code) FROM public.app_version WHERE is_active)          AS latest_code;
