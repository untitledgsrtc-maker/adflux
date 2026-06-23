-- supabase_phase33g_score_ambiguity_fix.sql
--
-- Phase 33G.5 — fix "column reference user_id is ambiguous" on
-- /my-performance.
--
-- Root cause: monthly_score() declares user_id as a RETURNS TABLE
-- column. Inside the function body, the two `WHERE user_id = p_user_id`
-- clauses (one on daily_performance, one on staff_incentive_profiles)
-- collided with that return-column name. Postgres treats the function-
-- output names as in-scope inside the body, so it can't decide which
-- user_id you mean.
--
-- Fix: qualify both references with the table name. No logic change,
-- no signature change, no RLS change — pure ambiguity resolution.
--
-- Run order: this REPLACES the function from supabase_phase33e_performance_score.sql.
-- Safe to run on top of Phase 33E. Idempotent (CREATE OR REPLACE).

-- -------------------------------------------------------------------------
-- monthly_score REMOVED from this file (Phase 178).
-- Canonical: db/functions/monthly_score.sql (feeds compute_monthly_salary).
-- Do NOT re-add it here. Edit the canonical file only (§71).
-- -------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.monthly_score(uuid, date) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY:
-- SELECT * FROM public.monthly_score(auth.uid(), date_trunc('month', current_date)::date);
-- Expect: 1 row, no error.
