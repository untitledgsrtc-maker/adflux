-- =====================================================================
-- ADFLUX → UNTITLED OS  •  STAGING SEED — Vishal (co-owner / signer)
-- =====================================================================
--
-- Adds Vishal Chauhan as a co-owner on staging Supabase, with
-- signing_authority = true so he appears in the wizard's signer
-- dropdown alongside Brijesh.
--
-- Run AFTER you've applied phase5 migration (which adds the 'co_owner'
-- role to the enum and the signing_authority column).
--
-- This is a 2-step seed like the earlier seed_test_users.sql.
-- =====================================================================


-- =====================================================================
-- STEP 1 — Create Vishal's auth user in Supabase Studio
-- =====================================================================
--
-- 1. Open the STAGING Supabase project (untitled-os, not production).
-- 2. Authentication → Users → Add user → Create new user
-- 3. Email: vishal@untitledad.in
--    Password: any 8+ characters, write it down
--    Tick "Auto Confirm User"
-- 4. After creation, click his row to copy his UUID.


-- =====================================================================
-- STEP 2 — Replace VISHAL_UUID below with the real one, then run
-- =====================================================================
--
-- Find/replace:  PASTE_VISHAL_UUID_HERE → the UUID from Step 1


INSERT INTO public.users
  (id, name, email, role, segment_access, signing_authority, is_active)
VALUES
  ('5e6690aa-7fce-4503-9101-28520930fd51',
   'Vishal Chauhan',
   'vishal@untitledad.in',
   'co_owner',
   'ALL',
   true,
   true)
ON CONFLICT (id) DO UPDATE SET
  name              = EXCLUDED.name,
  email             = EXCLUDED.email,
  role              = EXCLUDED.role,
  segment_access    = EXCLUDED.segment_access,
  signing_authority = EXCLUDED.signing_authority,
  is_active         = EXCLUDED.is_active;


-- =====================================================================
-- VERIFY:
--
--   SELECT name, email, role, segment_access, signing_authority
--     FROM public.users
--    WHERE signing_authority = true
--    ORDER BY role, name;
--
-- Expected (at least 2 rows):
--   Brijesh ...           | admin    | ALL | true
--   Brijesh Solanki ...   | admin    | ALL | true
--   Vishal Chauhan        | co_owner | ALL | true
--
-- =====================================================================
