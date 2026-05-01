-- =====================================================================
-- ADFLUX → UNTITLED OS  •  STAGING SEED USERS
-- =====================================================================
--
-- Creates 3 test users on staging Supabase so Sprint 2 wizard can be
-- tested end-to-end:
--   1. Admin   (you — sees everything, both segments)
--   2. Private (test view from a Private-only sales rep)
--   3. Govt    (test view from a Government-only sales rep)
--
-- This file CANNOT be run as-is — it has 3 placeholder UUIDs that you
-- need to replace with real values. Follow Steps 1, 2, 3 below in order.
--
-- This file is for STAGING ONLY. Do NOT run on production main.
-- =====================================================================


-- =====================================================================
-- STEP 1 — Create the 3 auth users in Supabase Studio
-- =====================================================================
--
-- 1. Open your STAGING Supabase project (the untitled-os one, NOT
--    your production AdFlux one). Confirm the project name in the
--    top-left corner before continuing.
-- 2. In the left sidebar, click  Authentication  →  Users
-- 3. Click the  +  Add user  button (top right) →  Create new user
-- 4. Create THREE users with these exact emails. Use any password
--    that is 8+ characters — write them down somewhere, you'll need
--    them to log in:
--
--      a) brijesh-staging@untitledadvertising.in    (admin — you)
--      b) private-test@untitledadvertising.in       (Private rep)
--      c) govt-test@untitledadvertising.in          (Government rep)
--
--    Tip: tick "Auto Confirm User" so they don't need email verification.
--
-- 5. After all 3 are created, the Users list shows each one with a
--    UUID. CLICK on the user row to see the full UUID, OR hover over
--    the truncated UUID to copy it.
--
-- 6. Copy the 3 UUIDs into a notepad — you'll paste them in Step 2.


-- =====================================================================
-- STEP 2 — Replace the 3 placeholders below
-- =====================================================================
--
-- Use Cmd+F (Find & Replace) in Supabase SQL editor:
--
--   PASTE_ADMIN_UUID_HERE     →  paste the admin user's UUID
--   PASTE_PRIVATE_UUID_HERE   →  paste the Private rep's UUID
--   PASTE_GOVT_UUID_HERE      →  paste the Government rep's UUID
--
-- Each UUID looks like:  a1b2c3d4-5e6f-7890-1234-567890abcdef
-- (32 hex characters with dashes — exactly 36 chars total)


-- =====================================================================
-- STEP 3 — Run this INSERT in Supabase SQL editor
-- =====================================================================

INSERT INTO public.users (id, name, email, role, segment_access, is_active)
VALUES
  ('5b7a672f-5ffc-4fb1-87d4-a59807db3aee', 'Brijesh Solanki (Staging)', 'brijesh-staging@untitledadvertising.in', 'admin', 'ALL',        true),
  ('183c24eb-456f-4aa9-983b-52e6d21cd9d2', 'Test Private Rep',           'private-test@untitledadvertising.in',  'sales', 'PRIVATE',    true),
  ('dea9e1a8-7243-42f6-9d46-d7a23afc2289', 'Test Government Rep',        'govt-test@untitledadvertising.in',     'sales', 'GOVERNMENT', true)
ON CONFLICT (id) DO UPDATE SET
  name           = EXCLUDED.name,
  email          = EXCLUDED.email,
  role           = EXCLUDED.role,
  segment_access = EXCLUDED.segment_access,
  is_active      = EXCLUDED.is_active;


-- =====================================================================
-- VERIFY  (run this SELECT in the SQL editor — expect 3 rows back)
-- =====================================================================
--
--   SELECT name, email, role, segment_access, is_active
--     FROM public.users
--    ORDER BY role DESC, segment_access;
--
-- Expected output:
--   Brijesh Solanki (Staging) | brijesh-staging@...  | admin | ALL        | true
--   Test Private Rep          | private-test@...     | sales | PRIVATE    | true
--   Test Government Rep       | govt-test@...        | sales | GOVERNMENT | true
--
-- =====================================================================


-- =====================================================================
-- WHAT HAPPENS NEXT (auto-triggered by the INSERT above):
-- =====================================================================
-- The existing AdFlux trigger `users_auto_incentive_profile` fires
-- automatically for the 2 sales users — it creates a row in
-- staff_incentive_profiles for each of them with default rates.
-- Admin user does NOT get an incentive profile (admins don't earn
-- incentive). This is the existing AdFlux behavior, unchanged.
-- =====================================================================
