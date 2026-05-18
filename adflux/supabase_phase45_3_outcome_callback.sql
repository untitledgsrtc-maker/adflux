-- supabase_phase45_3_outcome_callback.sql
-- Phase 45.3 — add 'callback' outcome to lead_activities.outcome enum.
-- 18 May 2026
--
-- Owner directive: new "Call later" outcome chip in the post-call
-- modal — picks up "customer wants me to call back" as a distinct
-- signal vs generic Maybe. Auto-fills next_action = call_back_2h.
--
-- Current DB constraint (Phase 12):
--   outcome text CHECK (outcome IS NULL OR outcome IN
--           ('positive','neutral','negative'))
--
-- This file widens it to include 'callback'. Idempotent — drops
-- the old constraint first, re-adds the wider one.

ALTER TABLE public.lead_activities
  DROP CONSTRAINT IF EXISTS lead_activities_outcome_check;

ALTER TABLE public.lead_activities
  ADD CONSTRAINT lead_activities_outcome_check
  CHECK (outcome IS NULL OR outcome IN ('positive', 'neutral', 'negative', 'callback'));


NOTIFY pgrst, 'reload schema';


-- ─── VERIFY ──────────────────────────────────────────────────────
-- Confirm the new check constraint accepts 'callback'.
SELECT
  (SELECT count(*) FROM information_schema.check_constraints
    WHERE constraint_schema = 'public'
      AND constraint_name = 'lead_activities_outcome_check'
      AND check_clause ILIKE '%callback%')                  AS constraint_widened;

-- Expected: constraint_widened = 1.

-- Smoke test (optional):
-- BEGIN; INSERT INTO public.lead_activities (lead_id, activity_type, outcome, notes, created_by)
--   VALUES ((SELECT id FROM public.leads LIMIT 1), 'call', 'callback', 'phase 45.3 smoke', auth.uid());
-- ROLLBACK;
