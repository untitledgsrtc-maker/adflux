-- ============================================================================
-- supabase_perf_load_cuts.sql  —  DB-load reduction after the 2026-09-15 outage
-- ============================================================================
-- Context: the Micro (1 GB) compute maxed out (CPU 98% / RAM 93%, 15-conn pool
--   exhausted) → Postgres refused connections → the whole app went down for
--   everyone. Compute upgraded Micro → Medium (4 GB) to recover. THIS file cuts
--   the load so the bigger box stays cool + it doesn't recur as the app grows.
--
-- Three parts, all safe + idempotent. Run the whole file once in Supabase Studio.
--   PART 1 — statement_timeout: a stuck/queued query frees its pooled connection
--            instead of parking it (turns a cascading pool-starvation OUTAGE
--            into a few isolated slow-query failures).
--   PART 2 — 3 missing indexes: turn seq-scans on the biggest tables into index
--            seeks so queries hold their connection for ms, not seconds.
--   PART 3 — slow the 2 heaviest recurring crons + take them off the round-minute
--            collision (the ops screen-sync + the WhatsApp AI-recovery scan).
-- ============================================================================


-- ============================================================================
-- PART 1 — statement_timeout on the app's query roles (25s ceiling)
-- ----------------------------------------------------------------------------
-- Applies to the roles PostgREST runs queries as (authenticated = logged-in
-- users, anon = pre-login). NOT set on postgres/service_role, so the crons +
-- Edge functions + long maintenance jobs are UNAFFECTED. 25s is generous for
-- any legitimate query; anything longer is stuck and should release its slot.
-- Takes effect on each connection as the pool recycles (a pgrst reload nudges it).
-- ============================================================================
ALTER ROLE authenticated  SET statement_timeout = '25s';
ALTER ROLE anon           SET statement_timeout = '25s';
ALTER ROLE authenticator  SET statement_timeout = '25s';

NOTIFY pgrst, 'reload config';


-- ============================================================================
-- PART 2 — 3 missing indexes on the highest-volume tables
-- ----------------------------------------------------------------------------
-- ⚠ RUN OFF-PEAK (after ~9 PM IST, when few field reps are pinging). A plain
--   CREATE INDEX briefly LOCKS that table's writes while it builds. On the
--   current table sizes + the Medium box this is seconds-to-a-minute, but
--   gps_pings/call_logs are write-hot so avoid business hours.
--   (Supabase Studio wraps every statement in a transaction, so CREATE INDEX
--    CONCURRENTLY is not usable here — plain build off-peak is the practical path.)
-- Each is IF NOT EXISTS → safe to re-run / harmless if one already exists.
-- ============================================================================

-- reps-in-field / live-map queries filter+order gps_pings by created_at with no
-- user_id predicate → currently a seq scan + sort of the biggest table.
CREATE INDEX IF NOT EXISTS idx_gps_pings_created_at
  ON public.gps_pings (created_at DESC);

-- whole-team daily call KPI filters call_logs by call_at with no user_id → the
-- (user_id, call_at) index is unusable → seq scan.
CREATE INDEX IF NOT EXISTS idx_call_logs_call_at
  ON public.call_logs (call_at);

-- approved-revenue / collection aggregations scan payments by payment_date +
-- approval_status='approved' with no supporting index (only a WHERE-pending partial).
CREATE INDEX IF NOT EXISTS idx_payments_approved_date
  ON public.payments (payment_date)
  WHERE approval_status = 'approved';


-- ============================================================================
-- PART 3 — slow the 2 heaviest recurring crons + de-collide them
-- ----------------------------------------------------------------------------
-- ops-aiadflux-sync (was */10): the heaviest job — external 265-screen CMS pull
--   + bulk upsert + full uptime recompute + ticket reconcile. → every 15 min,
--   off the round minute. Screen status ~15-min-fresh instead of ~10 (fine).
-- wa-ai-recovery (was */5): re-fires dropped AI-reply dispatches. → every 10 min,
--   off the round minute. Its 4-min floor + 3-hr window still catch drops.
-- Both were stacking on :00/:10/:20/:30/:40/:50 with each other (and the herd).
-- alter_job changes ONLY the schedule; guarded so a missing job is skipped.
-- ============================================================================
DO $$
DECLARE jid bigint;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'ops-aiadflux-sync';
  IF jid IS NOT NULL THEN
    PERFORM cron.alter_job(jid, schedule => '2,17,32,47 * * * *');   -- every 15, offset
  END IF;

  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'wa-ai-recovery';
  IF jid IS NOT NULL THEN
    PERFORM cron.alter_job(jid, schedule => '4,14,24,34,44,54 * * * *');  -- every 10, offset
  END IF;
END $$;


-- ============================================================================
-- VERIFY (read-only) — run after, to confirm all three parts landed
-- ============================================================================
-- PART 1 — the 3 roles should each show statement_timeout=25s:
SELECT rolname, rolconfig
  FROM pg_roles
 WHERE rolname IN ('authenticated', 'anon', 'authenticator');

-- PART 2 — the 3 indexes should be present:
SELECT indexname FROM pg_indexes
 WHERE schemaname = 'public'
   AND indexname IN ('idx_gps_pings_created_at', 'idx_call_logs_call_at', 'idx_payments_approved_date')
 ORDER BY indexname;

-- PART 3 — the 2 crons should show the new schedules:
SELECT jobname, schedule FROM cron.job
 WHERE jobname IN ('ops-aiadflux-sync', 'wa-ai-recovery')
 ORDER BY jobname;
