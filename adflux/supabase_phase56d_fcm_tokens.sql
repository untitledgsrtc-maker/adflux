-- supabase_phase56d_fcm_tokens.sql
-- Phase 56d — store FCM tokens in push_subscriptions for the
-- Capacitor Android wrapper.
-- 19 May 2026
--
-- Owner directive (18 May 2026):
--   "I want all day background fetched data with call n any other
--    requirement without any big setup on time setup"
--
-- The existing push_subscriptions table (Phase 33R) holds VAPID web
-- push triplets (endpoint, p256dh, auth) for browser subscriptions.
-- FCM tokens are a single string keyed by device, not a triplet.
-- Reuse the same table by:
--   1. Adding `platform` ('web' | 'android' | 'ios', default 'web')
--   2. Adding `fcm_token` (the raw FCM registration token)
--   3. Reusing `endpoint` as the unique key for both — for FCM rows
--      we store endpoint = 'fcm:<token>' so the existing UNIQUE
--      constraint doesn't collide with https:// web push endpoints.
--
-- RLS unchanged — same per-user policy (user can only insert /
-- delete their own rows).
--
-- Edge function update is a separate sprint. The send code today
-- assumes web push triplets. When the FCM branch lands it will
-- query rows where platform='android' and POST to the FCM HTTP v1
-- API using the project's service-account credential. Until then,
-- owner can test pushes from Firebase Console → Cloud Messaging
-- using a specific FCM token plucked from the table.

ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS platform  text NOT NULL DEFAULT 'web',
  ADD COLUMN IF NOT EXISTS fcm_token text;

ALTER TABLE public.push_subscriptions
  DROP CONSTRAINT IF EXISTS push_subscriptions_platform_check;
ALTER TABLE public.push_subscriptions
  ADD CONSTRAINT push_subscriptions_platform_check
  CHECK (platform IN ('web', 'android', 'ios'));

-- Index for the FCM-only query path the edge function will use.
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_platform
  ON public.push_subscriptions (platform, user_id)
  WHERE platform <> 'web';


NOTIFY pgrst, 'reload schema';


-- ─── VERIFY ──────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='push_subscriptions'
      AND column_name='platform')                                            AS platform_col,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='push_subscriptions'
      AND column_name='fcm_token')                                           AS fcm_token_col,
  (SELECT count(*) FROM information_schema.check_constraints
    WHERE constraint_schema='public'
      AND constraint_name='push_subscriptions_platform_check')               AS platform_check_present;
-- Expected: 1 · 1 · 1
