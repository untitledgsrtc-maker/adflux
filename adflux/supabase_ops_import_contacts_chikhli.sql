-- ============================================================================
-- supabase_ops_import_contacts_chikhli.sql
-- Chikhli didn't match in supabase_ops_import_contacts.sql because its depot
-- name in ops_depots is typo'd ("Chikli", missing the h — the §249 CMS dup).
-- This inserts Chikhli's contacts into the depot whose normalized name STARTS
-- with "CHIKL" (matches Chikli / Chikhli / any suffix) — no other station
-- starts CHIKL, so it's safe. Idempotent (skips a phone already present).
-- ============================================================================
WITH seed(role_en, role_gu, phone, ord) AS (
  VALUES
    ('Depot office',  'ડેપો ઓફિસ',      '8799611277', 1),
    ('Electrician 1', 'ઇલેક્ટ્રિશિયન 1', '9428716375', 2),
    ('Electrician 2', 'ઇલેક્ટ્રિશિયન 2', '8780162552', 3),
    ('Electrician 3', 'ઇલેક્ટ્રિશિયન 3', '8849768211', 4),
    ('Electrician 4', 'ઇલેક્ટ્રિશિયન 4', '9825796409', 5)
),
d AS (
  SELECT id FROM public.ops_depots
  WHERE is_active
    AND regexp_replace(upper(name), '[^A-Z0-9]', '', 'g') LIKE 'CHIKL%'
  LIMIT 1
)
INSERT INTO public.ops_depot_contacts (depot_id, role_en, role_gu, name, phone, display_order)
SELECT d.id, s.role_en, s.role_gu, NULL, s.phone, s.ord
FROM seed s CROSS JOIN d
WHERE NOT EXISTS (
  SELECT 1 FROM public.ops_depot_contacts c
  WHERE c.depot_id = d.id AND regexp_replace(c.phone, '[^0-9]', '', 'g') = s.phone
);

NOTIFY pgrst, 'reload schema';

-- VERIFY (run as SELECT): the Chikli/Chikhli depot + its new contact count
--   SELECT d.name, count(c.id) AS contacts
--   FROM public.ops_depots d LEFT JOIN public.ops_depot_contacts c ON c.depot_id = d.id
--   WHERE regexp_replace(upper(d.name),'[^A-Z0-9]','','g') LIKE 'CHIKL%'
--   GROUP BY d.name;
-- ============================================================================
