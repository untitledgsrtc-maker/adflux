-- =====================================================================
-- supabase_phase338_ops_stuck_tickets_repoint.sql
-- Operations: hand the tickets stranded on the inactive `test` account to the
-- technician who really owns each station.
-- (Owner 2026-10-06: "repoint tickets - yes go", after the section 325 finding:
--  58 open / in_progress tickets were assigned to the inactive `test` user, so
--  Gulshan and Gohil saw none of them.)
--
-- WHAT IT DOES (ONE pass, SINGLE USE, backed up first):
--   MOVES every ticket that is open / in_progress and held by `test`, on an ACTIVE
--   station whose owner is an ACTIVE operation_executive, to that owner:
--       'repoint'        auto tickets (auto_offline / auto_camera)   expected 37
--       'repoint_manual' manual tickets `test` logged itself         expected 20
--   Only assigned_to and updated_at change. Status, notes, dates, photos are NOT touched.
--   LEFT ALONE on purpose: 1 auto ticket on the retired "Test Untitled" station
--   (no real technician exists for it) - shows up as still_stuck = 1 in VERIFY.
--   NOTHING IS CANCELLED here. Cancelling the old test tickets is a separate
--   decision for the owner - see the OPTIONAL block at the bottom (commented).
--
-- SAFETY
--   * ops_tickets has no user triggers, so this fires no push, no WhatsApp, no cascade.
--   * Scope is PINNED to the `test` account id and a DO-block aborts the whole file
--     unless the backup holds exactly 37 + 20 rows - if the live data drifted since
--     the review, nothing is changed.
--   * Every touched row is copied first into public._bak_ops_tickets_p338
--     (RLS on, no policies). KEEP that table at least 30 days, then DROP TABLE.
--   * The UPDATE is driven from the backup and only touches a row that is still
--     exactly as backed up (same holder, same status, same updated_at), and it sets
--     updated_at = the backup time. So a re-run changes nothing, and UNDO below can
--     recognise "rows nobody has touched since".
--   * UNDO (restores only rows nobody has worked on since this file ran):
--       UPDATE public.ops_tickets t
--          SET assigned_to = b.assigned_to, status = b.status, resolved_at = b.resolved_at,
--              notes = b.notes, updated_at = b.updated_at
--         FROM public._bak_ops_tickets_p338 b
--        WHERE b.id = t.id AND t.updated_at = b.bak_at;
--   * SINGLE USE: the backup copies ops_tickets column-for-column; if ops_tickets
--     gains a column later, drop this file instead of re-running it.
--   * Not a section 28 frozen contract; touches no sales / payroll / score table.
-- =====================================================================

-- ===== PART 1 - PREVIEW (read-only; run this alone first and eyeball) =====
-- SELECT CASE
--          WHEN t.source IN ('auto_offline','auto_camera') AND d.is_active AND owner.is_active
--               AND owner.role = 'operation_executive'                       THEN 'repoint to ' || owner.name
--          WHEN t.source = 'manual' AND d.is_active AND owner.is_active
--               AND owner.role = 'operation_executive'                       THEN 'repoint_manual to ' || owner.name
--          ELSE 'LEFT ALONE' END AS planned_action,
--        t.source, t.status, count(*) AS n
--   FROM public.ops_tickets t
--   JOIN public.users holder ON holder.id = t.assigned_to AND holder.is_active IS NOT TRUE
--   LEFT JOIN public.ops_depots d ON d.id = t.depot_id
--   LEFT JOIN public.users owner ON owner.id = d.assigned_to
--  WHERE t.status IN ('open','in_progress')
--  GROUP BY 1,2,3 ORDER BY 1,2,3;

-- ===== PART 1b - backup table (RLS locked) =====
CREATE TABLE IF NOT EXISTS public._bak_ops_tickets_p338 AS
  SELECT t.*, ''::text AS bak_action, now() AS bak_at
    FROM public.ops_tickets t
   WHERE false;
ALTER TABLE public._bak_ops_tickets_p338 ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX IF NOT EXISTS _bak_ops_tickets_p338_id_action
    ON public._bak_ops_tickets_p338 (id, bak_action);

-- ===== PART 2 - back up exactly the rows the move will touch =====
-- 42978055-569f-4041-bdf3-344737b10039 = the inactive `test` account.
INSERT INTO public._bak_ops_tickets_p338
SELECT t.*, 'repoint', now()
  FROM public.ops_tickets t
  JOIN public.ops_depots d ON d.id = t.depot_id AND d.is_active
  JOIN public.users owner  ON owner.id = d.assigned_to AND owner.is_active AND owner.role = 'operation_executive'
 WHERE t.assigned_to = '42978055-569f-4041-bdf3-344737b10039'
   AND t.status IN ('open', 'in_progress')
   AND t.source IN ('auto_offline', 'auto_camera')
   AND NOT EXISTS (SELECT 1 FROM public._bak_ops_tickets_p338 b WHERE b.id = t.id AND b.bak_action = 'repoint');

INSERT INTO public._bak_ops_tickets_p338
SELECT t.*, 'repoint_manual', now()
  FROM public.ops_tickets t
  JOIN public.ops_depots d ON d.id = t.depot_id AND d.is_active
  JOIN public.users owner  ON owner.id = d.assigned_to AND owner.is_active AND owner.role = 'operation_executive'
 WHERE t.assigned_to = '42978055-569f-4041-bdf3-344737b10039'
   AND t.status IN ('open', 'in_progress')
   AND t.source = 'manual'
   AND NOT EXISTS (SELECT 1 FROM public._bak_ops_tickets_p338 b WHERE b.id = t.id AND b.bak_action = 'repoint_manual');

-- ===== PART 2b - abort unless the live data is exactly what the owner approved =====
DO $$
DECLARE v_auto int; v_manual int;
BEGIN
  SELECT count(*) FILTER (WHERE bak_action = 'repoint'),
         count(*) FILTER (WHERE bak_action = 'repoint_manual')
    INTO v_auto, v_manual
    FROM public._bak_ops_tickets_p338;
  IF v_auto <> 37 OR v_manual <> 20 THEN
    RAISE EXCEPTION 'Phase 338 aborted: expected 37 auto + 20 manual tickets in the backup, found % + %. Nothing was changed - re-run the PART 1 preview.', v_auto, v_manual;
  END IF;
END $$;

-- ===== PART 3 - the move (driven from the backup; only rows still as backed up) =====
UPDATE public.ops_tickets t
   SET assigned_to = o.id,
       updated_at  = b.bak_at
  FROM public._bak_ops_tickets_p338 b
  JOIN public.ops_depots d ON d.id = b.depot_id AND d.is_active
  JOIN public.users o      ON o.id = d.assigned_to AND o.is_active AND o.role = 'operation_executive'
 WHERE b.id = t.id
   AND b.bak_action IN ('repoint', 'repoint_manual')
   AND t.assigned_to = b.assigned_to
   AND t.status      = b.status
   AND t.updated_at  = b.updated_at;

-- ===== OPTIONAL - ONLY IF THE OWNER SAYS "CANCEL" (NOT approved, NOT run) =====
-- (a) cancel the 20 test-account manual tickets, after the move (they now sit with Gohil / Gulshan):
-- UPDATE public.ops_tickets t
--    SET status = 'cancelled', resolved_at = now(),
--        notes = COALESCE(t.notes, '') || ' [cancelled: leftover from the test account]', updated_at = now()
--   FROM public._bak_ops_tickets_p338 b
--  WHERE b.id = t.id AND b.bak_action = 'repoint_manual' AND t.status = 'open' AND t.updated_at = b.bak_at;
-- (b) cancel the 1 auto ticket on the retired "Test Untitled" station (back it up first):
-- INSERT INTO public._bak_ops_tickets_p338
-- SELECT t.*, 'cancel_retired_depot', now() FROM public.ops_tickets t
--   LEFT JOIN public.ops_depots d ON d.id = t.depot_id
--  WHERE t.assigned_to = '42978055-569f-4041-bdf3-344737b10039' AND t.status IN ('open','in_progress')
--    AND t.source IN ('auto_offline','auto_camera') AND (d.id IS NULL OR d.is_active IS NOT TRUE)
--    AND NOT EXISTS (SELECT 1 FROM public._bak_ops_tickets_p338 b WHERE b.id = t.id AND b.bak_action = 'cancel_retired_depot');
-- UPDATE public.ops_tickets t
--    SET status = 'cancelled', resolved_at = now(),
--        notes = COALESCE(t.notes, '') || ' [cancelled: retired test station]', updated_at = now()
--   FROM public._bak_ops_tickets_p338 b
--  WHERE b.id = t.id AND b.bak_action = 'cancel_retired_depot' AND t.status IN ('open','in_progress');

-- ===== VERIFY (expect: still_stuck_on_inactive = 1 [the retired-station ticket], backed_up 37 / 20, moved_ok 57) =====
-- SELECT
--   (SELECT count(*) FROM public.ops_tickets t JOIN public.users u ON u.id = t.assigned_to
--      WHERE t.status IN ('open','in_progress') AND u.is_active IS NOT TRUE)                       AS still_stuck_on_inactive,
--   (SELECT count(*) FROM public._bak_ops_tickets_p338 WHERE bak_action = 'repoint')               AS backed_up_auto,
--   (SELECT count(*) FROM public._bak_ops_tickets_p338 WHERE bak_action = 'repoint_manual')        AS backed_up_manual,
--   (SELECT count(*) FROM public.ops_tickets t JOIN public._bak_ops_tickets_p338 b ON b.id = t.id
--      WHERE b.bak_action IN ('repoint','repoint_manual')
--        AND t.assigned_to <> b.assigned_to AND t.status = b.status AND t.updated_at = b.bak_at)   AS moved_ok;
-- SELECT u.name, t.source, t.status, count(*) FROM public.ops_tickets t JOIN public.users u ON u.id = t.assigned_to
--  WHERE t.status IN ('open','in_progress') GROUP BY 1,2,3 ORDER BY 1,2,3;
