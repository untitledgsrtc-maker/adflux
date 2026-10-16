-- (1) map Jani Ajaykumar's WhatsApp, (2) set Ankit + Gulshan to operation_executive.
-- Same role-mint fix class as §284/§285. Owner runs top-to-bottom in Supabase Studio.
-- team_role LEFT UNTOUCHED (operation_executive is NOT a valid team_role — §284; the
-- app gates ops on ROLE only). Only role + designation change.

-- ==== PART 1 · BEFORE (read-only) — check the 3 people ====
SELECT name, email, role, team_role, designation, whatsapp_number
FROM public.users
WHERE name ILIKE '%jani%' OR name ILIKE '%ajay%'
   OR name ILIKE '%gulshan%' OR name ILIKE '%ankit%'
ORDER BY name;

-- ==== PART 2 · MAP Ajay's WhatsApp (clash-guarded) ====
UPDATE public.users u
SET whatsapp_number = '7041873686'
WHERE u.name ILIKE '%jani%' AND u.is_active
  AND NOT EXISTS (SELECT 1 FROM public.users x
                  WHERE x.whatsapp_number = '7041873686' AND x.id <> u.id);

-- ==== PART 3 · SET Ankit + Gulshan to operation_executive (role + designation) ====
-- Only flips rows not already ops; leaves team_role as-is.
UPDATE public.users
SET role = 'operation_executive',
    designation = 'Operation Execution'
WHERE (name ILIKE '%gulshan%' OR name ILIKE '%ankit%')
  AND role NOT IN ('operation_executive', 'operation_head');

-- ==== PART 4 · VERIFY ====
SELECT name, email, role, team_role, designation, whatsapp_number
FROM public.users
WHERE name ILIKE '%jani%' OR name ILIKE '%ajay%'
   OR name ILIKE '%gulshan%' OR name ILIKE '%ankit%'
ORDER BY name;
