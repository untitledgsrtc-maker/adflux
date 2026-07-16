-- supabase_campaign_media_library.sql
--
-- Campaign media LIBRARY — so the same image/video/PDF isn't re-uploaded every
-- time. The "attach media" control (chatbot builder / auto-reply) now offers
-- "pick from existing" + "upload new"; every upload adds a row here so it shows
-- up next time. Files still live in the existing `campaign-media` storage
-- bucket — this table is just the index (url + type + name) the picker lists.
--
-- Additive, idempotent, §45-safe (new table; no existing table/flow touched).
-- Admin/co_owner only (the campaign pages are admin-gated).

CREATE TABLE IF NOT EXISTS public.campaign_media (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url         text NOT NULL,
  media_type  text,          -- image | video | document
  name        text,
  uploaded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_media_url     ON public.campaign_media (url);
CREATE INDEX        IF NOT EXISTS idx_campaign_media_created ON public.campaign_media (created_at DESC);

ALTER TABLE public.campaign_media ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS campaign_media_admin_all ON public.campaign_media;
CREATE POLICY campaign_media_admin_all ON public.campaign_media FOR ALL
  USING      (public.get_my_role() IN ('admin', 'co_owner'))
  WITH CHECK (public.get_my_role() IN ('admin', 'co_owner'));

-- Backfill media already attached across the campaign so the library isn't
-- empty on day 1. Best-effort — if a table/column below doesn't exist in your
-- DB, that INSERT errors + is skipped; the CREATE + policy above already
-- committed, so just ignore the skipped line.
INSERT INTO public.campaign_media (url, media_type)
SELECT DISTINCT media_url, media_type FROM public.campaign_bot_rules
 WHERE media_url IS NOT NULL AND media_url <> ''
ON CONFLICT (url) DO NOTHING;

INSERT INTO public.campaign_media (url, media_type)
SELECT DISTINCT media_url, media_type FROM public.campaign_bot_buttons
 WHERE media_url IS NOT NULL AND media_url <> ''
ON CONFLICT (url) DO NOTHING;

INSERT INTO public.campaign_media (url, media_type)
SELECT DISTINCT auto_reply_media_url, 'image' FROM public.whatsapp_accounts
 WHERE auto_reply_media_url IS NOT NULL AND auto_reply_media_url <> ''
ON CONFLICT (url) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- VERIFY:
--   SELECT count(*) FROM public.campaign_media;
--   SELECT media_type, count(*) FROM public.campaign_media GROUP BY 1;
