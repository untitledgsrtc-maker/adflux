-- ============================================================================
-- Phase 195 — GSRTC LED: per-proposal per-station RATE override
-- ============================================================================
-- Owner: bulk-change the per-slot rate by grade on a GSRTC LED proposal (offer a
-- discount off the standard DAVP grade rate, this proposal only). Mirrors the
-- existing daily_spots_override / days_override / spot_duration_sec_override
-- columns (Phase 7): one nullable numeric per quote_cities row; NULL = "use the
-- station master's davp_per_slot_rate". The wizard saves the effective rate into
-- unit_rate / offered_rate (which the proposal + PDF already read), keeps
-- listed_rate = the master DAVP rate, and stores the raw override here so an
-- EDIT round-trips it back into the Step-3 inputs.
--
-- Additive, idempotent (§8). No existing row/flow reads this column, so it can't
-- affect any live proposal (§45). Only the GSRTC LED wizard writes it.
-- ============================================================================

ALTER TABLE public.quote_cities
  ADD COLUMN IF NOT EXISTS rate_override numeric;

NOTIFY pgrst, 'reload schema';

-- VERIFY:
-- SELECT column_name FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='quote_cities'
--     AND column_name='rate_override';   -- 1 row
