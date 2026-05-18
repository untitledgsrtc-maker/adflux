-- supabase_phase49_tc_policies.sql
-- Phase 49 — Telecaller policy: connect rate + weekly qualified target.
-- 18 May 2026
--
-- Owner-approved 4 policies for TC role:
--   1. Min 50 calls/day             (already: daily_targets.min_calls)
--   2. Min 30% connect rate         (NEW: daily_targets.min_connect_pct)
--   3. Min 5 qualified handoffs/wk  (NEW: daily_targets.min_qualified_weekly)
--   4. 24h handoff SLA              (already: leads.handoff_sla_due_at)
--
-- New columns default to the owner-approved B2B SMB norms:
--   min_connect_pct        = 30  (industry avg for B2B cold calling)
--   min_qualified_weekly   = 5
--
-- Admin can override per-TC via the existing daily_targets edit
-- surface (Team module).
--
-- Idempotent.

ALTER TABLE public.daily_targets
  ADD COLUMN IF NOT EXISTS min_connect_pct       int NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS min_qualified_weekly  int NOT NULL DEFAULT 5;

-- Range guards: connect rate is 0..100, qualified ≥ 0. Skip
-- backfill — defaults already valid for any existing row.
ALTER TABLE public.daily_targets
  DROP CONSTRAINT IF EXISTS daily_targets_connect_pct_check;
ALTER TABLE public.daily_targets
  ADD CONSTRAINT daily_targets_connect_pct_check
  CHECK (min_connect_pct >= 0 AND min_connect_pct <= 100);

ALTER TABLE public.daily_targets
  DROP CONSTRAINT IF EXISTS daily_targets_qualified_weekly_check;
ALTER TABLE public.daily_targets
  ADD CONSTRAINT daily_targets_qualified_weekly_check
  CHECK (min_qualified_weekly >= 0);


NOTIFY pgrst, 'reload schema';


-- ─── VERIFY ──────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='daily_targets'
      AND column_name IN ('min_connect_pct','min_qualified_weekly'))  AS new_cols,
  (SELECT min_connect_pct FROM public.daily_targets LIMIT 1)          AS sample_connect_pct,
  (SELECT min_qualified_weekly FROM public.daily_targets LIMIT 1)     AS sample_qualified_weekly;

-- Expected:
--   new_cols                  = 2
--   sample_connect_pct        = 30 (or whatever admin already set)
--   sample_qualified_weekly   = 5
