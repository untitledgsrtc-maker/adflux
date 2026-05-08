-- supabase_phase30f_gps_pings.sql
--
-- Phase 30F — GPS tracking module.
--
-- Owner spec (7 May 2026):
--   • Auto-fetch GPS at check-in (already wired — work_sessions.
--     check_in_gps_lat/lng).
--   • Every ~10 min thereafter while the rep is checked in, capture
--     a fresh GPS ping.
--   • Admin sees a per-day map line for each rep + total km driven.
--
-- Implementation note: iOS Safari PWAs cannot capture geolocation
-- in the background. The browser-side polling only fires while
-- /work is the foreground tab. Once the rep closes the tab, pings
-- pause. A native Capacitor wrapper is the answer for true
-- background tracking — see CLAUDE.md §0 for the deferred PWA →
-- Capacitor migration path.
--
-- Schema:
--   gps_pings(id, user_id, captured_at, lat, lng, accuracy_m, source)
--     source IN ('checkin','interval','checkout','manual')
--
-- RLS:
--   Sales / agency / telecaller / sales_manager → see + insert own.
--   Admin / co_owner → SELECT all (read-only on the map view).
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS public.gps_pings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  captured_at timestamptz NOT NULL DEFAULT now(),
  lat         numeric(10, 7) NOT NULL,
  lng         numeric(10, 7) NOT NULL,
  accuracy_m  integer,
  source      text NOT NULL DEFAULT 'interval'
              CHECK (source IN ('checkin','interval','checkout','manual')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Most reads are by (user_id, captured_at) for the day-map view.
-- A single composite index covers both the latest-N query and the
-- day-range query (WHERE user_id = X AND captured_at BETWEEN
-- '2026-05-08T00:00:00Z' AND '2026-05-08T23:59:59Z'). An earlier
-- attempt added a second index on (user_id, captured_at::date) but
-- timestamptz→date is not IMMUTABLE (depends on session timezone)
-- and Postgres rejects non-IMMUTABLE functions in index expressions
-- (ERROR 42P17). The single index is sufficient.
CREATE INDEX IF NOT EXISTS gps_pings_user_time_idx
  ON public.gps_pings (user_id, captured_at DESC);

-- Enable RLS
ALTER TABLE public.gps_pings ENABLE ROW LEVEL SECURITY;

-- Admin / co_owner — full read.
DROP POLICY IF EXISTS gps_pings_admin_all ON public.gps_pings;
CREATE POLICY gps_pings_admin_all ON public.gps_pings
  FOR ALL
  USING (public.get_my_role() IN ('admin','co_owner'));

-- Sales-side — own pings only, read + insert. No update / delete (the
-- track is meant to be tamper-evident).
DROP POLICY IF EXISTS gps_pings_sales_read_own ON public.gps_pings;
CREATE POLICY gps_pings_sales_read_own ON public.gps_pings
  FOR SELECT
  USING (
    public.get_my_role() IN ('sales','agency','telecaller','sales_manager')
    AND user_id = auth.uid()
  );

DROP POLICY IF EXISTS gps_pings_sales_insert_own ON public.gps_pings;
CREATE POLICY gps_pings_sales_insert_own ON public.gps_pings
  FOR INSERT
  WITH CHECK (
    public.get_my_role() IN ('sales','agency','telecaller','sales_manager')
    AND user_id = auth.uid()
  );

NOTIFY pgrst, 'reload schema';

-- VERIFY:
-- \d public.gps_pings
--   columns + indexes + RLS enabled.
--
-- SELECT polname, polcmd FROM pg_policy
--  WHERE polrelid = 'public.gps_pings'::regclass;
--   four rows: admin_all (ALL), sales_read_own (SELECT),
--   sales_insert_own (INSERT). (No UPDATE / DELETE — intentional.)
