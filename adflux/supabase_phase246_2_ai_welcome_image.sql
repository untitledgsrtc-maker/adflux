-- supabase_phase246_2_ai_welcome_image.sql
--
-- Phase 246.2 — a WELCOME IMAGE the AI sends on the FIRST message of a new
-- WhatsApp chat (the owner's GSRTC LED poster). Additive + OFF unless a URL is
-- set. On first contact (no reply has gone out on the thread yet) the AI sends
-- this image once, then its normal text reply. Best-effort in the endpoint — a
-- bad/empty url never blocks the reply.

ALTER TABLE public.whatsapp_accounts ADD COLUMN IF NOT EXISTS ai_welcome_image_url text;
COMMENT ON COLUMN public.whatsapp_accounts.ai_welcome_image_url IS
  'Public image URL the AI sends once, on the first message of a new conversation. Empty = no welcome image. Must be a publicly reachable URL (Meta fetches it).';

NOTIFY pgrst, 'reload schema';

-- SET IT — after you host the poster and have its PUBLIC url (e.g. upload it via
-- Campaigns → Chatbot → Attach media → Upload, which gives a public
-- campaign-media URL):
--   UPDATE public.whatsapp_accounts
--      SET ai_welcome_image_url = '<PUBLIC_POSTER_URL>'
--    WHERE display_number LIKE '%578261%';
--
-- VERIFY:
--   SELECT display_number, ai_welcome_image_url
--     FROM public.whatsapp_accounts WHERE display_number LIKE '%578261%';
