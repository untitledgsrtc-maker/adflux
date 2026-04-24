-- Slot metadata on quote_cities
--
-- Adds ad-spot metadata to each quote line. These are PURE METADATA —
-- they do not affect pricing. Pricing is driven solely by the rep-
-- negotiated offered_rate × screens × duration_months (see
-- src/components/quotes/QuoteWizard/Step2Campaign.jsx::calcTotal).
--
-- Fields:
--   slot_seconds          Length of each ad spot, in seconds. Rep picks
--                         from 10 / 15 / 20 / 30. The PDF previously
--                         hardcoded "10 SEC" — once this column is in
--                         place the PDF can render the real value.
--   slots_per_day         Promised daily spot count per screen. Default
--                         100. Reps can negotiate this up (premium
--                         placement) or down (low-traffic board).
--   slots_override_reason Free-text reason, required by the UI when
--                         slots_per_day is not 100. Mirrors the
--                         override_reason column that already tracks
--                         rate overrides.
--
-- Defaults match the pre-migration implicit assumption (10s ads, 100
-- slots/day) so old rows keep their meaning when the UI falls back to
-- defaults while rendering them.

ALTER TABLE quote_cities
  ADD COLUMN IF NOT EXISTS slot_seconds          INTEGER     NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS slots_per_day         INTEGER     NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS slots_override_reason TEXT;

-- Keep the defaults sane even if someone writes a raw INSERT without
-- specifying. 1 second / 1 slot would both be nonsensical for a real
-- campaign but they unblock data insertion and the UI clamps on edit.
ALTER TABLE quote_cities
  ADD CONSTRAINT quote_cities_slot_seconds_positive  CHECK (slot_seconds  > 0),
  ADD CONSTRAINT quote_cities_slots_per_day_positive CHECK (slots_per_day > 0);

COMMENT ON COLUMN quote_cities.slot_seconds IS
  'Ad spot length in seconds (10/15/20/30). Metadata only — does NOT factor into campaign_total.';
COMMENT ON COLUMN quote_cities.slots_per_day IS
  'Promised ad plays per screen per day. Default 100; deviations require slots_override_reason.';
COMMENT ON COLUMN quote_cities.slots_override_reason IS
  'Why slots_per_day differs from the default of 100. NULL when at default.';
