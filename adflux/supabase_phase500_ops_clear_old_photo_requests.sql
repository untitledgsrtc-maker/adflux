-- Phase 500 (24 Oct 2026) - owner: clear stale photo requests (older than 7 days) before the new fault flow.
-- Scope: type photo_request, status open|in_progress, opened more than 7 days ago. Backup _bak_ops_tickets_p500 (KEEP 30 days then DROP).
BEGIN;
SET LOCAL session_replication_role = replica;
CREATE TABLE IF NOT EXISTS public._bak_ops_tickets_p500 AS SELECT t.*, now() AS bak_at FROM public.ops_tickets t WHERE false;
ALTER TABLE public._bak_ops_tickets_p500 ENABLE ROW LEVEL SECURITY;
WITH tgt AS (
  SELECT t.id FROM public.ops_tickets t
   WHERE t.type='photo_request' AND t.status IN ('open','in_progress') AND t.opened_at < now() - interval '7 days'
     AND NOT EXISTS (SELECT 1 FROM public._bak_ops_tickets_p500 b WHERE b.id=t.id)
), ins AS (
  INSERT INTO public._bak_ops_tickets_p500 SELECT t.*, now() FROM public.ops_tickets t JOIN tgt USING (id) RETURNING id
)
UPDATE public.ops_tickets t SET status='cancelled', resolved_at=now(),
       notes=btrim(COALESCE(t.notes,'')||' [stale photo request cleared by owner]'), updated_at=now()
  FROM ins WHERE t.id=ins.id;
SELECT 'cleared' k, count(*) n FROM public._bak_ops_tickets_p500
UNION ALL SELECT 'photo_left', count(*) FROM public.ops_tickets WHERE type='photo_request' AND status IN ('open','in_progress');
COMMIT;
-- UNDO: UPDATE ops_tickets t SET status=b.status, resolved_at=b.resolved_at, notes=b.notes, updated_at=b.updated_at FROM _bak_ops_tickets_p500 b WHERE b.id=t.id AND t.updated_at>=b.bak_at;
