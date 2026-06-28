-- supabase_phase182_perf_indexes.sql
-- Phase 182 — DB-perf audit follow-up (2026-06-28). Additive indexes on the
-- hot per-rep filter columns the audit found unindexed + the payments table
-- (which had ZERO indexes except a partial pending one). Query plans only —
-- NO behaviour change, NO data change. Idempotent; safe to re-run.
--
-- Why these three (audit §, verified by reading the RLS policy + the .eq()
-- call site + pg_indexes):
--   1. follow_ups.assigned_to — every /follow-ups + /telecaller load AND every
--      auto-refresh poll filters assigned_to + is_done; the RLS policy
--      (fu self-read) also gates assigned_to. follow_ups grows daily. No index
--      existed (only lead / date_open / lead_cadence_open).
--   2/3. payments.quote_id + payments.received_by — payments had NO index but
--      the partial pending one. quote_id is JOINed by rebuild_monthly_sales +
--      QuoteDetail + the FK-cascade on quote delete (Postgres does NOT
--      auto-index a referencing FK column); received_by is filtered by
--      MyPerformance + its realtime subscription.

-- 1) follow_ups.assigned_to (partial on the open rows the app reads)
CREATE INDEX IF NOT EXISTS idx_follow_ups_assigned_open
  ON public.follow_ups (assigned_to, follow_up_date)
  WHERE is_done = false;

-- 2) payments.quote_id (JOIN key + FK cascade)
CREATE INDEX IF NOT EXISTS idx_payments_quote_id
  ON public.payments (quote_id);

-- 3) payments.received_by (per-rep revenue filter)
CREATE INDEX IF NOT EXISTS idx_payments_received_by
  ON public.payments (received_by);

NOTIFY pgrst, 'reload schema';

-- VERIFY: expect exactly these 3 rows.
-- SELECT indexname FROM pg_indexes
--  WHERE schemaname = 'public'
--    AND indexname IN ('idx_follow_ups_assigned_open',
--                      'idx_payments_quote_id',
--                      'idx_payments_received_by')
--  ORDER BY indexname;
