-- supabase_phase315_perf_indexes.sql
-- Phase 315 — pure speed-up: 5 missing indexes (2026-08-17).
--
-- WHAT THIS DOES: makes the app read FASTER. Nothing else changes. Same queries,
-- same results, same flow — just faster. Additive only (no DROP, no data change,
-- no function change). This CANNOT change how anything behaves; an index is
-- invisible to the app.
--
-- SAFE ON THE LIVE APP: every index below uses CREATE INDEX CONCURRENTLY, which
-- builds WITHOUT locking the table — your team can keep calling, adding leads,
-- saving quotes, and using the inbox while each one builds. Nothing to smoke-test.
--
-- ⚠ HOW TO RUN (important): CONCURRENTLY cannot run inside a batch, so in Supabase
-- Studio you must run these ONE STATEMENT AT A TIME — select ONE line (one
-- CREATE INDEX line), click Run, wait for "Success", then the next line. Do NOT
-- paste all five and hit Run once (Studio wraps a multi-statement paste in a
-- transaction and CONCURRENTLY errors with "cannot run inside a transaction
-- block"). Re-running a line is safe (IF NOT EXISTS = no-op if it already built).
-- (This is the §85/§197 CONCURRENTLY run-one-at-a-time rule.)

-- ── 1. quote_cities.quote_id  (CRITICAL) ─────────────────────────────────────
-- The most-joined child column in the app has NO index. Speeds up EVERY quotes
-- list load (the quote_cities embed) + the sales-head team-quotes view.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quote_cities_quote_id ON public.quote_cities (quote_id);

-- ── 2. follow_ups.quote_id  (HIGH) ───────────────────────────────────────────
-- Embedded in the quotes list + scanned per-quote by the team-quotes view.
-- Partial: only collection follow-ups carry a quote_id; lead-only rows are NULL.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_follow_ups_quote_id ON public.follow_ups (quote_id) WHERE quote_id IS NOT NULL;

-- ── 3. finance_transactions(bucket, txn_date)  (MEDIUM) ──────────────────────
-- The P&L runs dozens of "WHERE bucket=X AND txn_date BETWEEN …" scans per load.
-- Speeds up the whole Finance / P&L tab.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_finance_txn_bucket_date ON public.finance_transactions (bucket, txn_date);

-- ── 4. finance_transactions(bank_account_id, txn_date)  (MEDIUM) ─────────────
-- Speeds the bank-import overlap check + any per-account register view.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_finance_txn_bank_date ON public.finance_transactions (bank_account_id, txn_date);

-- ── 5. whatsapp_conversations(assigned_to, last_message_at)  (MEDIUM) ────────
-- A telecaller's inbox is "WHERE assigned_to = me ORDER BY last_message_at DESC".
-- This one index serves both the filter and the sort.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wa_conv_assigned_last_msg ON public.whatsapp_conversations (assigned_to, last_message_at DESC NULLS LAST);

-- ── VERIFY (run this last, all at once is fine — it only reads) ───────────────
-- Expect 5 rows.
-- SELECT indexname FROM pg_indexes
--  WHERE indexname IN ('idx_quote_cities_quote_id','idx_follow_ups_quote_id',
--                      'idx_finance_txn_bucket_date','idx_finance_txn_bank_date',
--                      'idx_wa_conv_assigned_last_msg')
--  ORDER BY indexname;
