-- =====================================================================
-- Phase 34V.3 — allow 'Duplicate' as a lost_reason
-- 13 May 2026
--
-- Phase 34V dedupe RPC sets lost_reason='Duplicate' on the soft-merged
-- copies. The CHECK constraint from Phase 12 whitelisted only
-- Price / Timing / Competitor / NoNeed / NoResponse / WrongContact /
-- Stale — running the RPC against pre-existing duplicate rows
-- failed with "violates check constraint leads_lost_reason_check".
-- Extend the whitelist so the dedupe tool can finish its job AND
-- future dupes (caught by the frontend phone-dedup at insert time
-- but slipping through edge cases) have a clean reason value.
--
-- Idempotent.
-- =====================================================================

ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_lost_reason_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_lost_reason_check
  CHECK (lost_reason IS NULL OR lost_reason IN (
    'Price','Timing','Competitor','NoNeed','NoResponse',
    'WrongContact','Stale','Duplicate'
  ));

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────────
SELECT pg_get_constraintdef(c.oid) AS check_definition
  FROM pg_constraint c
  JOIN pg_class t ON c.conrelid = t.oid
 WHERE t.relname = 'leads' AND c.conname = 'leads_lost_reason_check';
