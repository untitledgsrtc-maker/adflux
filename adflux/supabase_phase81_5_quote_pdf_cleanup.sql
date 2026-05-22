-- supabase_phase81_5_quote_pdf_cleanup.sql
--
-- Phase 81.5 — one-time cleanup of the old timestamped-PDF layout.
--
-- Owner directive 23 May 2026:
--   "don't store every version, only latest one. every regen
--    overwrites it"
--
-- Background: Phase 34Z.25 wrote PDFs as
--   quote-pdfs/{quote_number}/{timestamp_ms}.pdf
-- so a quote sent N times via WhatsApp produced N files. New
-- code (Phase 81.5, src/components/quotes/QuotePDFHtml.jsx) writes
-- a single file at the bucket root:
--   quote-pdfs/{quote_number}.pdf
-- This script deletes the OLD folder-per-quote layout. New uploads
-- via the updated frontend will repopulate the root-level path.
--
-- Run AFTER deploying the Phase 81.5 frontend so any in-flight
-- upload picks up the new layout.

-- Delete all rows whose `name` contains a slash (old folder layout).
-- The new path has no slashes ("UA-2026-0057.pdf"), so this is a
-- safe filter that won't touch the new format.
DELETE FROM storage.objects
 WHERE bucket_id = 'quote-pdfs'
   AND name LIKE '%/%';

-- VERIFY
-- SELECT COUNT(*) AS legacy_files
--   FROM storage.objects
--  WHERE bucket_id = 'quote-pdfs'
--    AND name LIKE '%/%';
--   → 0
--
-- SELECT name, created_at, metadata->>'size' AS size_bytes
--   FROM storage.objects
--  WHERE bucket_id = 'quote-pdfs'
--  ORDER BY created_at DESC
--  LIMIT 20;
--   → only flat filenames like 'UA-2026-0057.pdf' (after a fresh
--     WhatsApp send on the new code). Pre-cleanup the table will
--     be empty; the bucket re-populates as reps send quotes.
