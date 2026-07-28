-- =====================================================================
-- Phase 263 — whatsapp_messages.media_url (2026-07-27)
--
-- When we SEND media (AI city photo, post-call/brochure PDF, an inbox
-- attachment, a quote PDF) the message row logged only a text marker
-- ('[image]', '(attachment: name)') and dropped the link — so the
-- campaign inbox had nothing to render and showed the placeholder text
-- (owner: "I can't see the attachments/photos we shared").
--
-- media_id / media_mime (Phase C5) are the INBOUND Meta-proxy path only.
-- Outbound media is sent as a PUBLIC link we already know, so it needs a
-- plain url column. This adds it. The inbox renders an outbound row that
-- carries media_url (image inline, document/pdf as a download link).
--
-- Additive, nullable, idempotent — no existing code reads it; §45-safe.
-- Run this BEFORE pushing the Phase 263 code (the senders write media_url;
-- they retry without it if the column is missing, so a wrong order only
-- means the url isn't stored until this runs — never a broken send).
-- =====================================================================

ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS media_url text;

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'whatsapp_messages'
      AND column_name = 'media_url') AS media_url_present;
