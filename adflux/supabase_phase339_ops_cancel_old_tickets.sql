-- =====================================================================
-- supabase_phase339_ops_cancel_old_tickets.sql
-- Operations: close the leftover tickets the owner approved to close.
-- (Owner 2026-10-06: "Cancel the 20 old test tickets and the 1 on the retired
--  station? Cancel the 8 camera tickets whose camera is already back on? - ok
--  close it".)  Follows Phase 338 (section 326), which moved the real tickets to
--  Gohil and Gulshan and left these for the owner's decision.
--
-- WHAT IT DOES (ONE pass, SINGLE USE, backed up first):
--   cancel_test_leftover   the 20 manual tickets the inactive `test` account logged
--                          for itself (now held by Gohil / Gulshan after Phase 338),
--                          only while nobody has touched them since the move.
--   cancel_retired_depot   the 1 auto ticket still held by `test` on the retired
--                          "Test Untitled" station (no real technician exists).
--   cancel_camera_back     open auto_camera tickets whose station has NO online
--                          screen with a dead camera any more - the engine's own
--                          definition of a camera fault (status online AND
--                          camera_active = false). If a camera dies again the
--                          engine opens a fresh ticket on its next on-hours run.
--   Cancelling = status 'cancelled' + resolved_at + a plain-words note, the same
--   shape the engine itself uses. Nothing is deleted. Cancelled rows are ignored by
--   every "fixed" / average-fix metric (they only count status 'resolved').
--
-- SAFETY
--   * ops_tickets has no user triggers: no push, no WhatsApp, no cascade.
--   * Backup first into public._bak_ops_tickets_p339 (RLS on, no policies). KEEP 30
--     days, then DROP TABLE.
--   * Scope pinned: a DO block aborts everything unless exactly 20 test + 1 retired
--     + 8 camera rows are backed up (the counts the owner approved 2026-10-06).
--   * The UPDATE is driven from the backup and only touches a row still exactly as
--     backed up (same status / holder / updated_at); it sets updated_at to the
--     backup time, so a re-run is a no-op and UNDO can tell "untouched since".
--   * UNDO (only rows nobody has touched since):
--       UPDATE public.ops_tickets t
--          SET status = b.status, resolved_at = b.resolved_at, notes = b.notes,
--              updated_at = b.updated_at
--         FROM public._bak_ops_tickets_p339 b
--        WHERE b.id = t.id AND t.updated_at = b.bak_at;
--   * SINGLE USE: the backup copies ops_tickets column-for-column; if ops_tickets
--     gains a column later, do not re-run this file.
--   * Not a section 28 frozen contract; touches no sales / payroll / score table.
-- =====================================================================

-- ===== PART 1 - PREVIEW (read-only; run this alone first and eyeball) =====
-- SELECT 'test leftovers (manual, untouched since the move)' AS grp, count(*) AS n
--   FROM public.ops_tickets t JOIN public._bak_ops_tickets_p338 b ON b.id = t.id AND b.bak_action = 'repoint_manual'
--  WHERE t.status = 'open' AND t.source = 'manual' AND t.updated_at = b.bak_at
-- UNION ALL
-- SELECT 'retired station (auto, still on test)', count(*)
--   FROM public.ops_tickets t
--  WHERE t.assigned_to = '42978055-569f-4041-bdf3-344737b10039' AND t.status IN ('open','in_progress')
--    AND t.source IN ('auto_offline','auto_camera')
--    AND NOT EXISTS (SELECT 1 FROM public.ops_depots d WHERE d.id = t.depot_id AND d.is_active)
-- UNION ALL
-- SELECT 'camera is back on (no online screen with a dead camera)', count(*)
--   FROM public.ops_tickets t
--  WHERE t.source = 'auto_camera' AND t.status = 'open'
--    AND NOT EXISTS (SELECT 1 FROM public.ops_screens s WHERE s.depot_id = t.depot_id AND s.is_active
--                       AND s.status = 'online' AND s.camera_active = false);

-- ===== PART 1b - backup table (RLS locked) =====
CREATE TABLE IF NOT EXISTS public._bak_ops_tickets_p339 AS
  SELECT t.*, ''::text AS bak_action, now() AS bak_at
    FROM public.ops_tickets t
   WHERE false;
ALTER TABLE public._bak_ops_tickets_p339 ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX IF NOT EXISTS _bak_ops_tickets_p339_id_action
    ON public._bak_ops_tickets_p339 (id, bak_action);

-- ===== PART 2 - back up exactly the rows each cancel will touch =====
INSERT INTO public._bak_ops_tickets_p339
SELECT t.*, 'cancel_test_leftover', now()
  FROM public.ops_tickets t
  JOIN public._bak_ops_tickets_p338 b ON b.id = t.id AND b.bak_action = 'repoint_manual'
 WHERE t.status = 'open'
   AND t.source = 'manual'
   AND t.updated_at = b.bak_at
   AND NOT EXISTS (SELECT 1 FROM public._bak_ops_tickets_p339 x WHERE x.id = t.id AND x.bak_action = 'cancel_test_leftover');

INSERT INTO public._bak_ops_tickets_p339
SELECT t.*, 'cancel_retired_depot', now()
  FROM public.ops_tickets t
 WHERE t.assigned_to = '42978055-569f-4041-bdf3-344737b10039'
   AND t.status IN ('open', 'in_progress')
   AND t.source IN ('auto_offline', 'auto_camera')
   AND NOT EXISTS (SELECT 1 FROM public.ops_depots d WHERE d.id = t.depot_id AND d.is_active)
   AND NOT EXISTS (SELECT 1 FROM public._bak_ops_tickets_p339 x WHERE x.id = t.id AND x.bak_action = 'cancel_retired_depot');

INSERT INTO public._bak_ops_tickets_p339
SELECT t.*, 'cancel_camera_back', now()
  FROM public.ops_tickets t
 WHERE t.source = 'auto_camera'
   AND t.status = 'open'
   AND NOT EXISTS (SELECT 1 FROM public.ops_screens s
                    WHERE s.depot_id = t.depot_id AND s.is_active
                      AND s.status = 'online' AND s.camera_active = false)
   AND NOT EXISTS (SELECT 1 FROM public._bak_ops_tickets_p339 x WHERE x.id = t.id AND x.bak_action = 'cancel_camera_back');

-- ===== PART 2b - abort unless the live data is what the owner approved =====
DO $$
DECLARE v_test int; v_ret int; v_cam int;
BEGIN
  SELECT count(*) FILTER (WHERE bak_action = 'cancel_test_leftover'),
         count(*) FILTER (WHERE bak_action = 'cancel_retired_depot'),
         count(*) FILTER (WHERE bak_action = 'cancel_camera_back')
    INTO v_test, v_ret, v_cam
    FROM public._bak_ops_tickets_p339;
  IF v_test <> 20 OR v_ret <> 1 OR v_cam <> 8 THEN
    RAISE EXCEPTION 'Phase 339 aborted: expected 20 test + 1 retired + 8 camera tickets, found % + % + %. Nothing was changed - re-run the PART 1 preview.', v_test, v_ret, v_cam;
  END IF;
END $$;

-- ===== PART 3 - the cancel (driven from the backup; only rows still as backed up) =====
UPDATE public.ops_tickets t
   SET status      = 'cancelled',
       resolved_at = b.bak_at,
       notes       = COALESCE(t.notes, '') ||
                     CASE b.bak_action
                       WHEN 'cancel_test_leftover' THEN ' [cancelled: leftover from the test account]'
                       WHEN 'cancel_retired_depot' THEN ' [cancelled: retired test station]'
                       ELSE                             ' [cancelled: no online screen has a dead camera]'
                     END,
       updated_at  = b.bak_at
  FROM public._bak_ops_tickets_p339 b
 WHERE b.id = t.id
   AND b.bak_action IN ('cancel_test_leftover', 'cancel_retired_depot', 'cancel_camera_back')
   AND t.status      = b.status
   AND t.updated_at  = b.updated_at
   AND t.assigned_to IS NOT DISTINCT FROM b.assigned_to;

-- ===== VERIFY (expect: backed_up 20 / 1 / (the camera count), cancelled_ok = their sum, test_ticket_left = 0) =====
-- SELECT
--   (SELECT count(*) FROM public._bak_ops_tickets_p339 WHERE bak_action = 'cancel_test_leftover') AS backed_up_test,
--   (SELECT count(*) FROM public._bak_ops_tickets_p339 WHERE bak_action = 'cancel_retired_depot') AS backed_up_retired,
--   (SELECT count(*) FROM public._bak_ops_tickets_p339 WHERE bak_action = 'cancel_camera_back')   AS backed_up_camera,
--   (SELECT count(*) FROM public.ops_tickets t JOIN public._bak_ops_tickets_p339 b ON b.id = t.id
--      WHERE t.status = 'cancelled' AND t.updated_at = b.bak_at)                                  AS cancelled_ok,
--   (SELECT count(*) FROM public.ops_tickets t JOIN public.users u ON u.id = t.assigned_to
--      WHERE t.status IN ('open','in_progress') AND u.is_active IS NOT TRUE)                       AS still_stuck_on_inactive;
