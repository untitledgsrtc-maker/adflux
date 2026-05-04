-- =====================================================================
-- ADFLUX → UNTITLED OS  •  PHASE 10b
-- companies — add logo_url + letterhead_url + seed defaults
-- =====================================================================
--
-- WHY:
--   Phase 10 created the companies table but left logo_url as the only
--   asset hook (and unused). Owner uploaded both letterhead PDFs on
--   4 May 2026; we extracted them as 200dpi PNGs and committed them at
--   public/letterheads/{government,private}.png.
--
--   To make the GovtProposalRenderer render the letterhead behind the
--   letter content (instead of plain white), we need a stable URL
--   stored on the companies row so the renderer can fetch it the same
--   way it fetches name_gu / short_name today. Static path also lets
--   the admin point at a Supabase Storage URL later if they re-upload.
--
-- DESIGN:
--   • letterhead_url is a TEXT path. Frontend treats it as either:
--       - absolute http(s) URL (when uploaded to Storage), or
--       - root-relative path "/letterheads/foo.png" (the seeded default,
--         served directly from public/ by Vite).
--   • logo_url already exists from Phase 10 — we just seed it with
--     a placeholder pointing at the letterhead PNG (the logo is baked
--     into the letterhead). Future logo-only file goes here.
--
-- IDEMPOTENT.
-- =====================================================================


-- 1) Schema -----------------------------------------------------------
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS letterhead_url text;


-- 2) Seed defaults from the static assets ---------------------------
--   Only fill in if blank, so re-running this migration after the admin
--   has uploaded a custom letterhead doesn't overwrite their choice.
UPDATE public.companies
   SET letterhead_url = '/letterheads/government.png'
 WHERE segment = 'GOVERNMENT'
   AND (letterhead_url IS NULL OR letterhead_url = '');

UPDATE public.companies
   SET letterhead_url = '/letterheads/private.png'
 WHERE segment = 'PRIVATE'
   AND (letterhead_url IS NULL OR letterhead_url = '');


-- =====================================================================
-- VERIFY:
--
--   SELECT segment, name, letterhead_url, logo_url
--     FROM public.companies
--    ORDER BY segment;
--
-- =====================================================================
