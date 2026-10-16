-- Map Aayushi parmar's WhatsApp number (§281/§282 pending sales-rep mapping).
-- Owner runs in Supabase Studio. Idempotent + clash-guarded.
-- last-10 of 9974573686 = 9974573686 (§197 webhook rep-vs-customer match is last-10).
-- ⚠ This number MUST be Aayushi's OWN WhatsApp — a wrong number routes her
--    "Good morning" into the CUSTOMER funnel (§197/§198). Confirm PART 1 = 1 row first.

-- ==== PART 1 · PREVIEW (read-only) — expect exactly ONE row, Aayushi parmar ====
SELECT id, name, role, team_role, is_active, whatsapp_number
FROM public.users
WHERE name ILIKE '%aayushi%parmar%';

-- ==== PART 2 · MAP — run only after PART 1 shows the single correct row ====
UPDATE public.users u
SET whatsapp_number = '9974573686'
WHERE u.name ILIKE '%aayushi%parmar%'
  AND u.is_active
  AND NOT EXISTS (                              -- never steal a number already mapped elsewhere
    SELECT 1 FROM public.users x
    WHERE x.whatsapp_number = '9974573686' AND x.id <> u.id
  );

-- ==== PART 3 · VERIFY — expect Aayushi mapped ====
SELECT id, name, role, whatsapp_number
FROM public.users
WHERE name ILIKE '%aayushi%parmar%';
