-- supabase_phase88_realtime_publication.sql
--
-- Phase 88.6 — add lead_activities + follow_ups to the Supabase
-- realtime publication so useAutoRefresh can subscribe to live
-- INSERT/UPDATE events.
--
-- Owner directive 23 May 2026: 'make sure it musk work supper easy
-- the feely like its done in milisecons'. Tab-focus based refresh
-- (Phase 34Z.59) added the lag-killer for return-from-dialer; now
-- realtime push closes the second-tab-not-needed case too.
--
-- Idempotent. ALTER PUBLICATION ... ADD TABLE silently no-ops when
-- the table is already included (Postgres 14+ behaviour).

DO $$
BEGIN
  -- lead_activities — every meeting/call/note insert.
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_activities';
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN OTHERS THEN
      RAISE NOTICE 'lead_activities already in publication or other (%)', SQLERRM;
  END;

  -- follow_ups — insert, update, close.
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.follow_ups';
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN OTHERS THEN
      RAISE NOTICE 'follow_ups already in publication or other (%)', SQLERRM;
  END;
END$$;

NOTIFY pgrst, 'reload schema';

-- VERIFY
--   SELECT schemaname, tablename FROM pg_publication_tables
--    WHERE pubname = 'supabase_realtime'
--      AND tablename IN ('lead_activities', 'follow_ups')
--    ORDER BY tablename;
--   → 2 rows (one per table).
