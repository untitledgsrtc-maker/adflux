-- Phase 498 (24 Oct 2026) - close OLD auto tickets whose station is fine now, before the new fault flow starts.
-- Scope: source auto_offline / auto_camera, status open|in_progress, opened more than 2 days ago.
--   auto_offline -> closed only if the station has NO offline active screen now.
--   auto_camera  -> closed only if the station has NO online active screen with camera_active=false now.
-- Closed as status 'cancelled' (not 'resolved', so fix stats are not polluted). Manual / photo tickets untouched.
-- Backup: _bak_ops_tickets_p498 (KEEP 30 days, then DROP). UNDO at the bottom. Idempotent.
BEGIN;
SET LOCAL session_replication_role = replica;  -- no push / trigger side effects
CREATE TABLE IF NOT EXISTS public._bak_ops_tickets_p498 AS SELECT t.*, now() AS bak_at FROM public.ops_tickets t WHERE false;
ALTER TABLE public._bak_ops_tickets_p498 ENABLE ROW LEVEL SECURITY;

WITH tgt AS (
  SELECT t.id FROM public.ops_tickets t
   WHERE t.status IN ('open','in_progress') AND t.opened_at < now() - interval '2 days'
     AND ( (t.source='auto_offline' AND NOT EXISTS (SELECT 1 FROM public.ops_screens s WHERE s.depot_id=t.depot_id AND s.is_active AND s.status='offline'))
        OR (t.source='auto_camera'  AND NOT EXISTS (SELECT 1 FROM public.ops_screens s WHERE s.depot_id=t.depot_id AND s.is_active AND s.status='online' AND s.camera_active=false)) )
     AND NOT EXISTS (SELECT 1 FROM public._bak_ops_tickets_p498 b WHERE b.id=t.id)
), ins AS (
  INSERT INTO public._bak_ops_tickets_p498 SELECT t.*, now() FROM public.ops_tickets t JOIN tgt USING (id) RETURNING id
)
UPDATE public.ops_tickets t SET status='cancelled', resolved_at=now(),
       notes=btrim(COALESCE(t.notes,'')||' [closed before the new system - station fine now]'), updated_at=now()
 FROM ins WHERE t.id=ins.id;

SELECT 'closed' k, count(*) n FROM public._bak_ops_tickets_p498
UNION ALL SELECT 'still_old_open', count(*) FROM public.ops_tickets WHERE status IN ('open','in_progress') AND opened_at < now()-interval '2 days';
COMMIT;

-- UNDO: UPDATE ops_tickets t SET status=b.status, resolved_at=b.resolved_at, notes=b.notes, updated_at=b.updated_at FROM _bak_ops_tickets_p498 b WHERE b.id=t.id AND t.updated_at>=b.bak_at;
