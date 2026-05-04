-- =====================================================================
-- ADFLUX → UNTITLED OS  •  PHASE 8E
-- users.role: add 'agency' to the role check constraint
-- =====================================================================
--
-- WHAT THIS DOES:
--   Replaces the users.role check constraint to add a 5th value:
--   'agency'. Existing values stay: admin / sales / owner / co_owner.
--
-- WHY:
--   Owner spec — Master.Signers needs an "Agency" option in the
--   Promote-to-signer dropdown. Agency = signing authority on
--   government proposals (their name + signature_title appears on
--   the Gujarati letter) WITHOUT admin/owner-level read access to
--   the rest of the system.
--
-- PERMISSIONS:
--   This migration ONLY widens the enum. It does NOT add 'agency'
--   to any existing RLS policy. As a result:
--     • An 'agency' user CAN log in and CAN be assigned as a signer
--       on a proposal (their info renders on the letter).
--     • They CANNOT see admin pages, other reps' quotes, or the
--       team's data — their RLS reads return empty.
--   That's the intended scope for v1. If you later want agency
--   users to read specific scopes, add them explicitly to those
--   policies (e.g. quotes WHERE signer_user_id = auth.uid()).
--
-- IDEMPOTENT.
-- =====================================================================

-- 1) Replace the role check constraint -----------------------------
ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'sales', 'owner', 'co_owner', 'agency'));


-- =====================================================================
-- VERIFY:
--
--   -- Constraint includes 'agency':
--   SELECT pg_get_constraintdef(oid)
--     FROM pg_constraint
--    WHERE conname = 'users_role_check';
--
--   -- Try inserting a probe row (rolls back via transaction):
--   BEGIN;
--   INSERT INTO public.users (id, name, email, role)
--   VALUES (gen_random_uuid(), 'probe', 'probe@example.com', 'agency');
--   ROLLBACK;
--
--   -- Should succeed (no constraint violation).
--
-- =====================================================================
