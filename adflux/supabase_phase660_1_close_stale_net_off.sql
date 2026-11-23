-- supabase_phase660_1_close_stale_net_off.sql (23-11-2026)
-- 9 old-recorder ("native_callback") internet-off rows from 14 Sep - 29 Oct were never
-- closed, so they read as 40,000-101,000 minute outages. Close each one at the first GPS
-- ping the phone UPLOADED after the loss (created_at = proof it was online again); if no
-- such ping exists, close it at lost_at (zero length). Data-only, idempotent: re-running
-- touches nothing because the WHERE only matches still-open rows.

UPDATE public.network_off_events n
   SET regained_at = c.closed_at,
       duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM (c.closed_at - n.lost_at)))::int
  FROM (
    SELECT o.id,
           COALESCE((SELECT min(p.created_at) FROM public.gps_pings p
                      WHERE p.user_id = o.user_id AND p.created_at > o.lost_at), o.lost_at) AS closed_at
      FROM public.network_off_events o
     WHERE o.regained_at IS NULL AND o.source = 'native_callback' AND o.lost_at < '2026-10-30'
  ) c
 WHERE n.id = c.id;

-- VERIFY: expect still_open_old = 0
SELECT count(*) AS still_open_old FROM public.network_off_events
 WHERE regained_at IS NULL AND source = 'native_callback' AND lost_at < '2026-10-30';
