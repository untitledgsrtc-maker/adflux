-- =====================================================================
-- ADFLUX → UNTITLED OS  •  PHASE 9B
-- Seed private LED inventory at GSRTC stations into public.cities
-- =====================================================================
--
-- WHAT THIS DOES:
--   Inserts 20 GSRTC bus stations into the cities table as PRIVATE-side
--   LED inventory. Each row carries:
--     • commercial monthly_rate (from rate card "TOTAL PER MONTH")
--     • offer_rate              (from rate card "Special Offer Price")
--     • screen size + count + grade (from rate card)
--     • impressions_month / day / unique_viewers (from PDF deck where
--       data was provided; ANAND + KHEDA had no PDF panel so left at 0
--       for the team to fill in via /cities later)
--
-- IDEMPOTENT:
--   Skips any row whose name already exists in cities. Re-running is a
--   no-op. To force-update an existing row, edit it via the /cities UI
--   or DELETE first.
--
-- DATA SOURCE:
--   • GSRTC LED SCREEN- RATECARD.xlsx (uploaded 2026-05-04)
--   • LED SCREEN AT GSRTC WITH AI ANALYTICS 2.pdf (impressions per
--     station, AI Analytics deck)
--
-- =====================================================================

INSERT INTO public.cities
  (name, station_name, grade, screens, screen_size_inch,
   monthly_rate, offer_rate,
   impressions_month, impressions_day, unique_viewers,
   is_active)
SELECT v.* FROM (VALUES
  ('ANAND'::text,           'Anand Bus Stand'::text,           'B'::text, 20, 43, 36000, 13000,      0,    0,    0, true),
  ('KHEDA'::text,           'Kheda Bus Stand'::text,           'C'::text, 10, 55, 18000,  6500,      0,    0,    0, true),
  ('GANDHINAGAR'::text,     'Gandhinagar Bus Stand'::text,     'A'::text, 20, 55, 45000, 17000, 270000, 9000, 2000, true),
  ('HIMMATNAGAR'::text,     'Himmatnagar Bus Stand'::text,     'A'::text, 20, 55, 45000, 17000, 270000, 9000, 3000, true),
  ('DAHOD'::text,           'Dahod Bus Stand'::text,           'B'::text, 10, 55, 18000,  6500, 200000, 6500, 2000, true),
  ('GODHRA'::text,          'Godhra Bus Stand'::text,          'A'::text, 10, 43, 22500,  8500,  38000, 1200,  368, true),
  ('ANKLESHWAR GIDC'::text, 'Ankleshwar Gidc Bus Stand'::text, 'B'::text, 10, 55, 18000,  6500, 160000, 5300, 2000, true),
  ('SURAT (CITY)'::text,    'Surat (City) Bus Stand'::text,    'A'::text, 20, 55, 45000, 17000, 240000, 8000, 2500, true),
  ('VALSAD'::text,          'Valsad Bus Stand'::text,          'A'::text, 14, 55, 31500, 11900, 100000, 3500, 1200, true),
  ('CHIKHLI'::text,         'Chikhli Bus Stand'::text,         'B'::text, 10, 43, 18000,  6500, 150000, 5000, 1700, true),
  ('BOTAD'::text,           'Botad Bus Stand'::text,           'B'::text, 10, 55, 18000,  6500, 100000, 4000, 1500, true),
  ('BHAVNAGAR'::text,       'Bhavnagar Bus Stand'::text,       'A'::text, 15, 55, 33750, 12750, 160000, 5000, 2000, true),
  ('VERAVAL'::text,         'Veraval Bus Stand'::text,         'C'::text, 10, 55, 18000,  6500,  78000, 2600,  675, true),
  ('JUNAGADH'::text,        'Junagadh Bus Stand'::text,        'A'::text, 15, 55, 33750, 12750, 200000, 7000, 2400, true),
  ('PORBANDAR'::text,       'Porbandar Bus Stand'::text,       'B'::text, 10, 55, 18000,  6500, 150000, 5000, 1500, true),
  ('DWRKA'::text,           'Dwrka Bus Stand'::text,           'B'::text, 10, 55, 18000,  6500, 100000, 3000, 1400, true),
  ('JAMNAGAR'::text,        'Jamnagar Bus Stand'::text,        'A'::text, 10, 43, 22500,  8500, 140000, 4700, 1300, true),
  ('MORBI'::text,           'Morbi Bus Stand'::text,           'B'::text, 15, 55, 27000,  9750, 100000, 3500, 1300, true),
  ('BHACHAU'::text,         'Bhachau Bus Stand'::text,         'B'::text, 10, 55, 18000,  6500,  90000, 3000,  815, true),
  ('SURENDRANAGAR'::text,   'Surendranagar Bus Stand'::text,   'B'::text, 15, 55, 27000,  9750, 130000, 4000, 1500, true)
) AS v(name, station_name, grade, screens, screen_size_inch,
       monthly_rate, offer_rate,
       impressions_month, impressions_day, unique_viewers,
       is_active)
WHERE NOT EXISTS (
  SELECT 1 FROM public.cities c WHERE c.name = v.name
);


-- =====================================================================
-- VERIFY:
--
--   SELECT name, grade, screens, screen_size_inch,
--          monthly_rate, offer_rate,
--          impressions_month, impressions_day, unique_viewers
--     FROM public.cities
--    ORDER BY name;
--
--   -- Expected: 20 new GSRTC stations + whatever existed before.
--
-- =====================================================================
