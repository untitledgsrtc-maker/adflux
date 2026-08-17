-- supabase_phase315_perf_indexes.sql
-- Phase 315 — pure speed-up: 5 missing indexes (2026-08-17).
-- (rev: plain CREATE INDEX — see the ⚠ note; the CONCURRENTLY version errored
--  in Supabase Studio because Studio wraps statements in a transaction.)
--
-- WHAT THIS DOES: makes the app read FASTER. Nothing else changes. Same queries,
-- same results, same flow — just faster. Additive only (no DROP, no data change,
-- no function change). An index is invisible to the app; it CANNOT change how
-- anything behaves.
--
-- ⚠ WHY NOT "CONCURRENTLY": Supabase Studio runs every statement inside a
-- transaction, and CREATE INDEX CONCURRENTLY refuses to run inside one (error
-- 25001). Plain CREATE INDEX works, BUT it briefly locks WRITES to that one table
-- while it builds. On THESE tables that build is MILLISECONDS (they're small:
-- finance_transactions ~1k rows, the others a few thousand), so a rep saving a
-- lead/quote/follow-up in that split-second waits a few ms — no data loss, nothing
-- to notice. To be extra safe, run this OFF-PEAK (evening / when the team's idle).
-- Reads are NEVER blocked; only writes to that one table, for milliseconds.
--
-- HOW TO RUN: paste the whole file into the Supabase Studio SQL editor and Run
-- ONCE. (These are plain statements now — the batch is fine. Re-running is safe:
-- IF NOT EXISTS = a no-op if the index already built.)

-- ── 1. quote_cities.quote_id  (CRITICAL) ─────────────────────────────────────
-- The most-joined child column in the app has NO index. Speeds up EVERY quotes
-- list load (the quote_cities embed) + the sales-head team-quotes view.
CREATE INDEX IF NOT EXISTS idx_quote_cities_quote_id ON public.quote_cities (quote_id);

-- ── 2. follow_ups.quote_id  (HIGH) ───────────────────────────────────────────
-- Embedded in the quotes list + scanned per-quote by the team-quotes view.
-- Partial: only collection follow-ups carry a quote_id; lead-only rows are NULL.
CREATE INDEX IF NOT EXISTS idx_follow_ups_quote_id ON public.follow_ups (quote_id) WHERE quote_id IS NOT NULL;

-- ── 3. finance_transactions(bucket, txn_date)  (MEDIUM) ──────────────────────
-- The P&L runs dozens of "WHERE bucket=X AND txn_date BETWEEN …" scans per load.
CREATE INDEX IF NOT EXISTS idx_finance_txn_bucket_date ON public.finance_transactions (bucket, txn_date);

-- ── 4. finance_transactions(bank_account_id, txn_date)  (MEDIUM) ─────────────
-- Speeds the bank-import overlap check + any per-account register view.
CREATE INDEX IF NOT EXISTS idx_finance_txn_bank_date ON public.finance_transactions (bank_account_id, txn_date);

-- ── 5. whatsapp_conversations(assigned_to, last_message_at)  (MEDIUM) ────────
-- A telecaller's inbox is "WHERE assigned_to = me ORDER BY last_message_at DESC".
-- This one index serves both the filter and the sort.
CREATE INDEX IF NOT EXISTS idx_wa_conv_assigned_last_msg ON public.whatsapp_conversations (assigned_to, last_message_at DESC NULLS LAST);

-- ── VERIFY (expect 5 rows) ───────────────────────────────────────────────────
SELECT indexname FROM pg_indexes
 WHERE indexname IN ('idx_quote_cities_quote_id','idx_follow_ups_quote_id',
                     'idx_finance_txn_bucket_date','idx_finance_txn_bank_date',
                     'idx_wa_conv_assigned_last_msg')
 ORDER BY indexname;
