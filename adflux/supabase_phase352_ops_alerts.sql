-- ============================================================================
-- supabase_phase352_ops_alerts.sql  -  Operations PUSH alerts (table + triggers + cron)
-- ============================================================================
-- Owner decisions (locked): technicians AND the operation head get alerts; pushes only inside the
-- allowed hours (public.is_push_allowed_now() = 09:00-20:59 IST); camera faults are digest-only,
-- never a per-ticket push; ops alerts must never break the sync or a ticket update; WhatsApp is
-- OUT of scope (api/ops/ticket-wa.js and the WhatsApp dispatch are untouched).
--
-- *** RUN ORDER - READ BEFORE RUNNING ***
--   1. db/functions/ops_notify_outages.sql      (the outage-alert function)
--   2. db/functions/ops_digest.sql              (morning digest, evening push, 2 trigger functions)
--   3. THIS FILE                                (state table + the 2 triggers + the 2 cron jobs)
--   Running this file before 1 and 2 fails at the first CREATE TRIGGER with "function ... does not
--   exist" - nothing half-applied (run it in one go; a failure leaves the objects it created, all
--   idempotent, so just run 1 and 2 and re-run this).
--   4. Deploy the engine fix (see ENGINE ALERTS below): run ONLY SECTION 2 of supabase_ops_p2_auto_tickets.sql
--      (the ops_reconcile_offline_tickets CREATE OR REPLACE + its REVOKE / GRANT, file lines 25-149).
--      DO NOT run the whole p2 file: its SECTION 1 re-adds ops_tickets_status_check, which fails with 23514
--      when any live ticket has a status outside the list (the file aborts and nothing after it applies).
--   Re-running supabase_phase211_anon_execute_sweep.sql is NOT needed at deploy: the five new functions
--   are already REVOKEd by their own files. If you re-run it anyway it is now safe - a rolled-back dry-run
--   on the live DB (2026-10-08) showed its blanket GRANT would have re-opened exactly 7 locked functions
--   (ops_aiadflux_sync_dispatch, ops_ticket_wa_dispatch, earned_incentive_for, recompute_daily_new_leads and
--   the trigger fns ops_depot_owner_change_move_tickets, clients_absorb_duplicate, clients_phone_change_guard);
--   all seven are now in its re-lock list and VERIFY-D, and the same dry-run now changes 0 functions.
--
-- WHAT THIS FILE CREATES (all additive, idempotent, re-runnable):
--   * public.ops_outage_alert_state  - per-station alert baseline (RLS on, no policies, definer-only)
--   * trg_ops_tickets_assignment_push - statement-level AFTER UPDATE on ops_tickets (transition
--       tables): ONE "N faults assigned to you" push per technician per UPDATE statement
--   * trg_ops_tickets_resolved_push   - row-level AFTER UPDATE on ops_tickets, only when status
--       becomes 'resolved': a push to every active operation_head
--   * pg_cron 'ops-morning-digest'    - 04:00 UTC Mon-Sat  = 09:30 IST
--   * pg_cron 'ops-head-evening-push' - 14:00 UTC Mon-Sat  = 19:30 IST
--   (ops_notify_outages has no job of its own: api/ops/sync.js calls it after every 10-min sync.)
--
-- HEADS-UP (behaviour change, intended): ops_tickets used to have NO user triggers. Moving a
--   station to another technician (ops_depot_owner_change_move_tickets) updates that station's
--   tickets in one statement, so the new technician now gets ONE coalesced "N faults assigned to
--   you" push. Both triggers are fully EXCEPTION-wrapped and fire only on UPDATE, so a ticket
--   update can never fail because of a push, and ticket INSERTs (the sync's auto-tickets) are
--   untouched. A one-off bulk heal that must stay silent runs inside
--   `SET LOCAL session_replication_role = replica;`.
--
-- ENGINE ALERTS (review finding, 2026-10-08): the OLDER auto-ticket engine ops_reconcile_offline_tickets()
--   (supabase_ops_p2_auto_tickets.sql, called by api/ops/sync.js every 10 minutes) used to send its own
--   English 'New ticket' push AND a WhatsApp the moment it opened a ticket - gated only by the 07:00-21:00
--   operating window, with no quiet-hours gate and no debounce. Live history: a 07:xx boot gap opened ~13
--   tickets at once = 13 WhatsApps + 13 pushes before 09:00, and, next to this phase's collapsed outage push,
--   one outage meant two pushes. FIXED IN PLACE in that file (its single home, no copy here):
--     * both alerts now fire only inside public.is_push_allowed_now() (09:00-20:59 IST); the TICKET itself
--       still opens any time in 07:00-21:00;
--     * the engine's own push stays silent once ops_notify_outages() is installed (this phase owns the
--       technician push: 20-minute debounce, one push per technician); before it is installed the engine keeps
--       its push, now quiet-hours gated.
--   "No push outside 09:00-20:59 IST" is therefore only TRUE after step 4 above is applied.
--   WhatsApp: the dispatch function and api/ops/ticket-wa.js are untouched (owner decision above); only the
--   engine's CALL to ops_ticket_wa_dispatch is now behind the same quiet-hours gate. OPEN OWNER DECISION: that
--   WhatsApp still has no 20-minute debounce (fires the moment one screen reads offline, 09:00-20:59).
--
-- Pay is untouched: no ops_uptime_daily / daily_performance / salary object is read or written.
--
-- KILL SWITCHES (no deploy needed; each is reversible and touches nothing else):
--   * stop the two daily pushes : SELECT cron.unschedule('ops-morning-digest');
--                                 SELECT cron.unschedule('ops-head-evening-push');
--   * stop the outage + engine alerts : the sync calls ops_notify_outages() best-effort; to silence it
--       REVOKE EXECUTE ON FUNCTION public.ops_notify_outages() FROM service_role;   (the sync then logs a
--       permission error and carries on - it never fails). Re-GRANT to turn it back on. The engine then
--       sends its own legacy push again, which is the pre-352 behaviour.
--   * stop the ticket-event pushes : DROP TRIGGER trg_ops_tickets_assignment_push ON public.ops_tickets;
--                                    DROP TRIGGER trg_ops_tickets_resolved_push   ON public.ops_tickets;
-- UNDO EVERYTHING (back to before this phase): the four lines above + DROP TABLE public.ops_outage_alert_state;
--   then re-apply the previous engine body (git show 13af00f:adflux/supabase_ops_p2_auto_tickets.sql, Section 2).
--   The report functions (db/functions/ops_day_report.sql) are independent and read-only.
-- ============================================================================

-- ── 1 · state table ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ops_outage_alert_state (
  depot_id           uuid        PRIMARY KEY REFERENCES public.ops_depots(id) ON DELETE CASCADE,
  last_alerted_down  int         NOT NULL DEFAULT 0,
  last_alert_at      timestamptz,
  last_head_alert_at timestamptz
);

ALTER TABLE public.ops_outage_alert_state ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: only the SECURITY DEFINER functions (owner) and service_role touch it.
-- Supabase gives anon/authenticated ALL on new public tables by default - take it away so even a
-- future permissive policy cannot expose it by accident.
REVOKE ALL ON TABLE public.ops_outage_alert_state FROM PUBLIC, anon, authenticated;
GRANT  ALL ON TABLE public.ops_outage_alert_state TO service_role;

-- ── 2 · triggers on ops_tickets ─────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_ops_tickets_assignment_push ON public.ops_tickets;
CREATE TRIGGER trg_ops_tickets_assignment_push
  AFTER UPDATE ON public.ops_tickets
  REFERENCING OLD TABLE AS old_t NEW TABLE AS new_t
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.ops_ticket_assignment_push();

DROP TRIGGER IF EXISTS trg_ops_tickets_resolved_push ON public.ops_tickets;
CREATE TRIGGER trg_ops_tickets_resolved_push
  AFTER UPDATE ON public.ops_tickets
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'resolved')
  EXECUTE FUNCTION public.ops_ticket_resolved_push();

-- ── 3 · pg_cron jobs (idempotent: unschedule if present, then schedule) ─────────
DO $$ BEGIN PERFORM cron.unschedule('ops-morning-digest');
EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('ops-morning-digest', '0 4 * * 1-6', $$SELECT public.ops_morning_digest()$$);

DO $$ BEGIN PERFORM cron.unschedule('ops-head-evening-push');
EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('ops-head-evening-push', '0 14 * * 1-6', $$SELECT public.ops_head_evening_push()$$);

NOTIFY pgrst, 'reload schema';

-- ── VERIFY (read every column; expected value in the comment) ───────────────────
SELECT
  to_regclass('public.ops_outage_alert_state') IS NOT NULL                          AS table_ok,          -- t
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ops_outage_alert_state'::regclass) AS rls_on,  -- t
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'ops_outage_alert_state')                                     AS table_policies,    -- 0
  NOT has_table_privilege('anon',          'public.ops_outage_alert_state', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.ops_outage_alert_state', 'SELECT') AS table_locked, -- t
  (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.ops_tickets'::regclass
      AND tgname IN ('trg_ops_tickets_assignment_push', 'trg_ops_tickets_resolved_push')
      AND NOT tgisinternal AND tgenabled = 'O')                                      AS triggers_on,       -- 2
  (SELECT count(*) FROM cron.job WHERE jobname IN ('ops-morning-digest', 'ops-head-evening-push')
      AND active)                                                                    AS cron_jobs,         -- 2
  (SELECT string_agg(jobname || ' ' || schedule, ' ; ' ORDER BY jobname) FROM cron.job
      WHERE jobname IN ('ops-morning-digest', 'ops-head-evening-push'))              AS cron_schedules,    -- ops-head-evening-push 0 14 * * 1-6 ; ops-morning-digest 0 4 * * 1-6
  (SELECT bool_and(NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
                   AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
     FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('ops_notify_outages', 'ops_morning_digest', 'ops_head_evening_push',
                        'ops_ticket_assignment_push', 'ops_ticket_resolved_push'))   AS functions_locked; -- t
