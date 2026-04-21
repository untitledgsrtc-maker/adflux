-- =======================================================================
-- Storage bucket: quote-pdfs
-- =======================================================================
-- Purpose
--   Public bucket that holds the generated quotation PDFs so they can be
--   shared as a URL inside WhatsApp messages. WhatsApp click-to-chat
--   (wa.me) URLs only carry plaintext — they cannot attach files —
--   so the PDF has to live at a publicly reachable URL.
--
--   Upload path convention (enforced by the client, not SQL):
--     quote-pdfs/{quote_number}/{timestamp}.pdf
--   The timestamp means regenerating a PDF produces a new object rather
--   than overwriting the old one, so WhatsApp recipients never hit a
--   stale cache.
--
-- How to apply
--   Run this entire file in Supabase SQL Editor once. It is idempotent —
--   safe to re-run. No existing PDFs will be touched.
--
-- Security posture
--   Reads: public (anyone with the URL can open the PDF — same as if
--          you emailed it as an attachment).
--   Writes: authenticated users only. That covers every staff member
--          logged into the Adflux app. Anonymous web visitors cannot
--          upload.
-- =======================================================================

-- 1) Create the bucket (public read)
insert into storage.buckets (id, name, public)
values ('quote-pdfs', 'quote-pdfs', true)
on conflict (id) do update
  set public = excluded.public;

-- 2) RLS policies on storage.objects scoped to this bucket
--    (RLS is already enabled on storage.objects by Supabase defaults.)

-- Public read — anyone with the URL can download.
drop policy if exists "quote-pdfs: public read" on storage.objects;
create policy "quote-pdfs: public read"
  on storage.objects
  for select
  using ( bucket_id = 'quote-pdfs' );

-- Authenticated upload — any logged-in staff member can upload.
drop policy if exists "quote-pdfs: authenticated insert" on storage.objects;
create policy "quote-pdfs: authenticated insert"
  on storage.objects
  for insert
  to authenticated
  with check ( bucket_id = 'quote-pdfs' );

-- Authenticated update (upsert safety net — only fires when the client
-- passes upsert:true, which we currently don't, but keeping this policy
-- here means a future code change won't silently 403).
drop policy if exists "quote-pdfs: authenticated update" on storage.objects;
create policy "quote-pdfs: authenticated update"
  on storage.objects
  for update
  to authenticated
  using ( bucket_id = 'quote-pdfs' )
  with check ( bucket_id = 'quote-pdfs' );

-- Authenticated delete — lets an admin prune old PDFs through the
-- Supabase console or a future cleanup script. We do NOT expose delete
-- in the app UI right now.
drop policy if exists "quote-pdfs: authenticated delete" on storage.objects;
create policy "quote-pdfs: authenticated delete"
  on storage.objects
  for delete
  to authenticated
  using ( bucket_id = 'quote-pdfs' );
