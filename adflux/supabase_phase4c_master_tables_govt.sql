-- =====================================================================
-- ADFLUX → UNTITLED OS  •  PHASE 4C
-- Migration: Government media master tables + seed data
-- =====================================================================
--
-- WHAT THIS DOES:
--   1. Creates 4 master tables for Government segment workflow:
--        • auto_districts          — 33 Gujarat districts (rickshaw counts)
--        • gsrtc_stations          — 20 GSRTC bus-station LED locations
--        • auto_rate_master        — Auto Hood DAVP + Agency rates
--        • media_segment_validity  — config: which (segment, media) pairs allowed
--   2. Seeds all four with the data ported from Untitled Proposals
--      migrations 002 + 007 (reviewed and approved by owner).
--   3. RLS: read-all-authenticated, admin-write (same pattern as cities).
--
-- DECISIONS BEHIND THIS:
--   - Adapted from Untitled Proposals migrations 002 + 007. Differences:
--       * Used CHECK constraints instead of Postgres enums (matches
--         AdFlux convention — see phase4a quotes.rate_type).
--       * Did NOT port the `media_types` table — redundant given the
--         media_type CHECK constraint already on quotes (phase4a).
--       * Added `media_segment_validity` config table (new for merged
--         system — single source of truth for allowed combinations).
--       * Trigger uses existing AdFlux `update_updated_at()` function.
--   - Government locked to AUTO_HOOD + GSRTC_LED only. The
--     media_segment_validity rows reflect this.
--
-- WHAT THIS DOES *NOT* TOUCH:
--   - quotes table (phase4a already added the columns)
--   - users table (phase4b already added segment_access)
--   - Reference number generator (phase4d)
--   - RLS on quotes/payments (phase4e)
--
-- IDEMPOTENT: re-running is safe.
-- =====================================================================


-- =====================================================================
-- 1. AUTO_DISTRICTS  — 33 districts of Gujarat with rickshaw counts
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.auto_districts (
  id                        uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  serial_no                 int NOT NULL,
  district_name_en          text NOT NULL,
  district_name_gu          text NOT NULL,
  available_rickshaw_count  int NOT NULL,
  is_active                 boolean DEFAULT true,
  notes                     text,
  created_at                timestamptz DEFAULT now(),
  updated_at                timestamptz DEFAULT now(),
  UNIQUE (serial_no)
);

CREATE INDEX IF NOT EXISTS idx_districts_active
  ON public.auto_districts (is_active, serial_no);

DROP TRIGGER IF EXISTS auto_districts_updated_at ON public.auto_districts;
CREATE TRIGGER auto_districts_updated_at
  BEFORE UPDATE ON public.auto_districts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


-- Seed 33 districts -------------------------------------------------
INSERT INTO public.auto_districts
  (serial_no, district_name_en, district_name_gu, available_rickshaw_count)
VALUES
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
ON CONFLICT (serial_no) DO NOTHING;


-- =====================================================================
-- 2. GSRTC_STATIONS  — 20 GSRTC bus-station LED locations
-- =====================================================================
-- Rates (per Untitled Proposals seed):
--   Category A: ₹3.00/slot DAVP, ₹850/mo Agency, 1500 monthly spots
--   Category B: ₹2.75/slot DAVP, ₹650/mo Agency, 800 monthly spots (Botad: 1000)
--   Category C: ₹2.50/slot DAVP, ₹650/mo Agency, 800 monthly spots
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.gsrtc_stations (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  serial_no             int NOT NULL,
  station_name_en       text NOT NULL,
  station_name_gu       text NOT NULL,
  category              text NOT NULL CHECK (category IN ('A', 'B', 'C')),
  screens_count         int NOT NULL,
  daily_spots           int NOT NULL DEFAULT 100,
  spot_duration_sec     int NOT NULL DEFAULT 10,
  monthly_spots         int NOT NULL,
  loop_time_min         int NOT NULL DEFAULT 5,
  days_per_month        int NOT NULL DEFAULT 30,
  -- DAVP rates
  davp_per_slot_rate    numeric(10,2) NOT NULL,
  davp_monthly_total    numeric(12,2) GENERATED ALWAYS AS (monthly_spots * davp_per_slot_rate) STORED,
  -- Agency rates
  agency_monthly_rate   numeric(12,2),
  agency_rack_rate      numeric(12,2),
  image_url             text,
  is_active             boolean DEFAULT true,
  effective_from        date NOT NULL DEFAULT CURRENT_DATE,
  effective_to          date,
  notes                 text,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now(),
  UNIQUE (serial_no)
);

CREATE INDEX IF NOT EXISTS idx_gsrtc_active   ON public.gsrtc_stations (is_active, serial_no);
CREATE INDEX IF NOT EXISTS idx_gsrtc_category ON public.gsrtc_stations (category);

DROP TRIGGER IF EXISTS gsrtc_stations_updated_at ON public.gsrtc_stations;
CREATE TRIGGER gsrtc_stations_updated_at
  BEFORE UPDATE ON public.gsrtc_stations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


-- Seed 20 stations --------------------------------------------------
INSERT INTO public.gsrtc_stations
  (serial_no, station_name_en, station_name_gu, category, screens_count,
   monthly_spots, davp_per_slot_rate, agency_monthly_rate, agency_rack_rate)
VALUES
  (1,  'Anand (New)',     'આણંદ (Anand New)',  'B', 20, 800,  2.75, 650, 1800),
  (2,  'Kheda',            'ખેડા (Kheda)',       'C', 10, 800,  2.50, 650, 1800),
  (3,  'Gandhinagar',      'ગાંધીનગર',           'A', 20, 1500, 3.00, 850, 2250),
  (4,  'Himmatnagar',      'હિંમતનગર',           'A', 20, 1500, 3.00, 850, 2250),
  (5,  'Dahod',            'દાહોદ',              'B', 10, 800,  2.75, 650, 1800),
  (6,  'Godhra',           'ગોધરા',              'A', 10, 1500, 3.00, 850, 2250),
  (7,  'Ankleshwar GIDC',  'અંકલેશ્વર GIDC',     'B', 10, 800,  2.75, 650, 1800),
  (8,  'Surat (City)',     'સુરત (સિટી)',        'A', 20, 1500, 3.00, 850, 2250),
  (9,  'Valsad',           'વલસાડ',              'A', 14, 1500, 3.00, 850, 2250),
  (10, 'Chikhli',          'ચિખલી',              'B', 10, 800,  2.75, 650, 1800),
  (11, 'Botad',            'બોટાદ',              'B', 10, 1000, 2.75, 650, 1800),
  (12, 'Bhavnagar',        'ભાવનગર',             'A', 15, 1500, 3.00, 850, 2250),
  (13, 'Veraval',          'વેરાવળ',             'C', 10, 800,  2.50, 650, 1800),
  (14, 'Junagadh',         'જુનાગઢ',             'A', 15, 1500, 3.00, 850, 2250),
  (15, 'Porbandar',        'પોરબંદર',            'B', 10, 800,  2.75, 650, 1800),
  (16, 'Dwarka',           'દ્વારકા',            'B', 10, 800,  2.75, 650, 1800),
  (17, 'Jamnagar',         'જામનગર',             'A', 10, 1500, 3.00, 850, 2250),
  (18, 'Morbi',            'મોરબી',              'B', 15, 800,  2.75, 650, 1800),
  (19, 'Bhachau',          'ભચાઉ',               'B', 10, 800,  2.75, 650, 1800),
  (20, 'Surendranagar',    'સુરેન્દ્રનગર',       'B', 15, 800,  2.75, 650, 1800)
ON CONFLICT (serial_no) DO NOTHING;


-- =====================================================================
-- 3. AUTO_RATE_MASTER  — Auto Hood DAVP-locked rate (₹825 per rickshaw)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.auto_rate_master (
  id                          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  size_rear                   text NOT NULL DEFAULT E'4\' × 3\'',
  size_left                   text NOT NULL DEFAULT E'2\' × 2\'',
  size_right                  text NOT NULL DEFAULT E'2\' × 2\'',
  -- DAVP
  davp_per_rickshaw_rate      numeric(10,2) NOT NULL,
  davp_source_reference       text,
  davp_is_locked              boolean DEFAULT true,
  -- Agency
  agency_per_rickshaw_rate    numeric(10,2),
  campaign_duration_days      int NOT NULL DEFAULT 30,
  effective_from              date NOT NULL DEFAULT CURRENT_DATE,
  effective_to                date,
  updated_by                  uuid REFERENCES public.users (id),
  update_reason               text,
  created_at                  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auto_rate_effective
  ON public.auto_rate_master (effective_from DESC)
  WHERE effective_to IS NULL;


-- Seed the active rate (₹825 DAVP-approved per rickshaw, 3 sides) ----
INSERT INTO public.auto_rate_master
  (size_rear, size_left, size_right,
   davp_per_rickshaw_rate, davp_source_reference, davp_is_locked,
   agency_per_rickshaw_rate, campaign_duration_days)
SELECT
  E'4\' × 3\'', E'2\' × 2\'', E'2\' × 2\'',
  825.00, 'DAVP Approved Rate', true,
  NULL, 30
WHERE NOT EXISTS (
  SELECT 1 FROM public.auto_rate_master WHERE effective_to IS NULL
);


-- =====================================================================
-- 4. MEDIA_SEGMENT_VALIDITY  — config: allowed (segment, media) pairs
-- =====================================================================
-- Single source of truth for what combinations the wizard allows.
-- Owner can adjust later by toggling is_allowed without code changes.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.media_segment_validity (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  segment         text NOT NULL CHECK (segment IN ('GOVERNMENT', 'PRIVATE')),
  media_type      text NOT NULL,
  is_allowed      boolean NOT NULL DEFAULT true,
  default_rate_type text NOT NULL CHECK (default_rate_type IN ('DAVP', 'AGENCY')),
  display_order   int NOT NULL,
  notes           text,
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (segment, media_type)
);

CREATE INDEX IF NOT EXISTS idx_msv_segment_allowed
  ON public.media_segment_validity (segment, is_allowed, display_order);


-- Seed the validity matrix (per architecture v2 §2.3) ---------------
INSERT INTO public.media_segment_validity
  (segment, media_type, is_allowed, default_rate_type, display_order, notes)
VALUES
  -- Government: locked to Auto Hood + GSRTC LED only
  ('GOVERNMENT', 'AUTO_HOOD',  true,  'DAVP',   1, 'Cash cow: ₹7-8 Cr/yr DAVP empanelment'),
  ('GOVERNMENT', 'GSRTC_LED',  true,  'DAVP',   2, 'Empanelment pipeline'),
  ('GOVERNMENT', 'LED_OTHER',  false, 'DAVP',  90, 'NOT ALLOWED — owner decision 30 Apr 2026'),
  ('GOVERNMENT', 'HOARDING',   false, 'DAVP',  91, 'NOT ALLOWED — owner decision 30 Apr 2026'),
  ('GOVERNMENT', 'MALL',       false, 'DAVP',  92, 'NOT ALLOWED — owner decision 30 Apr 2026'),
  ('GOVERNMENT', 'CINEMA',     false, 'DAVP',  93, 'NOT ALLOWED — owner decision 30 Apr 2026'),
  ('GOVERNMENT', 'DIGITAL',    false, 'DAVP',  94, 'NOT ALLOWED — owner decision 30 Apr 2026'),
  ('GOVERNMENT', 'OTHER',      false, 'DAVP',  95, 'NOT ALLOWED — owner decision 30 Apr 2026'),
  -- Private: most media types allowed
  ('PRIVATE',    'LED_OTHER',  true,  'AGENCY', 1, 'AdFlux today: ₹1.2 Cr/yr private LED'),
  ('PRIVATE',    'GSRTC_LED',  true,  'AGENCY', 2, 'Sleeping giant — 80%+ slots empty'),
  ('PRIVATE',    'AUTO_HOOD',  true,  'AGENCY', 3, 'Rare — allow but not promoted'),
  ('PRIVATE',    'HOARDING',   true,  'AGENCY', 4, 'Supplementary'),
  ('PRIVATE',    'MALL',       true,  'AGENCY', 5, 'Supplementary'),
  ('PRIVATE',    'CINEMA',     true,  'AGENCY', 6, 'Supplementary'),
  ('PRIVATE',    'DIGITAL',    true,  'AGENCY', 7, 'Supplementary'),
  ('PRIVATE',    'OTHER',      true,  'AGENCY', 8, 'Catch-all')
ON CONFLICT (segment, media_type) DO NOTHING;


-- =====================================================================
-- 5. RLS — read-all-authenticated, admin-write (same as cities table)
-- =====================================================================
ALTER TABLE public.auto_districts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gsrtc_stations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_rate_master        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_segment_validity  ENABLE ROW LEVEL SECURITY;

-- auto_districts
DROP POLICY IF EXISTS auto_districts_read_all     ON public.auto_districts;
CREATE POLICY auto_districts_read_all     ON public.auto_districts
  FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS auto_districts_admin_write  ON public.auto_districts;
CREATE POLICY auto_districts_admin_write  ON public.auto_districts
  FOR ALL USING (public.get_my_role() = 'admin');

-- gsrtc_stations
DROP POLICY IF EXISTS gsrtc_stations_read_all     ON public.gsrtc_stations;
CREATE POLICY gsrtc_stations_read_all     ON public.gsrtc_stations
  FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS gsrtc_stations_admin_write  ON public.gsrtc_stations;
CREATE POLICY gsrtc_stations_admin_write  ON public.gsrtc_stations
  FOR ALL USING (public.get_my_role() = 'admin');

-- auto_rate_master
DROP POLICY IF EXISTS auto_rate_master_read_all   ON public.auto_rate_master;
CREATE POLICY auto_rate_master_read_all   ON public.auto_rate_master
  FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS auto_rate_master_admin_write ON public.auto_rate_master;
CREATE POLICY auto_rate_master_admin_write ON public.auto_rate_master
  FOR ALL USING (public.get_my_role() = 'admin');

-- media_segment_validity
DROP POLICY IF EXISTS msv_read_all                 ON public.media_segment_validity;
CREATE POLICY msv_read_all                ON public.media_segment_validity
  FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS msv_admin_write              ON public.media_segment_validity;
CREATE POLICY msv_admin_write             ON public.media_segment_validity
  FOR ALL USING (public.get_my_role() = 'admin');


-- =====================================================================
-- VERIFY:
--
--   SELECT 'auto_districts'  AS t, COUNT(*) FROM public.auto_districts
--   UNION ALL
--   SELECT 'gsrtc_stations',     COUNT(*) FROM public.gsrtc_stations
--   UNION ALL
--   SELECT 'auto_rate_master',   COUNT(*) FROM public.auto_rate_master
--   UNION ALL
--   SELECT 'media_seg_validity', COUNT(*) FROM public.media_segment_validity;
--
-- Expected:
--   auto_districts        | 33
--   gsrtc_stations        | 20
--   auto_rate_master      | 1
--   media_seg_validity    | 16
--
-- =====================================================================
