-- Jani Ajaykumar is a Sales Executive, not Sales Head. Correct the designation.
-- role/team_role already 'sales'/'sales' (correct for an executive) — leave them.
-- Owner runs in Studio.

-- BEFORE
SELECT name, email, role, team_role, designation FROM public.users WHERE name ILIKE '%jani%';

-- FIX
UPDATE public.users
SET designation = 'Sales Executive'
WHERE name ILIKE '%jani%' AND designation = 'Sales Head';

-- AFTER (expect designation = Sales Executive)
SELECT name, email, role, team_role, designation FROM public.users WHERE name ILIKE '%jani%';
