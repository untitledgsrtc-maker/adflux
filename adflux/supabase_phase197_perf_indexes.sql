-- ============================================================================
-- Phase 197 — performance indexes (P1 gaps from the 2026-07-04 DB-perf audit)
-- ============================================================================
-- The audit found 5 high-frequency filter combos on hot tables with no matching
-- index → the DB scans the whole table on screens every rep + admin opens daily.
-- These are ADDITIVE (indexes only — no data/behaviour change) and IDEMPOTENT.
--
-- ⚠️ RUN EACH LINE ONE AT A TIME. CREATE INDEX CONCURRENTLY cannot run inside a
-- transaction/batch, and the Supabase Studio editor batches a multi-statement
-- paste — so paste + Run ONE statement at a time. CONCURRENTLY builds the index
-- WITHOUT locking writes, so the live app keeps working while each builds (a few
-- seconds each; gps_pings is the largest). §45 — zero write-stall on the live app.
--
-- If a CONCURRENTLY build ever fails midway it leaves an INVALID index; just
-- DROP INDEX IF EXISTS <name>; and re-run that one line.
-- ============================================================================

-- 1) Sales dashboards: quotes by rep + status (e.g. created_by=uid AND status='won')
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quotes_created_by_status
  ON public.quotes (created_by, status);

-- 2) Rep task queue: open follow-ups by rep (assigned_to AND is_done=false)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_follow_ups_assigned_done
  ON public.follow_ups (assigned_to, is_done) WHERE is_done = false;

-- 3) Connected-call counting: call_logs by rep + outcome
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_call_logs_user_outcome
  ON public.call_logs (user_id, outcome);

-- 4) GPS km calc / track map: pings by rep + time window
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gps_pings_user_time
  ON public.gps_pings (user_id, captured_at DESC);

-- 5) Score + activity rollups: lead_activities by creator + time
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lead_activities_created_by_time
  ON public.lead_activities (created_by, created_at DESC);

-- 6) VERIFY-and-heal: payments.quote_id FK index (went missing once, Phase 85.1).
--    IF NOT EXISTS makes this a no-op if it's already there.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_quote_id
  ON public.payments (quote_id);

-- ============================================================================
-- VERIFY — after running the 6 lines above, this should list all 6 indexes.
-- ============================================================================
-- SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname IN (
--   'idx_quotes_created_by_status','idx_follow_ups_assigned_done',
--   'idx_call_logs_user_outcome','idx_gps_pings_user_time',
--   'idx_lead_activities_created_by_time','idx_payments_quote_id')
-- ORDER BY indexname;                                                    -- 6 rows
-- Any index marked INVALID (a failed CONCURRENTLY build): find via
--   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
-- then DROP INDEX IF EXISTS <name>; and re-run that one CREATE line.
