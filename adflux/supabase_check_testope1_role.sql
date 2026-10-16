-- Diagnose why testope1 (Ankit) shows "STAFF".
-- Read-only. Confirms whether ROLE is correct + what the "STAFF" chip is.
SELECT id, name, email, role, team_role, designation, is_active
FROM public.users
WHERE email = 'testope1@untitledad.in';

-- EXPECTED (if only cosmetic):
--   role = 'operation_executive'   ← correct, ops module works
--   designation = 'Staff'          ← THIS is the "STAFF" chip (generic default)
--
-- If role = 'staff' instead of 'operation_executive' → the role itself is wrong
--   (ops nav/features would also be broken). Fix in PART 2 below.

-- ==== PART 2 · run ONLY if PART 1 shows role <> 'operation_executive' ====
-- UPDATE public.users
-- SET role = 'operation_executive'
-- WHERE email = 'testope1@untitledad.in';
