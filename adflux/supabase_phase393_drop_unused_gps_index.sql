-- Phase 393 - drop the never-used gps_pings_user_time_idx (107 MB, idx_scan = 0 on 18 Oct 2026).
-- It is written on every GPS ping and never read. Reversible: the CREATE below rebuilds it.
-- The live definition is read first and kept as a comment/backup row.
-- UNDO: run the definition stored in public._bak_dropped_indexes_p393.
BEGIN;
SET LOCAL lock_timeout = '3s';
CREATE TABLE IF NOT EXISTS public._bak_dropped_indexes_p393 (
  index_name text PRIMARY KEY, definition text, dropped_at timestamptz DEFAULT now());
ALTER TABLE public._bak_dropped_indexes_p393 ENABLE ROW LEVEL SECURITY;
INSERT INTO public._bak_dropped_indexes_p393 (index_name, definition)
SELECT indexname, indexdef FROM pg_indexes
 WHERE schemaname='public' AND indexname='gps_pings_user_time_idx'
ON CONFLICT DO NOTHING;
DROP INDEX IF EXISTS public.gps_pings_user_time_idx;
COMMIT;
-- VERIFY: backup row present, index gone, the other gps_pings indexes still there.
SELECT (SELECT count(*) FROM public._bak_dropped_indexes_p393 WHERE index_name='gps_pings_user_time_idx') AS backed_up,
       (SELECT count(*) FROM pg_indexes WHERE indexname='gps_pings_user_time_idx') AS still_exists,
       (SELECT string_agg(indexname, ', ') FROM pg_indexes WHERE tablename='gps_pings') AS remaining_indexes;
