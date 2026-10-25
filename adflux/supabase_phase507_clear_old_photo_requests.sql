-- Clear (labelled Phase 507 when run; that number was also used by the Live-console tabs, section 501) - clear old open live-photo requests (owner 2026-10-25).
-- Cancels every OPEN photo_request older than 2 days. Backup first; UNDO at the bottom.
-- Backup table _bak_ops_tickets_p507: KEEP 30 days then DROP.
BEGIN;
SET LOCAL session_replication_role = replica;
CREATE TABLE IF NOT EXISTS public._bak_ops_tickets_p507 AS SELECT *, now() AS bak_at FROM public.ops_tickets WHERE false;
ALTER TABLE public._bak_ops_tickets_p507 ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.ops_tickets t
   WHERE t.type = 'photo_request' AND t.status = 'open' AND t.created_at < now() - interval '2 days';
  IF n > 40 THEN RAISE EXCEPTION 'Phase 507 aborted: % rows is more than expected', n; END IF;
  INSERT INTO public._bak_ops_tickets_p507
    SELECT t.*, now() FROM public.ops_tickets t
     WHERE t.type = 'photo_request' AND t.status = 'open' AND t.created_at < now() - interval '2 days'
       AND NOT EXISTS (SELECT 1 FROM public._bak_ops_tickets_p507 b WHERE b.id = t.id);
  UPDATE public.ops_tickets t
     SET status = 'cancelled', resolved_at = now(),
         notes = trim(both E'\n' from coalesce(t.notes,'') || E'\n[cancelled: old photo request cleared by owner 2026-10-25]'),
         updated_at = now()
   WHERE t.type = 'photo_request' AND t.status = 'open' AND t.created_at < now() - interval '2 days'
     AND EXISTS (SELECT 1 FROM public._bak_ops_tickets_p507 b WHERE b.id = t.id);
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'cancelled % old photo requests', n;
END $$;
-- VERIFY
SELECT (SELECT count(*) FROM public.ops_tickets WHERE type='photo_request' AND status='open') AS still_open_photo_requests,
       (SELECT count(*) FROM public._bak_ops_tickets_p507) AS backed_up;
COMMIT;
-- UNDO: UPDATE ops_tickets t SET status=b.status, resolved_at=b.resolved_at, notes=b.notes, updated_at=b.updated_at FROM _bak_ops_tickets_p507 b WHERE b.id=t.id AND t.status='cancelled';
