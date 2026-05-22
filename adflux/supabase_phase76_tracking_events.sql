-- supabase_phase76_tracking_events.sql
--
-- Phase 76 — Evening Day Summary + GPS lockdown tracking.
--
-- Owner directive (22 May 2026):
--   "let do at evening clik on summry, we detect all activity and
--    share via whats app. ex, total meeting 4/5, total follow up 9/20,
--    gps turn off manuall 10 times, internet off 3 times"
--
-- Scope locked:
--   • Track GPS toggle off/on cycles (native Android only — browser
--     cannot detect system GPS toggle).
--   • Track internet drop cycles (browser + native).
--   • Track app force-stop / kill gaps (native heartbeat, 60s tick).
--   • Track productive-button blocks when GPS off (UI events).
--   • Evening Day Summary card on /work auto-appears 7 PM IST; rep
--     taps "Send to WhatsApp" → opens whatsapp://send with role-aware
--     formatted text → rep picks role group manually.
--   • No score penalty (owner: "no need right now").
--   • No server-side auto-send (manual rep tap for v1).
--
-- Idempotent. Adds 4 tables + 1 column + 1 unique constraint.

-- ─────────────────────────────────────────────────────────────────
-- 1) gps_off_events — every cycle the rep flips Location off & on.
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gps_off_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  toggled_off_at   timestamptz NOT NULL,
  toggled_on_at    timestamptz,              -- nullable until rep re-enables
  duration_seconds integer,                  -- computed when toggled_on_at set
  source           text NOT NULL DEFAULT 'native_receiver'
                   CHECK (source IN ('native_receiver','foreground_probe')),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gps_off_events_user_time_idx
  ON public.gps_off_events (user_id, toggled_off_at DESC);

-- Auto-compute duration when toggled_on_at is set.
CREATE OR REPLACE FUNCTION public.gps_off_events_compute_duration()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.toggled_on_at IS NOT NULL THEN
    NEW.duration_seconds :=
      GREATEST(0, EXTRACT(EPOCH FROM (NEW.toggled_on_at - NEW.toggled_off_at))::integer);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gps_off_events_duration ON public.gps_off_events;
CREATE TRIGGER trg_gps_off_events_duration
  BEFORE INSERT OR UPDATE ON public.gps_off_events
  FOR EACH ROW EXECUTE FUNCTION public.gps_off_events_compute_duration();

ALTER TABLE public.gps_off_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gps_off_events_admin_all ON public.gps_off_events;
CREATE POLICY gps_off_events_admin_all ON public.gps_off_events
  FOR ALL
  USING (public.get_my_role() IN ('admin','co_owner'));

DROP POLICY IF EXISTS gps_off_events_self_read ON public.gps_off_events;
CREATE POLICY gps_off_events_self_read ON public.gps_off_events
  FOR SELECT
  USING (
    public.get_my_role() IN ('sales','agency','telecaller','sales_manager')
    AND user_id = auth.uid()
  );

DROP POLICY IF EXISTS gps_off_events_self_write ON public.gps_off_events;
CREATE POLICY gps_off_events_self_write ON public.gps_off_events
  FOR INSERT
  WITH CHECK (
    public.get_my_role() IN ('sales','agency','telecaller','sales_manager')
    AND user_id = auth.uid()
  );

-- Rep needs UPDATE to close the cycle (set toggled_on_at). Restricted
-- to rows where toggled_on_at is still NULL — can't rewrite history.
DROP POLICY IF EXISTS gps_off_events_self_close ON public.gps_off_events;
CREATE POLICY gps_off_events_self_close ON public.gps_off_events
  FOR UPDATE
  USING (
    public.get_my_role() IN ('sales','agency','telecaller','sales_manager')
    AND user_id = auth.uid()
    AND toggled_on_at IS NULL
  )
  WITH CHECK (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────
-- 2) network_off_events — every cycle the device drops internet.
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.network_off_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  lost_at          timestamptz NOT NULL,
  regained_at      timestamptz,
  duration_seconds integer,
  source           text NOT NULL DEFAULT 'native_callback'
                   CHECK (source IN ('native_callback','browser_event')),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS network_off_events_user_time_idx
  ON public.network_off_events (user_id, lost_at DESC);

CREATE OR REPLACE FUNCTION public.network_off_events_compute_duration()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.regained_at IS NOT NULL THEN
    NEW.duration_seconds :=
      GREATEST(0, EXTRACT(EPOCH FROM (NEW.regained_at - NEW.lost_at))::integer);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_network_off_events_duration ON public.network_off_events;
CREATE TRIGGER trg_network_off_events_duration
  BEFORE INSERT OR UPDATE ON public.network_off_events
  FOR EACH ROW EXECUTE FUNCTION public.network_off_events_compute_duration();

ALTER TABLE public.network_off_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS network_off_events_admin_all ON public.network_off_events;
CREATE POLICY network_off_events_admin_all ON public.network_off_events
  FOR ALL
  USING (public.get_my_role() IN ('admin','co_owner'));

DROP POLICY IF EXISTS network_off_events_self_read ON public.network_off_events;
CREATE POLICY network_off_events_self_read ON public.network_off_events
  FOR SELECT
  USING (
    public.get_my_role() IN ('sales','agency','telecaller','sales_manager')
    AND user_id = auth.uid()
  );

DROP POLICY IF EXISTS network_off_events_self_write ON public.network_off_events;
CREATE POLICY network_off_events_self_write ON public.network_off_events
  FOR INSERT
  WITH CHECK (
    public.get_my_role() IN ('sales','agency','telecaller','sales_manager')
    AND user_id = auth.uid()
  );

DROP POLICY IF EXISTS network_off_events_self_close ON public.network_off_events;
CREATE POLICY network_off_events_self_close ON public.network_off_events
  FOR UPDATE
  USING (
    public.get_my_role() IN ('sales','agency','telecaller','sales_manager')
    AND user_id = auth.uid()
    AND regained_at IS NULL
  )
  WITH CHECK (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────
-- 3) force_stop_events — heartbeat gaps detected on next app launch.
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.force_stop_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  last_seen_at    timestamptz NOT NULL,
  relaunched_at   timestamptz NOT NULL,
  gap_seconds     integer NOT NULL,
  during_work_hours boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS force_stop_events_user_time_idx
  ON public.force_stop_events (user_id, relaunched_at DESC);

ALTER TABLE public.force_stop_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS force_stop_events_admin_all ON public.force_stop_events;
CREATE POLICY force_stop_events_admin_all ON public.force_stop_events
  FOR ALL
  USING (public.get_my_role() IN ('admin','co_owner'));

DROP POLICY IF EXISTS force_stop_events_self_read ON public.force_stop_events;
CREATE POLICY force_stop_events_self_read ON public.force_stop_events
  FOR SELECT
  USING (
    public.get_my_role() IN ('sales','agency','telecaller','sales_manager')
    AND user_id = auth.uid()
  );

DROP POLICY IF EXISTS force_stop_events_self_write ON public.force_stop_events;
CREATE POLICY force_stop_events_self_write ON public.force_stop_events
  FOR INSERT
  WITH CHECK (
    public.get_my_role() IN ('sales','agency','telecaller','sales_manager')
    AND user_id = auth.uid()
  );

-- ─────────────────────────────────────────────────────────────────
-- 4) gps_block_events — UI banner blocks (user tried productive
--    action while GPS off). Useful as a behavioural signal even
--    without score penalty.
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gps_block_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  action_attempted  text NOT NULL
                    CHECK (action_attempted IN (
                      'start_day','i_am_here','log_meeting','log_lead',
                      'mark_followup_done','quote_sent'
                    )),
  blocked_at        timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz,           -- when rep tapped Turn on GPS
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gps_block_events_user_time_idx
  ON public.gps_block_events (user_id, blocked_at DESC);

ALTER TABLE public.gps_block_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gps_block_events_admin_all ON public.gps_block_events;
CREATE POLICY gps_block_events_admin_all ON public.gps_block_events
  FOR ALL
  USING (public.get_my_role() IN ('admin','co_owner'));

DROP POLICY IF EXISTS gps_block_events_self_read ON public.gps_block_events;
CREATE POLICY gps_block_events_self_read ON public.gps_block_events
  FOR SELECT
  USING (
    public.get_my_role() IN ('sales','agency','telecaller','sales_manager')
    AND user_id = auth.uid()
  );

DROP POLICY IF EXISTS gps_block_events_self_write ON public.gps_block_events;
CREATE POLICY gps_block_events_self_write ON public.gps_block_events
  FOR INSERT
  WITH CHECK (
    public.get_my_role() IN ('sales','agency','telecaller','sales_manager')
    AND user_id = auth.uid()
  );

DROP POLICY IF EXISTS gps_block_events_self_resolve ON public.gps_block_events;
CREATE POLICY gps_block_events_self_resolve ON public.gps_block_events
  FOR UPDATE
  USING (
    public.get_my_role() IN ('sales','agency','telecaller','sales_manager')
    AND user_id = auth.uid()
    AND resolved_at IS NULL
  )
  WITH CHECK (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────
-- 5) work_sessions.evening_summary_sent_at — dedup column so the
--    optional 7:30 PM auto-send (Phase 77) doesn't double-fire when
--    the rep already shared manually.
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE public.work_sessions
  ADD COLUMN IF NOT EXISTS evening_summary_sent_at timestamptz;

-- ─────────────────────────────────────────────────────────────────
-- 6) gps_pings dedup — unique (user_id, captured_at).
--    Phase 76 offline queue retries the same ping when network
--    returns. Without this constraint, retries double-insert and
--    inflate daily_ta km counts.
--
--    Use the immutable-friendly partial index. timestamptz comparison
--    is IMMUTABLE so this is safe.
-- ─────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname  = 'gps_pings_user_captured_uniq'
  ) THEN
    -- Clean any pre-existing dupes before creating the constraint.
    -- Keep the row with the smallest id per (user_id, captured_at).
    DELETE FROM public.gps_pings p
     USING public.gps_pings q
     WHERE p.user_id     = q.user_id
       AND p.captured_at = q.captured_at
       AND p.id          > q.id;
    CREATE UNIQUE INDEX gps_pings_user_captured_uniq
      ON public.gps_pings (user_id, captured_at);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────
-- VERIFY
-- ─────────────────────────────────────────────────────────────────
--
-- SELECT table_name FROM information_schema.tables
--  WHERE table_schema = 'public'
--    AND table_name IN ('gps_off_events','network_off_events',
--                       'force_stop_events','gps_block_events')
--  ORDER BY table_name;
--   → 4 rows.
--
-- SELECT column_name FROM information_schema.columns
--  WHERE table_schema = 'public'
--    AND table_name   = 'work_sessions'
--    AND column_name  = 'evening_summary_sent_at';
--   → 1 row.
--
-- SELECT indexname FROM pg_indexes
--  WHERE schemaname = 'public'
--    AND indexname  = 'gps_pings_user_captured_uniq';
--   → 1 row.
--
-- SELECT polname, polcmd FROM pg_policy
--  WHERE polrelid::text LIKE 'public.gps_off_events%'
--     OR polrelid::text LIKE 'public.network_off_events%'
--     OR polrelid::text LIKE 'public.force_stop_events%'
--     OR polrelid::text LIKE 'public.gps_block_events%';
--   → 14 rows (4 admin_all + 4 self_read + 4 self_write + 2 self_close
--               + 1 self_resolve, give or take).
