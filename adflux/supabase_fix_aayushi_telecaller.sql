-- Aayushi parmar is a TELECALLER but her DB role is 'sales'.
-- The app routes/queues/targets/incentive by role (+ team_role) — a sales-role
-- telecaller lands on /work (meeting flow) instead of /telecaller (call flow).
-- Mirror an existing working telecaller exactly, then set Aayushi to match.
-- Owner runs top-to-bottom in Supabase Studio.

-- ==== PART 1 · BEFORE — Aayushi + a reference telecaller (copy its role/team_role) ====
SELECT name, email, role, team_role, designation, whatsapp_number
FROM public.users
WHERE name ILIKE '%aayushi%parmar%';

SELECT name, role, team_role, designation
FROM public.users
WHERE role = 'telecaller' AND is_active
ORDER BY name
LIMIT 3;

-- ==== PART 2 · FIX — set role + team_role to match a working telecaller ====
-- ('telecaller' is valid for BOTH users_role_check and users_team_role_check —
--  existing telecallers carry it; §284 lesson: the two CHECKs differ, verify each.)
UPDATE public.users
SET role = 'telecaller', team_role = 'telecaller'
WHERE name ILIKE '%aayushi%parmar%' AND role = 'sales';

-- ==== PART 3 · VERIFY (expect role + team_role = telecaller) ====
SELECT name, email, role, team_role, designation, whatsapp_number
FROM public.users
WHERE name ILIKE '%aayushi%parmar%';
