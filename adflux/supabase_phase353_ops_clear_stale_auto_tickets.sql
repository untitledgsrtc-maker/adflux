-- ============================================================================
-- Phase 353 - clear the 22 STALE auto "screens offline" tickets from 27-28 Aug 2026
-- ============================================================================
-- WHY (owner-approved 2026-10-08, with Phase 350/352): these 22 auto tickets are ~40 days old and
-- their counts are out of date (e.g. Dwarka says 2 screens, 10 are down now; Godhra and Himmatnagar
-- each hold TWO tickets). They were the reason the technicians' ticket list looked wrong and why
-- alerts did not read true. Cancelling them lets the engine (ops_reconcile_offline_tickets) open ONE
-- fresh ticket per station on the next on-hours sync with the right count and today's date.
--
-- WHEN: run at night on purpose. The engine only opens tickets 07:00-21:00 IST, and since Phase 352
-- it sends its own WhatsApp / push only inside 09:00-20:59 IST. So tickets reopened at 07:xx send
-- NOTHING; the technicians get ONE collapsed push at the first 09:00+ sync from ops_notify_outages().
-- (Doing this after 09:00 would make the engine WhatsApp the technician once per reopened station.)
--
-- SAFE: nothing is deleted. Status becomes 'cancelled' + a plain note. A backup of every touched row is kept in
-- public._bak_ops_tickets_p353 (RLS on, no policies; KEEP 30 days, then DROP TABLE). Scope is pinned
-- (auto_offline, open / in_progress, opened before 2026-10-01) and the script ABORTS unless exactly 22 rows match.
-- Only rows still exactly as backed up are touched, so a re-run changes nothing and an UNDO can tell
-- "untouched since" from "someone worked on it". Manual, camera, sales-request tickets are never touched.
-- No push fires: the resolved-push trigger only reacts to status 'resolved' and the assignment trigger
-- only to a changed assigned_to.
--
-- UNDO (only rows nobody has touched since):
--   UPDATE public.ops_tickets t SET status=b.status, resolved_at=b.resolved_at, notes=b.notes, updated_at=b.updated_at
--     FROM public._bak_ops_tickets_p353 b WHERE b.id=t.id AND t.status='cancelled' AND t.updated_at=b.bak_at;
-- ============================================================================

CREATE TABLE IF NOT EXISTS public._bak_ops_tickets_p353 AS
  SELECT t.*, now() AS bak_at FROM public.ops_tickets t WHERE false;
ALTER TABLE public._bak_ops_tickets_p353 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._bak_ops_tickets_p353 FROM PUBLIC, anon, authenticated;

DO $guard$
DECLARE v_scope int; v_bak int;
BEGIN
  SELECT count(*) INTO v_scope FROM public.ops_tickets t
   WHERE t.source = 'auto_offline' AND t.status IN ('open','in_progress')
     AND t.opened_at < '2026-10-01'::timestamptz;
  SELECT count(*) INTO v_bak FROM public._bak_ops_tickets_p353;
  -- first run: exactly the 22 approved rows. Re-run: they are already cancelled (0) and the backup holds 22.
  IF NOT ((v_scope = 22 AND v_bak = 0) OR (v_scope = 0 AND v_bak = 22)) THEN
    RAISE EXCEPTION 'Phase 353 aborted: expected 22 stale tickets (found % in scope, % in backup)', v_scope, v_bak;
  END IF;
END
$guard$;

-- 1 . back up (stamp bak_at = the time we also write to updated_at, so the UNDO can verify "untouched since")
WITH ts AS (SELECT now() AS n)
INSERT INTO public._bak_ops_tickets_p353
  SELECT t.*, (SELECT n FROM ts)
    FROM public.ops_tickets t
   WHERE t.source = 'auto_offline' AND t.status IN ('open','in_progress')
     AND t.opened_at < '2026-10-01'::timestamptz
     AND NOT EXISTS (SELECT 1 FROM public._bak_ops_tickets_p353 b WHERE b.id = t.id);

-- 2 . cancel exactly the backed-up rows that are still as backed up
UPDATE public.ops_tickets t
   SET status      = 'cancelled',
       resolved_at = b.bak_at,
       notes       = COALESCE(t.notes, '') || ' [stale-cleared Phase 353: 40-day-old auto ticket with an out-of-date count; the engine opens a fresh one]',
       updated_at  = b.bak_at
  FROM public._bak_ops_tickets_p353 b
 WHERE b.id = t.id
   AND t.status = b.status
   AND t.updated_at IS NOT DISTINCT FROM b.updated_at;

-- VERIFY (read-only): expect backed_up=22, cancelled_now=22, still_stale_open=0, other_open_untouched=the rest
SELECT
  (SELECT count(*) FROM public._bak_ops_tickets_p353)                                                   AS backed_up,
  (SELECT count(*) FROM public.ops_tickets t JOIN public._bak_ops_tickets_p353 b ON b.id = t.id
    WHERE t.status = 'cancelled')                                                                       AS cancelled_now,
  (SELECT count(*) FROM public.ops_tickets t
    WHERE t.source = 'auto_offline' AND t.status IN ('open','in_progress')
      AND t.opened_at < '2026-10-01'::timestamptz)                                                      AS still_stale_open,
  (SELECT count(*) FROM public.ops_tickets WHERE source = 'auto_camera' AND status IN ('open','in_progress')) AS camera_tickets_untouched,
  (SELECT count(*) FROM public.ops_tickets WHERE source = 'manual'      AND status IN ('open','in_progress')) AS manual_tickets_untouched;
