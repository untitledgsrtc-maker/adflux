-- supabase_phase245_inbound_media_store.sql
--
-- Phase 245 — inbound WhatsApp media now PERSISTS. Fixes "customer sends an
-- image but it doesn't show in our inbox."
--
-- ROOT CAUSE (proven via Meta's own error, code 100 "Object does not exist"):
-- the inbox proxied media from Meta ON DEMAND and we stored only the media_id,
-- never the bytes. Meta DELETES media after a few days, so by the time anyone
-- opened the chat the bytes were gone → 502 → no image.
--
-- FIX: download the bytes to OUR OWN storage while Meta still has them (at
-- receipt in the webhook, + a lazy-cache in the proxy on first view), then the
-- inbox serves from storage forever — no re-fetch, no expiry, no render-time
-- Meta dependency. The render is unchanged (<img src="/api/wa/media?id=…">);
-- the proxy just serves from storage when present.
--
-- This SQL only creates the PRIVATE bucket. The bucket is service-role-only
-- (public=false): the webhook (write) and the /api/wa/media proxy (read) both
-- use the service role, which bypasses storage RLS — so NO storage policies are
-- needed and no public storage URL is ever minted (the storage layer is
-- unreachable except through our proxy — tighter than a public bucket).
--
-- NOTE on the Phase 243 GAP-1 residual (§113): this does NOT close it. The
-- /api/wa/media proxy gate (same-origin + media_id-exists, no per-user check) is
-- UNCHANGED. Persisting the bytes actually WIDENS GAP-1's window from ~days
-- (Meta retention) to forever — a media_id a same-origin caller already recorded
-- stays fetchable. Acceptable (the gate is unchanged, enumeration is infeasible
-- + rate-limited), but GAP-1's real fix (a signed short-lived token in the img
-- URL, or an authed fetch→blob render) is still OPEN. A retention/TTL cleanup of
-- old inbound media (see the tail of this file) bounds storage cost AND re-closes
-- GAP-1's window toward the old bounded behavior.
--
-- Additive, idempotent, §45-safe (new bucket; no existing table/flow touched).

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('campaign-inbound-media', 'campaign-inbound-media', false, 26214400)  -- 25 MB cap (covers image/video/audio; huge docs skip → proxy fetches while fresh)
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- VERIFY:
--   SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'campaign-inbound-media';
--   → one row, public = false, file_size_limit = 26214400

-- RETENTION (optional, run periodically — e.g. monthly — to bound storage cost
-- and re-close the GAP-1 window). Purges stored inbound media older than 6
-- months. Safe: the object name is the media_id; the proxy just re-fetches from
-- Meta if it's still fresh, else shows the placeholder (same as an un-stored id).
--   DELETE FROM storage.objects
--    WHERE bucket_id = 'campaign-inbound-media'
--      AND created_at < now() - interval '6 months';
