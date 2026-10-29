-- ============================================================================
-- Phase 531 — remove the false "internet off" rows (one-time data clean)
-- ============================================================================
-- Evidence (29 Oct 2026): inside the recorded gaps the phone kept uploading GPS
-- pings live, so the phone was online and the gap never happened (native
-- onLost / VALIDATED flicker + a lost "online" signal; see src/utils/netGapTracker.js).
--
-- A row is removed ONLY when proven false: at least 3 GPS pings were UPLOADED
-- (server created_at) within 120 s of being captured, strictly inside the gap
-- (30 s margin each side). Rows with no pings, or whose pings were queued and
-- uploaded later (possible real outages), are KEPT.
-- Every removed row is first copied to network_off_events_false_backup_20261029
-- (RLS on, no policy = not readable through the API), so this is reversible.
-- Still-open rows that remain (unprovable, open for over a day) are closed at
-- their own start (zero length) so they stop showing as endless outages.
-- Idempotent: re-running finds nothing more to do.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.network_off_events_false_backup_20261029
  (LIKE public.network_off_events INCLUDING DEFAULTS);
ALTER TABLE public.network_off_events_false_backup_20261029 ENABLE ROW LEVEL SECURITY;

DROP TABLE IF EXISTS pg_temp._false_net_gaps;
CREATE TEMP TABLE _false_net_gaps AS
SELECT ev.id
  FROM public.network_off_events ev
  LEFT JOIN public.gps_pings p
         ON p.user_id = ev.user_id
        AND p.captured_at BETWEEN ev.lost_at AND COALESCE(ev.regained_at, now())
 GROUP BY ev.id, ev.lost_at, ev.regained_at
HAVING count(p.id) FILTER (
         WHERE p.created_at BETWEEN ev.lost_at + interval '30 seconds'
                                AND COALESCE(ev.regained_at, now()) - interval '30 seconds'
           AND p.created_at - p.captured_at < interval '120 seconds'
       ) >= 3;

INSERT INTO public.network_off_events_false_backup_20261029
SELECT e.* FROM public.network_off_events e
 WHERE e.id IN (SELECT id FROM _false_net_gaps)
   AND NOT EXISTS (SELECT 1 FROM public.network_off_events_false_backup_20261029 b WHERE b.id = e.id);

DELETE FROM public.network_off_events
 WHERE id IN (SELECT id FROM _false_net_gaps);

-- Remaining open rows older than a day: close at their own start (zero length).
INSERT INTO public.network_off_events_false_backup_20261029
SELECT e.* FROM public.network_off_events e
 WHERE e.regained_at IS NULL AND e.lost_at < now() - interval '1 day'
   AND NOT EXISTS (SELECT 1 FROM public.network_off_events_false_backup_20261029 b WHERE b.id = e.id);

UPDATE public.network_off_events
   SET regained_at = lost_at
 WHERE regained_at IS NULL AND lost_at < now() - interval '1 day';

DROP TABLE IF EXISTS pg_temp._false_net_gaps;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY (expect: backed_up ~ 1265+, open_old = 0, rows_left = 2170 - removed)
-- ============================================================================
-- SELECT (SELECT count(*) FROM public.network_off_events_false_backup_20261029) AS backed_up,
--        (SELECT count(*) FROM public.network_off_events WHERE regained_at IS NULL
--          AND lost_at < now() - interval '1 day') AS open_old,
--        (SELECT count(*) FROM public.network_off_events) AS rows_left;
