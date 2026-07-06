-- =====================================================================
-- Phase 210 — offer-letters bucket: kill file ENUMERATION (PII exposure)
-- 2026-07-06 · Supabase Security Advisor: public_bucket_allows_listing
--
-- THE RISK: the offer-letter PDF embeds employee PAN + salary + address
--   (OfferLetterPDF.jsx). The `offer-letters` bucket is public AND carries
--   a broad SELECT policy on storage.objects → any client can `.list()`
--   the bucket, walk every folder, and download EVERY employee's PAN.
--
-- THE FIX (zero-risk, advisor's literal remediation): DROP the broad
--   public-read SELECT policy. For a PUBLIC bucket, object download by a
--   KNOWN url (getPublicUrl → /storage/v1/object/public/...) is served
--   WITHOUT the SELECT policy, so the app's 3 read links keep working and
--   the anon upload (an INSERT policy) is untouched. Only `.list()`
--   (enumeration) needs the SELECT policy → blocked. The unguessable
--   invite-token in each path (`{token}/{ts}.pdf`) is now the sole key.
--   No app code touched, no frozen file, no legacy-URL migration.
--
-- Verified: no `.list()` on offer-letters anywhere in src/ or api/; the 3
--   read sites (OfferForm, OfferDetailModal, MyOfferV2) use getPublicUrl
--   direct hrefs; upload is a plain .upload() INSERT.
--
-- ⚠ RESIDUAL (owner-aware): a public bucket still serves a KNOWN url, so a
--   leaked individual link stays downloadable. Fully closing that = make
--   the bucket private + signed URLs, which is a bigger migration touching
--   the anon new-hire upload + rep-reads-own storage RLS + legacy stored
--   public URLs + the frozen MyOfferV2 — proposed separately (higher live-
--   HR-flow risk). This file closes the mass-enumeration hole today.
--
-- Idempotent. §45-safe: policy metadata only.
-- =====================================================================

-- The advisor names the policy `offer-letters: public read`. Drop it (and a
-- couple of common alternate names) so re-runs are safe regardless of which
-- exact name exists.
DROP POLICY IF EXISTS "offer-letters: public read" ON storage.objects;
DROP POLICY IF EXISTS "offer-letters public read"  ON storage.objects;
DROP POLICY IF EXISTS "offer_letters_public_read"  ON storage.objects;

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────────
-- 1) No SELECT policy on storage.objects still scopes the offer-letters
--    bucket (→ .list() is blocked). Expect 0 rows.
SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND cmd = 'SELECT'
  AND (qual ILIKE '%offer-letters%' OR policyname ILIKE '%offer-letters%');

-- 2) Bucket still present + still public (direct known-URL download works).
SELECT id, public FROM storage.buckets WHERE id = 'offer-letters';

SELECT 'Phase 210 offer-letters listing revoked' AS status;
