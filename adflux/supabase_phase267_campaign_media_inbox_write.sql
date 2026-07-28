-- =====================================================================
-- Phase 267 — campaign media library: let INBOX roles list + upload media
-- 2026-07-28
--
-- BUG (owner, campaign inbox — §138 parked): a telecaller tapping "Attach"
-- in the inbox composer hit TWO errors:
--   • "new row violates row-level security policy" — the campaign media
--     WRITE path was admin/co_owner ONLY:
--       - campaign_media table  → Phase 111 `campaign_media_admin_all` (FOR ALL)
--       - campaign-media bucket → Phase 199 `campaign_media_admin_write` (INSERT)
--     But the inbox is REP-FACING (Phase 205 reps reply / §242 reps see the
--     Inbox tab) — sales/telecaller/agency attach media to a customer chat.
--     Blocked. The library GRID was also empty for reps (table SELECT admin-only).
--   • "the object exceeded the maximum allowed size" — a file over the 20 MB
--     bucket cap (Phase 199). Fixed CLIENT-side in MediaPicker.jsx (a clear
--     "max 20 MB" message before upload). The 20 MB cap is UNCHANGED (WhatsApp
--     video is 16 MB; big videos ride as YouTube links, §127.1).
--
-- FIX (additive, §45-safe): open the media LIBRARY write (list + upload) to any
-- authenticated user. It is a SHARED, non-sensitive library of PUBLIC media URLs
-- (the bucket is already public-read, Phase 199) — reps already see this media in
-- the inbox. UPDATE/DELETE stay admin/co_owner ONLY (a rep can ADD to the library
-- but can't edit/delete other people's entries). Mirrors the §19 master-table
-- pattern: admin-all + read-all-authenticated (+ authenticated write).
--
-- Idempotent (DROP POLICY IF EXISTS then CREATE). Nothing existing regresses:
-- admin/co_owner keep FULL control via campaign_media_admin_all; the added
-- policies are permissive (OR-combined). §8.
-- =====================================================================

-- ---- 1) campaign_media TABLE: read + insert for all authenticated -----------
--        (admin/co_owner keep UPDATE/DELETE via campaign_media_admin_all FOR ALL.)
ALTER TABLE public.campaign_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS campaign_media_read_all ON public.campaign_media;
CREATE POLICY campaign_media_read_all ON public.campaign_media
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS campaign_media_insert_auth ON public.campaign_media;
CREATE POLICY campaign_media_insert_auth ON public.campaign_media
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- ---- 2) campaign-media STORAGE bucket: INSERT for all authenticated ---------
--        Replaces the Phase 199 admin-only write. UPDATE/DELETE + public read
--        (campaign_media_admin_update / _admin_delete / _public_read) UNTOUCHED.
DROP POLICY IF EXISTS campaign_media_admin_write ON storage.objects;
DROP POLICY IF EXISTS campaign_media_auth_write  ON storage.objects;
CREATE POLICY campaign_media_auth_write ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'campaign-media');

NOTIFY pgrst, 'reload schema';

-- ---- VERIFY -----------------------------------------------------------------
-- Expect: table_read=1, table_insert=1, bucket_write=1, bucket_admin_upd=1, bucket_admin_del=1
SELECT
  (SELECT count(*) FROM pg_policies
     WHERE schemaname='public' AND tablename='campaign_media'
       AND policyname='campaign_media_read_all')     AS table_read,
  (SELECT count(*) FROM pg_policies
     WHERE schemaname='public' AND tablename='campaign_media'
       AND policyname='campaign_media_insert_auth')  AS table_insert,
  (SELECT count(*) FROM pg_policies
     WHERE schemaname='storage' AND tablename='objects'
       AND policyname='campaign_media_auth_write')   AS bucket_write,
  (SELECT count(*) FROM pg_policies
     WHERE schemaname='storage' AND tablename='objects'
       AND policyname='campaign_media_admin_update') AS bucket_admin_upd,
  (SELECT count(*) FROM pg_policies
     WHERE schemaname='storage' AND tablename='objects'
       AND policyname='campaign_media_admin_delete') AS bucket_admin_del;
