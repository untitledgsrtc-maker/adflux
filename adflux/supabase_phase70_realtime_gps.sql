-- supabase_phase70_realtime_gps.sql
-- Phase 70.2 (22 May 2026) — enable Supabase Realtime on gps_pings.
--
-- Admin live map in TeamDashboardV2 subscribes to gps_pings INSERT
-- events to update rep markers without polling. Requires the table
-- to be part of supabase_realtime publication.
--
-- Idempotent: ALTER PUBLICATION ADD TABLE errors with 42710 if the
-- table is already in the publication. We swallow that specific
-- error so re-runs are safe.

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.gps_pings;
EXCEPTION
  WHEN duplicate_object THEN NULL;  -- already in publication
  WHEN undefined_object THEN
    RAISE NOTICE 'supabase_realtime publication missing; skipping';
END $$;

-- Confirm.
SELECT
  pubname,
  tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND tablename = 'gps_pings';

SELECT 'Phase 70.2 realtime gps_pings ready' AS status;
