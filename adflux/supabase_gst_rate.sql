-- GST rate per quote
--
-- Before: every quote was taxed at a hardcoded 18% in the app layer.
-- After:  each quote stores its own rate. UI offers "GST 18%" or "No GST"
--         (0.00). The column is NUMERIC rather than BOOLEAN so you can add
--         12% / 5% later without another migration.
--
-- Default 0.18 means every existing quote is treated as 18% GST, which
-- matches how they were calculated at the time — no backfill pass needed.

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS gst_rate NUMERIC(5,4) NOT NULL DEFAULT 0.18;

COMMENT ON COLUMN quotes.gst_rate IS
  'GST rate applied to this quote. 0.18 = 18%, 0 = No GST.';
