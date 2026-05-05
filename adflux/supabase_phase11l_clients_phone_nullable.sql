-- =====================================================================
-- Phase 11l — clients.phone nullable + dedup index update
-- =====================================================================
--
-- Why this exists
-- ---------------
-- Govt proposals don't capture a phone number (the "client" is a
-- government body — DAVP, GSRTC department, etc., contacted by
-- physical letter). The clients_module migration declared phone NOT
-- NULL, so syncClientFromQuote silently skipped every govt quote and
-- a sales rep with 6 won govt quotes ended up with 0 client rows.
--
-- This migration:
--   1. Makes clients.phone nullable.
--   2. Drops + recreates the unique index on (phone, created_by) —
--      Postgres treats NULL ≠ NULL in unique indexes by default, so
--      multiple phone-less rows per rep don't collide there.
--   3. Adds a partial index on lower(coalesce(company,name)) per rep
--      to make the phone-less dedup lookup in syncClient.js efficient
--      (we client-side filter today, but as the phone-less client
--      list grows this keeps it indexed).
--
-- IDEMPOTENT.
-- =====================================================================

-- 1) phone NOT NULL → nullable.
ALTER TABLE public.clients
  ALTER COLUMN phone DROP NOT NULL;

-- 2) The unique index already treats NULL as distinct, so we keep it
--    as-is. Just confirm it's the right shape:
--
--    SELECT indexdef FROM pg_indexes
--     WHERE indexname = 'clients_phone_owner_uk';
--    -- expect: (phone, created_by)

-- 3) Partial index for phone-less dedup. Lower-cased company falls
--    back to lower-cased name so the lookup matches what
--    syncClient.js does in JS.
CREATE INDEX IF NOT EXISTS clients_phoneless_dedup_idx
  ON public.clients (
    created_by,
    lower(coalesce(company, name))
  )
  WHERE phone IS NULL;

-- 4) Refresh PostgREST so the relaxed nullability is reflected in
--    the SDK metadata immediately.
NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- VERIFY:
--   -- Should now allow NULL phone:
--   INSERT INTO clients (name, company, created_by) VALUES
--     ('Test Govt', 'Sports Authority of Gujarat', auth.uid());
--   SELECT * FROM clients WHERE phone IS NULL;
-- =====================================================================
