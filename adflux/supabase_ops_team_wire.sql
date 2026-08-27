-- supabase_ops_team_wire.sql
-- OPERATIONS — one-time team wiring. Run AFTER the ops users exist (created via
-- HR → Add Member, or manually), so the Head console + uptime pay attribute work
-- to the right people. Additive, idempotent, re-runnable. Touches ONLY ops users.
-- ─────────────────────────────────────────────────────────────────────────
-- Two things this fixes without you looking up any user id:
--   1. Clears a STALE team_role on ops users. (The app already lands ops users
--      on /ops regardless — this is just tidy-up so no report mis-buckets them.)
--   2. Points every operation_executive at the operation_head via manager_id, so
--      the Head console's "Field team" roster + attendance signal populate.
--
-- Depot → tech assignment (ops_depots.assigned_to) is NOT done here — set it per
-- station in the Head console (Operations → Live console → Screens by station →
-- Assigned tech), because which tech covers which depot is a real decision.
-- ═════════════════════════════════════════════════════════════════════════

-- 1 · clear stale team_role on ops users (they're a role, not a sales flavor)
UPDATE public.users
   SET team_role = NULL
 WHERE role IN ('operation_head', 'operation_executive')
   AND team_role IS NOT NULL;

-- 2 · point every exec at the (single) head. If you run more than one head, wire
--     the exceptions by hand after this; this covers the common single-head case.
UPDATE public.users e
   SET manager_id = (SELECT id FROM public.users
                      WHERE role = 'operation_head' AND is_active = true
                      ORDER BY created_at LIMIT 1)
 WHERE e.role = 'operation_executive'
   AND EXISTS (SELECT 1 FROM public.users WHERE role = 'operation_head' AND is_active = true);

-- ═══ VERIFY — expect one head, N execs, every exec pointing at the head ═══
-- SELECT
--   (SELECT count(*) FROM public.users WHERE role='operation_head' AND is_active) AS heads,
--   (SELECT count(*) FROM public.users WHERE role='operation_executive' AND is_active) AS execs,
--   (SELECT count(*) FROM public.users e WHERE e.role='operation_executive' AND e.is_active
--      AND e.manager_id = (SELECT id FROM public.users WHERE role='operation_head' AND is_active=true ORDER BY created_at LIMIT 1)) AS execs_wired;
