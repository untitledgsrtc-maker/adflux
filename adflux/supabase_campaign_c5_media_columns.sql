-- =====================================================================
-- Campaign C5 — media columns so the Inbox can render inbound photos
-- 2026-06-09
--
-- The webhook stores an inbound media message's type ('image' etc.) but NOT
-- its Meta media id, so the Inbox could only show "[image]". These two
-- additive columns let api/wa/media proxy the real bytes on demand.
--
-- SAFE (§45): additive nullable columns on a NEW campaign table. No existing
-- code reads them; the webhook insert TOLERATES their absence (retries without
-- them), so the order of running this vs deploying the webhook does not matter.
-- Idempotent (ADD COLUMN IF NOT EXISTS).
-- =====================================================================

ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS media_id   text;
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS media_mime text;

-- Point-read index for api/wa/media's media_id lookup.
CREATE INDEX IF NOT EXISTS idx_wa_messages_media_id
  ON public.whatsapp_messages (media_id) WHERE media_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- VERIFY — both columns present (expect 2 rows: media_id, media_mime).
SELECT column_name
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'whatsapp_messages'
   AND column_name IN ('media_id', 'media_mime')
 ORDER BY column_name;

SELECT 'Campaign C5 media columns applied' AS status;
