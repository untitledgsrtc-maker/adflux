-- ============================================================================
-- Phase 199 — campaign media: storage bucket + broadcast header columns
-- ============================================================================
-- Support image/video/document HEADER templates on WhatsApp broadcasts. Owner
-- uploads a picture/video/PDF; it rides at the top of the template message.
--   • campaign-media bucket — holds the header creatives (public URL fed to
--     Meta as the header `link` at send time). 20 MB cap (WhatsApp video limit
--     is 16 MB; images/PDF far smaller).
--   • campaign_broadcasts gains header_type (image|video|document) +
--     header_media_url so the send path knows what header to attach.
-- Additive + idempotent (§8). Nothing existing reads these — text broadcasts
-- are unaffected (header_type NULL = no header). §45-safe.
-- ============================================================================

-- ---- 1) storage bucket for campaign header creatives ------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('campaign-media', 'campaign-media', true, 20971520)   -- 20 MB
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 20971520;

-- RLS: public read (Meta must fetch the header link); admin/co_owner write.
DROP POLICY IF EXISTS campaign_media_public_read ON storage.objects;
CREATE POLICY campaign_media_public_read ON storage.objects
  FOR SELECT USING (bucket_id = 'campaign-media');

DROP POLICY IF EXISTS campaign_media_admin_write ON storage.objects;
CREATE POLICY campaign_media_admin_write ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'campaign-media'
    AND public.get_my_role() IN ('admin', 'co_owner'));

DROP POLICY IF EXISTS campaign_media_admin_update ON storage.objects;
CREATE POLICY campaign_media_admin_update ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'campaign-media'
    AND public.get_my_role() IN ('admin', 'co_owner'));

DROP POLICY IF EXISTS campaign_media_admin_delete ON storage.objects;
CREATE POLICY campaign_media_admin_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'campaign-media'
    AND public.get_my_role() IN ('admin', 'co_owner'));

-- ---- 2) broadcast header columns -------------------------------------------
ALTER TABLE public.campaign_broadcasts
  ADD COLUMN IF NOT EXISTS header_type      text,   -- image | video | document | NULL
  ADD COLUMN IF NOT EXISTS header_media_url text;    -- public URL fed to Meta as header link

NOTIFY pgrst, 'reload schema';

-- VERIFY:
-- SELECT id, public, file_size_limit FROM storage.buckets WHERE id='campaign-media';
-- SELECT column_name FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='campaign_broadcasts'
--     AND column_name IN ('header_type','header_media_url');            -- 2 rows
-- SELECT count(*) FROM pg_policies WHERE tablename='objects'
--   AND policyname LIKE 'campaign_media_%';                            -- 4
