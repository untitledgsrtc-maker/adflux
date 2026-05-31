-- =====================================================================
-- ADFLUX → UNTITLED OS  •  PHASE 103.D.3 SQL
-- Index push_subscriptions.fcm_token for the ingest-gps Edge lookup
-- 2026-05-31 (Brijesh Solanki)
-- =====================================================================
--
-- WHY:
--   The Phase 103.D.3 Step 2 ingest-gps Edge Function maps a device's
--   FCM token → user_id on every background ping
--   (WHERE fcm_token = $1). push_subscriptions had no index on
--   fcm_token, so each call (including every garbage-token hit on the
--   public endpoint) was a sequential scan. Tiny today (~6-30 device
--   rows) but the endpoint is public + hit every ~2 min per active
--   rep, so index it now. Also makes the "garbage token is cheap"
--   DoS reasoning actually true (indexed 401 instead of seq-scan 401).
--
-- WHAT THIS DOES (idempotent):
--   Partial index on fcm_token (only non-null — web rows have null
--   fcm_token and never hit this lookup).
--
-- WHAT THIS DOES NOT TOUCH:
--   No RLS, no data, no other table. Pure read-path optimization.
-- =====================================================================

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_fcm_token
  ON public.push_subscriptions (fcm_token)
  WHERE fcm_token IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- VERIFY
-- =====================================================================
--   SELECT indexname FROM pg_indexes
--    WHERE schemaname='public' AND tablename='push_subscriptions'
--      AND indexname='idx_push_subscriptions_fcm_token';
--   Expected: 1 row.
-- =====================================================================
-- ROLLBACK
-- =====================================================================
--   DROP INDEX IF EXISTS public.idx_push_subscriptions_fcm_token;
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
