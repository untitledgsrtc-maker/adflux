-- ============================================================================
-- db/functions/ops_depot_owner_change_move_tickets.sql  -  THE CANONICAL HOME
-- ============================================================================
-- Operations: when a STATION is handed to a different technician
-- (ops_depots.assigned_to changes), its open work follows him.
--
-- WHY: Phase 338 (CLAUDE.md section 326) found 58 open tickets stranded on the
--   inactive `test` account. Reassigning a depot moved the depot but NOT the
--   tickets already open on it, so the real technicians saw none of them - and the
--   auto-ticket engine, which dedups on "an open auto ticket exists for this
--   depot" regardless of who holds it, kept the depot silent. Owner 2026-10-06:
--   "reassigning a station should also move its open tickets - yes". Same idea as
--   the lead-owner transfer (section 130 / 323).
--
-- WHAT: after UPDATE OF assigned_to on ops_depots, the depot's tickets follow the
--   new owner:
--     * OPEN tickets move if held by nobody, by the PREVIOUS owner, or by a user
--       who is no longer active;
--     * IN-PROGRESS tickets (a technician already started the job) stay with him,
--       and move ONLY if he is gone (held by nobody / an inactive user).
--   A ticket the head deliberately gave to a DIFFERENT ACTIVE person stays with
--   them. Resolved / approved / cancelled tickets never move. Only assigned_to and
--   updated_at change.
--   Nothing moves when the new owner is NULL, inactive, or not an operation
--   executive / head.
--
-- SAFETY
--   * SECURITY DEFINER + pinned search_path, so it works whoever reassigns the depot
--     (head, admin, a bulk-assign script) regardless of ops_tickets row policies.
--   * Wrapped in its own BEGIN..EXCEPTION, plus a 2 s lock_timeout on the function:
--     a problem (or a busy ticket row) moving tickets can NOT fail the depot
--     reassignment (section 45) - it logs a WARNING and leaves the tickets where
--     they were. The only way the reassignment itself can still fail is a hard
--     error in the UPDATE of ops_depots, which is not this function's doing.
--   * Fires ONLY when assigned_to really changes (WHEN clause) - zero cost on every
--     other depot save (the 10-minute screen sync never touches assigned_to).
--   * Moving tickets cascades nothing except ONE coalesced push: since Phase 352 ops_tickets has
--     an AFTER UPDATE statement trigger (ops_ticket_assignment_push) that tells the new technician
--     "N faults assigned to you" once per statement (09:00-20:59 IST only, fully exception-wrapped,
--     so it can never fail this move). Pay (uptime) never reads ops_tickets.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ops_depot_owner_change_move_tickets()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '2s'
AS $fn$
BEGIN
  BEGIN
    IF NEW.assigned_to IS NOT NULL
       AND NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
       AND EXISTS (SELECT 1 FROM public.users u
                    WHERE u.id = NEW.assigned_to
                      AND u.is_active
                      AND u.role IN ('operation_executive', 'operation_head'))
    THEN
      UPDATE public.ops_tickets t
         SET assigned_to = NEW.assigned_to,
             updated_at  = now()
       WHERE t.depot_id = NEW.id
         AND t.assigned_to IS DISTINCT FROM NEW.assigned_to
         AND (
               -- OPEN work (nobody has started it): moves if it is held by nobody,
               -- by the previous owner, or by someone who is no longer active.
               (t.status = 'open'
                AND (   t.assigned_to IS NULL
                     OR t.assigned_to = OLD.assigned_to
                     OR EXISTS (SELECT 1 FROM public.users h
                                 WHERE h.id = t.assigned_to AND h.is_active IS NOT TRUE)))
            OR
               -- IN-PROGRESS work (a technician already started it): stays with him
               -- UNLESS he is gone (held by nobody / an inactive user) - otherwise
               -- the job is stranded for good.
               (t.status = 'in_progress'
                AND (   t.assigned_to IS NULL
                     OR EXISTS (SELECT 1 FROM public.users h
                                 WHERE h.id = t.assigned_to AND h.is_active IS NOT TRUE)))
             );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'ops_depot_owner_change_move_tickets: % (depot %)', SQLERRM, NEW.id;
  END;
  RETURN NEW;
END
$fn$;

REVOKE ALL ON FUNCTION public.ops_depot_owner_change_move_tickets() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ops_depot_owner_move_tickets ON public.ops_depots;
CREATE TRIGGER trg_ops_depot_owner_move_tickets
  AFTER UPDATE OF assigned_to ON public.ops_depots
  FOR EACH ROW
  WHEN (OLD.assigned_to IS DISTINCT FROM NEW.assigned_to)
  EXECUTE FUNCTION public.ops_depot_owner_change_move_tickets();

NOTIFY pgrst, 'reload schema';

-- ===== VERIFY / TRIPWIRE (read-only; every column must be TRUE) =====
-- SELECT
--   (SELECT count(*) = 1 FROM pg_trigger
--     WHERE tgrelid = 'public.ops_depots'::regclass AND tgname = 'trg_ops_depot_owner_move_tickets'
--       AND NOT tgisinternal AND tgenabled = 'O')                                              AS trigger_present,
--   (SELECT p.prosecdef FROM pg_proc p WHERE p.proname = 'ops_depot_owner_change_move_tickets') AS is_definer,
--   (SELECT pg_get_functiondef(p.oid) LIKE '%EXCEPTION WHEN OTHERS%'
--      FROM pg_proc p WHERE p.proname = 'ops_depot_owner_change_move_tickets')                 AS never_fails_the_reassign,
--   (SELECT pg_get_functiondef(p.oid) LIKE '%is_active IS NOT TRUE%'
--      FROM pg_proc p WHERE p.proname = 'ops_depot_owner_change_move_tickets')                 AS moves_from_inactive,
--   NOT has_function_privilege('anon', 'public.ops_depot_owner_change_move_tickets()', 'EXECUTE') AS anon_locked,
--   NOT has_function_privilege('authenticated', 'public.ops_depot_owner_change_move_tickets()', 'EXECUTE') AS authenticated_locked,
--   (SELECT pg_get_functiondef(p.oid) LIKE '%lock_timeout%'
--      FROM pg_proc p WHERE p.proname = 'ops_depot_owner_change_move_tickets')                 AS has_lock_timeout;
