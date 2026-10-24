-- Phase 499 (24 Oct 2026) - owner: clear the old forgotten manual faults before the new fault flow.
-- Scope: type fault, source manual, status open|in_progress, opened more than 2 days ago. Photo requests and auto tickets untouched.
-- Closed as 'cancelled'. Backup _bak_ops_tickets_p499 (KEEP 30 days then DROP). Idempotent.
BEGIN;
SET LOCAL session_replication_role = replica;
CREATE TABLE IF NOT EXISTS public._bak_ops_tickets_p499 AS SELECT t.*, now() AS bak_at FROM public.ops_tickets t WHERE false;
ALTER TABLE public._bak_ops_tickets_p499 ENABLE ROW LEVEL SECURITY;
WITH tgt AS (
  SELECT t.id FROM public.ops_tickets t
   WHERE t.type='fault' AND t.source='manual' AND t.status IN ('open','in_progress') AND t.opened_at < now() - interval '2 days'
     AND NOT EXISTS (SELECT 1 FROM public._bak_ops_tickets_p499 b WHERE b.id=t.id)
), ins AS (
  INSERT INTO public._bak_ops_tickets_p499 SELECT t.*, now() FROM public.ops_tickets t JOIN tgt USING (id) RETURNING id
)
UPDATE public.ops_tickets t SET status='cancelled', resolved_at=now(),
       notes=btrim(COALESCE(t.notes,'')||' [cleared by owner before the new system]'), updated_at=now()
  FROM ins WHERE t.id=ins.id;
SELECT 'cleared' k, count(*) n FROM public._bak_ops_tickets_p499
UNION ALL SELECT 'open_left', count(*) FROM public.ops_tickets WHERE status IN ('open','in_progress');
COMMIT;
-- UNDO: UPDATE ops_tickets t SET status=b.status, resolved_at=b.resolved_at, notes=b.notes, updated_at=b.updated_at FROM _bak_ops_tickets_p499 b WHERE b.id=t.id AND t.updated_at>=b.bak_at;
