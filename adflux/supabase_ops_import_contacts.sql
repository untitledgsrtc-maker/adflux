-- ============================================================================
-- supabase_ops_import_contacts.sql
-- Loads the REAL GSRTC station contacts (depot / electricians / cleaning /
-- canteen) from the owner's led-dashboard CITY_SEED into ops_depot_contacts,
-- so the /ops-fix "Who to call" screen shows real numbers instead of empty.
--
-- Idempotent: skips a (depot, phone) pair that already exists → safe to re-run.
-- Matches a seed station to your ops_depots by NORMALIZED name (strips
-- GSRTC / BUS STAND / BUS STOP / STAND / GIDC / (CITY) + spaces + punctuation),
-- the same idea the aiadflux sync uses (§249). Rows: 94.
-- Run PART 1 (import) then PART 2 (VERIFY) — PART 2 lists any station that did
-- NOT match a depot (e.g. a typo'd depot name like Dwrka/Chikli) so you can fix
-- that depot's name and re-run.
-- ============================================================================

-- ── normalize helper (inline, no function needed) ──
--   upper → strip the suffix words → keep only A-Z0-9

-- ── PART 1 · import ──
WITH seed(city, role_en, role_gu, cname, phone, ord) AS (
  VALUES
  ('Anand', 'Depot office', 'ડેપો ઓફિસ', NULL, '9825458400', 1),
  ('Anand', 'Electrician 1', 'ઇલેક્ટ્રિશિયન 1', NULL, '8153879699', 2),
  ('Anand', 'Electrician 2', 'ઇલેક્ટ્રિશિયન 2', NULL, '9327549540', 3),
  ('Kheda', 'Depot office', 'ડેપો ઓફિસ', NULL, '6359918662', 1),
  ('Kheda', 'Electrician 1', 'ઇલેક્ટ્રિશિયન 1', NULL, '8160671123', 2),
  ('Kheda', 'Electrician 2', 'ઇલેક્ટ્રિશિયન 2', NULL, '9974066181', 3),
  ('Kheda', 'Electrician 4', 'ઇલેક્ટ્રિશિયન 4', NULL, '9998364862', 4),
  ('Gandhinagar', 'Depot office', 'ડેપો ઓફિસ', NULL, '6359918291', 1),
  ('Gandhinagar', 'Electrician 1', 'ઇલેક્ટ્રિશિયન 1', NULL, '9574807887', 2),
  ('Gandhinagar', 'Electrician 2', 'ઇલેક્ટ્રિશિયન 2', NULL, '9898501205', 3),
  ('Himmatnagar', 'Depot office', 'ડેપો ઓફિસ', NULL, '6359918508', 1),
  ('Himmatnagar', 'Electrician 1', 'ઇલેક્ટ્રિશિયન 1', NULL, '9427054682', 2),
  ('Himmatnagar', 'Electrician 2', 'ઇલેક્ટ્રિશિયન 2', NULL, '8200286157', 3),
  ('Himmatnagar', 'Electrician 3', 'ઇલેક્ટ્રિશિયન 3', NULL, '6359537129', 4),
  ('Himmatnagar', 'Cleaning (safai)', 'સફાઈ', 'Nayan Bhai', '9313706695', 5),
  ('Dahod', 'Depot office', 'ડેપો ઓફિસ', NULL, '6359918474', 1),
  ('Dahod', 'Electrician 1', 'ઇલેક્ટ્રિશિયન 1', NULL, '9925982360', 2),
  ('Dahod', 'Electrician 2', 'ઇલેક્ટ્રિશિયન 2', NULL, '9426531306', 3),
  ('Godhra', 'Depot office', 'ડેપો ઓફિસ', NULL, '6359918478', 1),
  ('Godhra', 'Depot office', 'ડેપો ઓફિસ', NULL, '6359918477', 2),
  ('Godhra', 'Depot office', 'ડેપો ઓફિસ', NULL, '7069701621', 3),
  ('Godhra', 'Electrician 1', 'ઇલેક્ટ્રિશિયન 1', 'Depo Electrician', '9726298287', 4),
  ('Godhra', 'Electrician 2', 'ઇલેક્ટ્રિશિયન 2', NULL, '7405040672', 5),
  ('Godhra', 'Canteen', 'કેન્ટીન', NULL, '6351849463', 6),
  ('Godhra', 'Canteen', 'કેન્ટીન', NULL, '7698330501', 7),
  ('Ankleshwar GIDC', 'Depot office', 'ડેપો ઓફિસ', NULL, '6359918378', 1),
  ('Ankleshwar GIDC', 'Electrician 1', 'ઇલેક્ટ્રિશિયન 1', NULL, '9561372474', 2),
  ('Ankleshwar GIDC', 'Electrician 2', 'ઇલેક્ટ્રિશિયન 2', NULL, '9725824684', 3),
  ('Ankleshwar GIDC', 'Cleaning (safai)', 'સફાઈ', NULL, '9712245358', 4),
  ('Surat (City)', 'Depot office', 'ડેપો ઓફિસ', NULL, '6359918768', 1),
  ('Surat (City)', 'Depot office', 'ડેપો ઓફિસ', NULL, '6359918769', 2),
  ('Surat (City)', 'Electrician 1', 'ઇલેક્ટ્રિશિયન 1', 'Kadar Bhai', '9898242462', 3),
  ('Surat (City)', 'Electrician 2', 'ઇલેક્ટ્રિશિયન 2', NULL, '9898919066', 4),
  ('Surat (City)', 'Electrician 3', 'ઇલેક્ટ્રિશિયન 3', NULL, '9157816530', 5),
  ('Surat (City)', 'Electrician 4', 'ઇલેક્ટ્રિશિયન 4', NULL, '8780162552', 6),
  ('Valsad', 'Depot office', 'ડેપો ઓફિસ', NULL, '6359918775', 1),
  ('Valsad', 'Electrician 1', 'ઇલેક્ટ્રિશિયન 1', NULL, '9428716375', 2),
  ('Valsad', 'Electrician 2', 'ઇલેક્ટ્રિશિયન 2', NULL, '9909569464', 3),
  ('Chikhli', 'Depot office', 'ડેપો ઓફિસ', NULL, '8799611277', 1),
  ('Chikhli', 'Electrician 1', 'ઇલેક્ટ્રિશિયન 1', NULL, '9428716375', 2),
  ('Chikhli', 'Electrician 2', 'ઇલેક્ટ્રિશિયન 2', NULL, '8780162552', 3),
  ('Chikhli', 'Electrician 3', 'ઇલેક્ટ્રિશિયન 3', NULL, '8849768211', 4),
  ('Chikhli', 'Electrician 4', 'ઇલેક્ટ્રિશિયન 4', NULL, '9825796409', 5),
  ('Botad', 'Depot office', 'ડેપો ઓફિસ', NULL, '6359918409', 1),
  ('Botad', 'Depot office', 'ડેપો ઓફિસ', NULL, '9724537446', 2),
  ('Botad', 'Electrician 1', 'ઇલેક્ટ્રિશિયન 1', NULL, '9978395935', 3),
  ('Botad', 'Electrician 2', 'ઇલેક્ટ્રિશિયન 2', NULL, '7626990440', 4),
  ('Botad', 'Electrician 3', 'ઇલેક્ટ્રિશિયન 3', NULL, '9227534555', 5),
  ('Botad', 'Electrician 4', 'ઇલેક્ટ્રિશિયન 4', NULL, '9274374399', 6),
  ('Bhavnagar', 'Depot office', 'ડેપો ઓફિસ', NULL, '6359918406', 1),
  ('Bhavnagar', 'Depot office', 'ડેપો ઓફિસ', NULL, '9898606044', 2),
  ('Bhavnagar', 'Electrician 1', 'ઇલેક્ટ્રિશિયન 1', 'Chirag Bhai', '7600607661', 3),
  ('Bhavnagar', 'Electrician 2', 'ઇલેક્ટ્રિશિયન 2', NULL, '9825212018', 4),
  ('Bhavnagar', 'Electrician 3', 'ઇલેક્ટ્રિશિયન 3', NULL, '7359010125', 5),
  ('Veraval', 'Depot office', 'ડેપો ઓફિસ', NULL, '6359918589', 1),
  ('Veraval', 'Electrician 1', 'ઇલેક્ટ્રિશિયન 1', NULL, '9313577411', 2),
  ('Veraval', 'Electrician 2', 'ઇલેક્ટ્રિશિયન 2', NULL, '9898985857', 3),
  ('Veraval', 'Electrician 3', 'ઇલેક્ટ્રિશિયન 3', NULL, '7211117071', 4),
  ('Junagadh', 'Depot office', 'ડેપો ઓફિસ', NULL, '9638056233', 1),
  ('Junagadh', 'Depot office', 'ડેપો ઓફિસ', NULL, '6359918573', 2),
  ('Junagadh', 'Electrician 1', 'ઇલેક્ટ્રિશિયન 1', NULL, '9586297985', 3),
  ('Junagadh', 'Electrician 2', 'ઇલેક્ટ્રિશિયન 2', NULL, '7043299704', 4),
  ('Porbandar', 'Depot office', 'ડેપો ઓફિસ', NULL, '6359918582', 1),
  ('Porbandar', 'Depot office', 'ડેપો ઓફિસ', NULL, '9723895330', 2),
  ('Porbandar', 'Depot office', 'ડેપો ઓફિસ', NULL, '6359918583', 3),
  ('Porbandar', 'Electrician 1', 'ઇલેક્ટ્રિશિયન 1', 'Sanjay Bhai', '9624598178', 4),
  ('Porbandar', 'Electrician 2', 'ઇલેક્ટ્રિશિયન 2', NULL, '7043299704', 5),
  ('Porbandar', 'Electrician 3', 'ઇલેક્ટ્રિશિયન 3', NULL, '9925236644', 6),
  ('Dwarka', 'Depot office', 'ડેપો ઓફિસ', NULL, '6359918542', 1),
  ('Dwarka', 'Depot office', 'ડેપો ઓફિસ', NULL, '9879108853', 2),
  ('Dwarka', 'Electrician 2', 'ઇલેક્ટ્રિશિયન 2', NULL, '8673883029', 3),
  ('Dwarka', 'Electrician 3', 'ઇલેક્ટ્રિશિયન 3', NULL, '8511017761', 4),
  ('Dwarka', 'Electrician 4', 'ઇલેક્ટ્રિશિયન 4', NULL, '9427279227', 5),
  ('Jamnagar', 'Depot office', 'ડેપો ઓફિસ', NULL, '6359918548', 1),
  ('Jamnagar', 'Depot office', 'ડેપો ઓફિસ', NULL, '6359918529', 2),
  ('Jamnagar', 'Electrician 1', 'ઇલેક્ટ્રિશિયન 1', NULL, '9909811567', 3),
  ('Jamnagar', 'Electrician 2', 'ઇલેક્ટ્રિશિયન 2', NULL, '8140177756', 4),
  ('Jamnagar', 'Electrician 3', 'ઇલેક્ટ્રિશિયન 3', NULL, '8000566338', 5),
  ('Morbi', 'Depot office', 'ડેપો ઓફિસ', NULL, '6359918733', 1),
  ('Morbi', 'Depot office', 'ડેપો ઓફિસ', NULL, '9913897013', 2),
  ('Morbi', 'Electrician 1', 'ઇલેક્ટ્રિશિયન 1', 'Alpesh Bhai', '7041946925', 3),
  ('Morbi', 'Electrician 2', 'ઇલેક્ટ્રિશિયન 2', NULL, '9925973828', 4),
  ('Morbi', 'Electrician 3', 'ઇલેક્ટ્રિશિયન 3', NULL, '8128122370', 5),
  ('Morbi', 'Cleaning (safai)', 'સફાઈ', NULL, '9023289812', 6),
  ('Bhachau', 'Depot office', 'ડેપો ઓફિસ', NULL, '6359918443', 1),
  ('Bhachau', 'Depot office', 'ડેપો ઓફિસ', NULL, '9376012712', 2),
  ('Bhachau', 'Electrician 1', 'ઇલેક્ટ્રિશિયન 1', NULL, '9879808251', 3),
  ('Bhachau', 'Electrician 2', 'ઇલેક્ટ્રિશિયન 2', NULL, '9979454934', 4),
  ('Bhachau', 'Cleaning (safai)', 'સફાઈ', 'Photo-Screen Safai', '9016065760', 5),
  ('Surendranagar', 'Depot office', 'ડેપો ઓફિસ', NULL, '6359918739', 1),
  ('Surendranagar', 'Depot office', 'ડેપો ઓફિસ', NULL, '6359918740', 2),
  ('Surendranagar', 'Electrician 1', 'ઇલેક્ટ્રિશિયન 1', NULL, '9725556657', 3),
  ('Surendranagar', 'Electrician 2', 'ઇલેક્ટ્રિશિયન 2', NULL, '9512399570', 4),
  ('Surendranagar', 'Cleaning (safai)', 'સફાઈ', NULL, '9998060380', 5)
),
m AS (
  SELECT s.*, d.id AS depot_id
  FROM seed s
  JOIN public.ops_depots d
    ON regexp_replace(upper(regexp_replace(d.name,   '(GSRTC|BUS STAND|BUS STOP|STAND|GIDC|\(CITY\))', '', 'gi')), '[^A-Z0-9]', '', 'g')
     = regexp_replace(upper(regexp_replace(s.city,   '(GSRTC|BUS STAND|BUS STOP|STAND|GIDC|\(CITY\))', '', 'gi')), '[^A-Z0-9]', '', 'g')
   AND d.is_active
)
INSERT INTO public.ops_depot_contacts (depot_id, role_en, role_gu, name, phone, display_order)
SELECT m.depot_id, m.role_en, m.role_gu, m.cname, m.phone, m.ord
FROM m
WHERE NOT EXISTS (
  SELECT 1 FROM public.ops_depot_contacts c
  WHERE c.depot_id = m.depot_id AND regexp_replace(c.phone, '[^0-9]', '', 'g') = m.phone
);

NOTIFY pgrst, 'reload schema';

-- ── PART 2 · VERIFY (run as a SELECT) ──
-- 2a. how many contacts imported per station:
--   SELECT d.name, count(c.id) AS contacts
--   FROM public.ops_depots d LEFT JOIN public.ops_depot_contacts c ON c.depot_id = d.id
--   WHERE d.is_active GROUP BY d.name ORDER BY contacts DESC, d.name;
--
-- 2b. seed stations that matched NO depot (fix the depot name + re-run):
--   WITH seed(city) AS (VALUES ('Anand'), ('Kheda'), ('Gandhinagar'), ('Himmatnagar'), ('Dahod'), ('Godhra'), ('Ankleshwar GIDC'), ('Surat (City)'), ('Valsad'), ('Chikhli'), ('Botad'), ('Bhavnagar'), ('Veraval'), ('Junagadh'), ('Porbandar'), ('Dwarka'), ('Jamnagar'), ('Morbi'), ('Bhachau'), ('Surendranagar'))
--   SELECT s.city AS unmatched_station FROM seed s
--   WHERE NOT EXISTS (
--     SELECT 1 FROM public.ops_depots d WHERE d.is_active
--       AND regexp_replace(upper(regexp_replace(d.name,'(GSRTC|BUS STAND|BUS STOP|STAND|GIDC|\(CITY\))','','gi')),'[^A-Z0-9]','','g')
--         = regexp_replace(upper(regexp_replace(s.city,'(GSRTC|BUS STAND|BUS STOP|STAND|GIDC|\(CITY\))','','gi')),'[^A-Z0-9]','','g'));
-- ============================================================================
