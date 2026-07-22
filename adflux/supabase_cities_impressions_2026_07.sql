-- =====================================================================
-- Cities — update the 20 GSRTC cities' audience metrics from real measured
-- data (owner-supplied, Jul 2026).
--   impressions_month = TOTAL PEOPLE (measured)
--   unique_viewers    = TOTAL UNIQUE PEOPLE (measured)
--   impressions_day   = round(TOTAL PEOPLE / 30)
--
-- Matched by upper(name) LIKE '<KEY>%' so spelling/suffix differences in the
-- master ('Surat (City)', 'Ankleshwar GIDC', 'Veraval', 'Junagadh') all match.
-- These feed the Private-LED CPM (offer / impressions_month x 1000, Phase 212)
-- and the deck numbers. Idempotent (pure UPDATE of values).
-- =====================================================================

WITH v(key, impr_day, impr_month, uniq) AS (VALUES
  ('GANDHINAGAR',   10492, 314769, 80555),
  ('HIMMATNAGAR',   10211, 306326, 102501),
  ('DAHOD',          2754,  82626, 28298),
  ('KHEDA',          2917,  87496, 28759),
  ('VERAVAL',        4499, 134981, 52295),
  ('BOTAD',          2102,  63049, 18419),
  ('SURAT',          7449, 223457, 67273),
  ('MORBI',          2493,  74798, 28786),
  ('VALSAD',         3762, 112874, 37189),
  ('ANKLESHWAR',     6235, 187038, 66717),
  ('CHIKHLI',        2022,  60661, 15828),
  ('BHAVNAGAR',      7514, 225431, 81034),
  ('GODHRA',         7204, 216123, 57316),
  ('JUNAGADH',       7858, 235752, 79991),
  ('PORBANDAR',      4620, 138598, 44103),
  ('DWARKA',         3656, 109680, 38567),
  ('BHACHAU',        3488, 104648, 28184),
  ('JAMNAGAR',       6452, 193569, 64052),
  ('SURENDRANAGAR',  3759, 112767, 37519),
  ('ANAND',          7410, 222301, 70364)
)
UPDATE public.cities c
SET impressions_day   = v.impr_day,
    impressions_month = v.impr_month,
    unique_viewers    = v.uniq
FROM v
WHERE upper(c.name) LIKE v.key || '%';

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY — should list all 20 with the new numbers. If a city is MISSING
--     here (e.g. Dwarka), it's not in the master and needs adding first. ────
SELECT name, station_name, impressions_day, impressions_month, unique_viewers
FROM public.cities
WHERE upper(name) LIKE ANY (ARRAY[
  'GANDHINAGAR%','HIMMATNAGAR%','DAHOD%','KHEDA%','VERAVAL%','BOTAD%','SURAT%',
  'MORBI%','VALSAD%','ANKLESHWAR%','CHIKHLI%','BHAVNAGAR%','GODHRA%','JUNAGADH%',
  'PORBANDAR%','DWARKA%','BHACHAU%','JAMNAGAR%','SURENDRANAGAR%','ANAND%'])
ORDER BY name;
