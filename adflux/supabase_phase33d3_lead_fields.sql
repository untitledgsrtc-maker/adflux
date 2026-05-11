-- =====================================================================
-- Phase 33D.3 — designation + website columns on leads
-- 11 May 2026
--
-- Owner spec: new lead form needs Company / Person / Designation /
-- Mobile / Email / City / Website. Designation + website are new
-- columns. Idempotent.
-- =====================================================================

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS designation text,
  ADD COLUMN IF NOT EXISTS website     text;

NOTIFY pgrst, 'reload schema';

-- VERIFY
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name='leads' AND column_name='designation') AS designation_exists,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name='leads' AND column_name='website') AS website_exists;
