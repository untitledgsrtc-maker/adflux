-- =====================================================================
-- UNTITLED PROPOSALS — Migration 007: Seed Data
-- Pre-fills: media types, 20 GSRTC stations, 33 Auto districts,
--           Auto DAVP rate, sample team member
-- =====================================================================

-- =====================================================================
-- MEDIA TYPES
-- =====================================================================
insert into public.media_types (code, name_en, name_gu, description_en, description_gu, ref_prefix, display_order)
values
  ('AUTO',  'Auto Hood Advertising', 'ઓટો રિક્ષા હૂડ જાહેરાત',
   'Advertising on auto-rickshaw hoods across Gujarat',
   'ગુજરાત સ્થિત ઓટો રિક્ષાના હૂડ પર જાહેરાત',
   'AUTO', 1),
  ('GSRTC', 'GSRTC LED Screen Advertising', 'GSRTC LED સ્ક્રીન જાહેરાત',
   'AI-powered LED screen advertising at GSRTC bus stations',
   'GSRTC બસ સ્ટેશન પર AI-આધારિત LED સ્ક્રીન જાહેરાત',
   'GSRTC', 2)
on conflict (code) do nothing;

-- =====================================================================
-- GSRTC STATIONS (from your corrected screenshot: Valsad = 14 screens)
-- Rates: A=₹3.00, B=₹2.75, C=₹2.50 per 10-sec slot
-- Monthly spots: A=1500, B=800 (except Botad=1000), C=800
-- Agency rates (from Adflux Cities module): A=₹850/mo, B/C=₹650/mo
-- Rack rates: A=₹2250, B/C=₹1800
-- =====================================================================
insert into public.gsrtc_stations
  (serial_no, station_name_en, station_name_gu, category, screens_count,
   monthly_spots, davp_per_slot_rate, agency_monthly_rate, agency_rack_rate)
values
  (1,  'Anand (New)',      'આણંદ (Anand New)',  'B', 20, 800,  2.75, 650, 1800),
  (2,  'Kheda',             'ખેડા (Kheda)',       'C', 10, 800,  2.50, 650, 1800),
  (3,  'Gandhinagar',       'ગાંધીનગર',           'A', 20, 1500, 3.00, 850, 2250),
  (4,  'Himmatnagar',       'હિંમતનગર',           'A', 20, 1500, 3.00, 850, 2250),
  (5,  'Dahod',             'દાહોદ',              'B', 10, 800,  2.75, 650, 1800),
  (6,  'Godhra',            'ગોધરા',              'A', 10, 1500, 3.00, 850, 2250),
  (7,  'Ankleshwar GIDC',   'અંકલેશ્વર GIDC',     'B', 10, 800,  2.75, 650, 1800),
  (8,  'Surat (City)',      'સુરત (સિટી)',        'A', 20, 1500, 3.00, 850, 2250),
  (9,  'Valsad',            'વલસાડ',              'A', 14, 1500, 3.00, 850, 2250),
  (10, 'Chikhli',           'ચિખલી',              'B', 10, 800,  2.75, 650, 1800),
  (11, 'Botad',             'બોટાદ',              'B', 10, 1000, 2.75, 650, 1800),
  (12, 'Bhavnagar',         'ભાવનગર',             'A', 15, 1500, 3.00, 850, 2250),
  (13, 'Veraval',           'વેરાવળ',             'C', 10, 800,  2.50, 650, 1800),
  (14, 'Junagadh',          'જુનાગઢ',             'A', 15, 1500, 3.00, 850, 2250),
  (15, 'Porbandar',         'પોરબંદર',            'B', 10, 800,  2.75, 650, 1800),
  (16, 'Dwarka',            'દ્વારકા',            'B', 10, 800,  2.75, 650, 1800),
  (17, 'Jamnagar',          'જામનગર',             'A', 10, 1500, 3.00, 850, 2250),
  (18, 'Morbi',             'મોરબી',              'B', 15, 800,  2.75, 650, 1800),
  (19, 'Bhachau',           'ભચાઉ',               'B', 10, 800,  2.75, 650, 1800),
  (20, 'Surendranagar',     'સુરેન્દ્રનગર',       'B', 15, 800,  2.75, 650, 1800)
on conflict do nothing;

-- =====================================================================
-- AUTO DISTRICTS (33 districts of Gujarat with rickshaw counts)
-- =====================================================================
insert into public.auto_districts
  (serial_no, district_name_en, district_name_gu, available_rickshaw_count)
values
  (1,  'Kutch',           'કચ્છ',              2500),
  (2,  'Banaskantha',     'બનાસકાંઠા',          1750),
  (3,  'Patan',           'પાટણ',              1200),
  (4,  'Mehsana',         'મેહસાણા',            1500),
  (5,  'Sabarkantha',     'સાબરકાંઠા',          500),
  (6,  'Aravalli',        'અરવલ્લી',            500),
  (7,  'Gandhinagar',     'ગાંધીનગર',          1500),
  (8,  'Ahmedabad',       'અમદાવાદ',           15400),
  (9,  'Surendranagar',   'સુરેન્દ્રનગર',      3500),
  (10, 'Bhavnagar',       'ભાવનગર',            4000),
  (11, 'Botad',           'બોટાદ',              800),
  (12, 'Rajkot',          'રાજકોટ',            8000),
  (13, 'Morbi',           'મોરબી',             2500),
  (14, 'Jamnagar',        'જામનગર',            1550),
  (15, 'Devbhumi Dwarka', 'દેવભૂમિ દ્વારકા',     200),
  (16, 'Porbandar',       'પોરબંદર',           1200),
  (17, 'Junagadh',        'જૂનાગઢ',            1900),
  (18, 'Gir Somnath',     'ગીર સોમનાથ',         300),
  (19, 'Amreli',          'અમરેલી',            3200),
  (20, 'Anand',           'આણંદ',              4500),
  (21, 'Kheda',           'ખેડા',              5500),
  (22, 'Panchmahal',      'પંચમહાલ',           3000),
  (23, 'Mahisagar',       'મહીસાગર',            800),
  (24, 'Dahod',           'દાહોદ',              500),
  (25, 'Vadodara',        'વડોદરા',           10000),
  (26, 'Chhota Udaipur',  'છોટા ઉદયપુર',        700),
  (27, 'Narmada',         'નર્મદા',            1200),
  (28, 'Bharuch',         'ભરુચ',              2500),
  (29, 'Surat',           'સુરત',             13500),
  (30, 'Dang',            'ડાંગ',              1800),
  (31, 'Navsari',         'નવસારી',            1300),
  (32, 'Valsad',          'વલસાડ',             1200),
  (33, 'Tapi',            'તાપી',              1500)
on conflict do nothing;

-- =====================================================================
-- AUTO RATE MASTER (DAVP ₹825 per rickshaw, 3 sides, 30 days)
-- Agency rate to be set by admin later (null for now)
-- =====================================================================
insert into public.auto_rate_master
  (size_rear, size_left, size_right,
   davp_per_rickshaw_rate, davp_source_reference, davp_is_locked,
   agency_per_rickshaw_rate,
   campaign_duration_days)
values (
  E'4\' × 3\'', E'2\' × 2\'', E'2\' × 2\'',
  825.00, 'DAVP Approved Rate', true,
  null,   -- Set by admin when commercial rate is decided
  30
);
