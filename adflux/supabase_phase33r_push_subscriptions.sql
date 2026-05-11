-- supabase_phase33r_push_subscriptions.sql
--
-- Phase 33R — push notification subscriptions table.
--
-- Owner directives #2 / #3 / #15:
--   - Notification settings
--   - Push notification on every login
--   - Missed-task push notifications
--
-- This file lands the DATA layer + RLS. The SERVER side of push
-- (VAPID key generation, web-push library, Edge Function to fan
-- out notifications) still needs owner action — see commit message
-- on Phase 33R JSX commit for the full setup checklist.
--
-- Schema:
--   push_subscriptions — one row per browser/device per user.
--     Stored fields: endpoint, p256dh key, auth secret (from the
--     PushSubscription object), plus user-agent for debugging.
--     ON CONFLICT (endpoint) DO UPDATE so re-subscribing from the
--     same device replaces, doesn't duplicate.
--   user_notification_prefs — opt-in/out flags per category.

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint      text NOT NULL UNIQUE,
  p256dh        text NOT NULL,
  auth          text NOT NULL,
  user_agent    text,
  created_at    timestamptz DEFAULT now(),
  last_seen_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
  ON public.push_subscriptions (user_id);

CREATE TABLE IF NOT EXISTS public.user_notification_prefs (
  user_id           uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- Push category toggles. Default ON across the board; rep opts
  -- out via /settings/notifications.
  missed_followup   boolean NOT NULL DEFAULT true,
  missed_target     boolean NOT NULL DEFAULT true,
  new_lead_assigned boolean NOT NULL DEFAULT true,
  payment_received  boolean NOT NULL DEFAULT true,
  -- 7am-8pm IST quiet hours.
  quiet_hours_start int  NOT NULL DEFAULT 20,
  quiet_hours_end   int  NOT NULL DEFAULT 7,
  updated_at        timestamptz DEFAULT now()
);

-- RLS — rep manages own subscriptions + prefs.
ALTER TABLE public.push_subscriptions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_notification_prefs  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ps_self  ON public.push_subscriptions;
DROP POLICY IF EXISTS ps_admin ON public.push_subscriptions;
DROP POLICY IF EXISTS np_self  ON public.user_notification_prefs;

CREATE POLICY ps_self ON public.push_subscriptions
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY ps_admin ON public.push_subscriptions
  FOR SELECT USING (public.get_my_role() IN ('admin','co_owner'));

CREATE POLICY np_self ON public.user_notification_prefs
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

NOTIFY pgrst, 'reload schema';
