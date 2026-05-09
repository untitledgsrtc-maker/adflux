-- supabase_phase31a_won_reason.sql
--
-- Phase 31A — capture WHY a lead was won, mirroring the existing
-- lost_reason column. Owner spec (8 May 2026): "Win/Loss reason
-- tracking — over time this data is gold ... allows coaching".
--
-- The leads table has lost_reason text + LOST_REASONS enum on the
-- frontend. We mirror that for wins so admin can spot patterns
-- (e.g. "70% of wins came from referral, only 12% from cold call —
-- shift effort").
--
-- Won-reason vocabulary is shorter than lost (typical sales taxonomies):
--   Referral / Existing client / Cold outreach / Marketing / Walk-in / Other
--
-- Idempotent.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS won_reason text
    CHECK (won_reason IS NULL OR won_reason IN (
      'Referral', 'ExistingClient', 'ColdOutreach', 'Marketing', 'WalkIn', 'Other'
    ));

NOTIFY pgrst, 'reload schema';

-- VERIFY:
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_name = 'leads' AND column_name = 'won_reason';
