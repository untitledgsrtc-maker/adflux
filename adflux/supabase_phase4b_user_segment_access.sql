-- =====================================================================
-- ADFLUX → UNTITLED OS  •  PHASE 4B
-- Migration: add segment_access to users
-- =====================================================================
--
-- WHAT THIS DOES:
--   1. Adds segment_access column to users:
--        • 'PRIVATE'    — sales rep can only see Private-segment data
--        • 'GOVERNMENT' — sales rep can only see Government-segment data
--        • 'ALL'        — admin / no scope restriction
--   2. Backfills by role:
--        • role = 'sales' → 'PRIVATE'  (existing reps stay on Private)
--        • role = 'admin' → 'ALL'      (full access)
--   3. Locks NOT NULL with CHECK constraint.
--   4. Sets sensible default for new inserts.
--   5. Adds helper function get_my_segment_access() — mirrors the
--      existing get_my_role() pattern. Used by phase4e RLS policies.
--
-- DECISIONS BEHIND THIS:
--   - Owner decision (Brijesh, 30 Apr 2026): existing 5 sales reps
--     (Brahmbhatt, Sondarva, Dhara, Vishnu, Nikhil) stay on Private.
--     New hires will be created with segment_access = 'GOVERNMENT'.
--   - sales_lead role + manager_id deferred until Sales Lead is
--     actually promoted (architecture v1 §9.4 — Month 3). For now,
--     all sales reps' implicit "manager" is the admin user.
--   - telecaller role deferred to Phase 2 (M7).
--
-- WHAT THIS DOES *NOT* TOUCH:
--   - Existing user role CHECK constraint (admin, sales) — unchanged
--   - RLS policies on users table — unchanged
--   - Quotes RLS — handled separately in phase4e
--
-- IDEMPOTENT.
-- =====================================================================


-- 1) Add column nullable so backfill can run first --------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS segment_access text;


-- 2) Backfill by role -------------------------------------------------
UPDATE public.users
   SET segment_access = 'PRIVATE'
 WHERE segment_access IS NULL
   AND role = 'sales';

UPDATE public.users
   SET segment_access = 'ALL'
 WHERE segment_access IS NULL
   AND role = 'admin';

-- Catch any future role rows that we don't have a default for
UPDATE public.users
   SET segment_access = 'ALL'
 WHERE segment_access IS NULL;


-- 3) Lock NOT NULL + CHECK constraint ---------------------------------
ALTER TABLE public.users
  ALTER COLUMN segment_access SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'users_segment_access_check'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_segment_access_check
      CHECK (segment_access IN ('PRIVATE', 'GOVERNMENT', 'ALL'));
  END IF;
END $$;


-- 4) Sensible default for new inserts ---------------------------------
ALTER TABLE public.users
  ALTER COLUMN segment_access SET DEFAULT 'ALL';


-- 5) Index for fast RLS lookups ---------------------------------------
CREATE INDEX IF NOT EXISTS idx_users_segment_access
  ON public.users (segment_access);


-- =====================================================================
-- HELPER FUNCTION: get_my_segment_access()
-- =====================================================================
--   Mirrors the existing get_my_role() pattern from supabase_schema.sql.
--   SECURITY DEFINER so it can read users table even when called by
--   policies that filter the same table.

CREATE OR REPLACE FUNCTION public.get_my_segment_access()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT segment_access FROM users WHERE id = auth.uid()
$$;


-- =====================================================================
-- VERIFY:
--
--   SELECT role, segment_access, COUNT(*)
--     FROM public.users
--    GROUP BY 1,2
--    ORDER BY 1,2;
--
-- On STAGING (empty Supabase): "No rows returned" — expected.
-- On PRODUCTION main: should show
--      admin | ALL     | 1
--      sales | PRIVATE | 5
-- =====================================================================
