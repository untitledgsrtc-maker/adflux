-- =====================================================================
-- ADFLUX → UNTITLED OS  •  PHASE 5
-- Signers + share %s + GSRTC seed fix + proposal templates
-- =====================================================================
--
-- WHAT THIS DOES (six things in one file):
--
--   1. Extends users.role enum to add 'owner' and 'co_owner'.
--   2. Adds users.signing_authority boolean — flags users who can sign
--      proposals (Brijesh + Vishal).
--   3. Drops auto_districts.available_rickshaw_count (unused).
--      Adds auto_districts.share_pct — the % of total rickshaws each
--      district gets when distributing a campaign quantity. All 33 %s
--      sum to 100.
--   4. Fixes gsrtc_stations.monthly_spots values to match the actual
--      GSRTC rate sheet (100 daily × 30 days × screens). Old phase4c
--      values were wrong (800/1000/1500); replaced with correct values.
--   5. Creates proposal_templates table — letter bodies stored as data
--      with {{placeholder}} substitution. Owner can edit later via a
--      Settings page (Sprint 3+) without code changes.
--   6. Seeds two locked Gujarati templates: (GOVERNMENT, AUTO_HOOD)
--      and (GOVERNMENT, GSRTC_LED). Owner-approved hybrid wording from
--      30 Apr 2026 — re-reviewed by Mehulbhai before going to clients.
--   7. Updates RLS policies to treat 'owner' and 'co_owner' the same
--      as 'admin' (full access).
--
-- DECISIONS BEHIND THIS:
--   - Vishal = co_owner role; sees everything; can sign proposals.
--   - Brijesh stays admin for now; gets signing_authority = true.
--     (Future migration can promote him to 'owner' role.)
--   - share_pct values come from owner's distribution table 30 Apr 2026.
--     Sum verified at 100.00%.
--   - GSRTC station data corrected against the rate sheet Excel
--     (GSRTC RATEDATA SHEET.xlsx). Total monthly = ₹22,56,000 across
--     264 screens at GSRTC-DAVP rates (A=₹3, B=₹2.75, C=₹2.50).
--   - Letter text is locked but template-driven. Sprint 3+ adds an
--     admin Settings page so the owner can edit wording any time.
--
-- IDEMPOTENT.
-- STAGING ONLY for now. Do NOT run on production main yet.
-- =====================================================================


-- =====================================================================
-- 1. Extend users.role enum: add 'owner' and 'co_owner'
-- =====================================================================
ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'sales', 'owner', 'co_owner'));


-- =====================================================================
-- 2. Add users.signing_authority — flags users who can sign proposals
-- =====================================================================
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS signing_authority boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_users_signing_authority
  ON public.users (signing_authority)
  WHERE signing_authority = true;


-- =====================================================================
-- 3. auto_districts: drop available_rickshaw_count, add share_pct
-- =====================================================================
ALTER TABLE public.auto_districts
  DROP COLUMN IF EXISTS available_rickshaw_count;

ALTER TABLE public.auto_districts
  ADD COLUMN IF NOT EXISTS share_pct numeric(5,2);

-- Backfill the 33 % shares (sum = 100.00) from owner's distribution
-- table 30 Apr 2026
UPDATE public.auto_districts SET share_pct = 1.00  WHERE serial_no = 1;   -- Kutch
UPDATE public.auto_districts SET share_pct = 1.50  WHERE serial_no = 2;   -- Banaskantha
UPDATE public.auto_districts SET share_pct = 1.20  WHERE serial_no = 3;   -- Patan
UPDATE public.auto_districts SET share_pct = 1.50  WHERE serial_no = 4;   -- Mehsana
UPDATE public.auto_districts SET share_pct = 0.50  WHERE serial_no = 5;   -- Sabarkantha
UPDATE public.auto_districts SET share_pct = 0.30  WHERE serial_no = 6;   -- Aravalli
UPDATE public.auto_districts SET share_pct = 7.00  WHERE serial_no = 7;   -- Gandhinagar
UPDATE public.auto_districts SET share_pct = 20.00 WHERE serial_no = 8;   -- Ahmedabad
UPDATE public.auto_districts SET share_pct = 3.00  WHERE serial_no = 9;   -- Surendranagar
UPDATE public.auto_districts SET share_pct = 4.00  WHERE serial_no = 10;  -- Bhavnagar
UPDATE public.auto_districts SET share_pct = 0.50  WHERE serial_no = 11;  -- Botad
UPDATE public.auto_districts SET share_pct = 9.00  WHERE serial_no = 12;  -- Rajkot
UPDATE public.auto_districts SET share_pct = 1.50  WHERE serial_no = 13;  -- Morbi
UPDATE public.auto_districts SET share_pct = 1.50  WHERE serial_no = 14;  -- Jamnagar
UPDATE public.auto_districts SET share_pct = 0.20  WHERE serial_no = 15;  -- Devbhumi Dwarka
UPDATE public.auto_districts SET share_pct = 1.20  WHERE serial_no = 16;  -- Porbandar
UPDATE public.auto_districts SET share_pct = 1.90  WHERE serial_no = 17;  -- Junagadh
UPDATE public.auto_districts SET share_pct = 0.30  WHERE serial_no = 18;  -- Gir Somnath
UPDATE public.auto_districts SET share_pct = 1.60  WHERE serial_no = 19;  -- Amreli
UPDATE public.auto_districts SET share_pct = 5.00  WHERE serial_no = 20;  -- Anand
UPDATE public.auto_districts SET share_pct = 6.00  WHERE serial_no = 21;  -- Kheda
UPDATE public.auto_districts SET share_pct = 1.20  WHERE serial_no = 22;  -- Panchmahal
UPDATE public.auto_districts SET share_pct = 0.80  WHERE serial_no = 23;  -- Mahisagar
UPDATE public.auto_districts SET share_pct = 0.50  WHERE serial_no = 24;  -- Dahod
UPDATE public.auto_districts SET share_pct = 10.00 WHERE serial_no = 25;  -- Vadodara
UPDATE public.auto_districts SET share_pct = 0.40  WHERE serial_no = 26;  -- Chhota Udaipur
UPDATE public.auto_districts SET share_pct = 0.50  WHERE serial_no = 27;  -- Narmada
UPDATE public.auto_districts SET share_pct = 1.00  WHERE serial_no = 28;  -- Bharuch
UPDATE public.auto_districts SET share_pct = 15.00 WHERE serial_no = 29;  -- Surat
UPDATE public.auto_districts SET share_pct = 0.20  WHERE serial_no = 30;  -- Dang
UPDATE public.auto_districts SET share_pct = 0.50  WHERE serial_no = 31;  -- Navsari
UPDATE public.auto_districts SET share_pct = 0.70  WHERE serial_no = 32;  -- Valsad
UPDATE public.auto_districts SET share_pct = 0.50  WHERE serial_no = 33;  -- Tapi

-- Lock NOT NULL after backfill + add CHECK that share_pct is positive
ALTER TABLE public.auto_districts
  ALTER COLUMN share_pct SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'auto_districts_share_pct_check'
  ) THEN
    ALTER TABLE public.auto_districts
      ADD CONSTRAINT auto_districts_share_pct_check
      CHECK (share_pct >= 0 AND share_pct <= 100);
  END IF;
END $$;


-- =====================================================================
-- 4. gsrtc_stations: fix monthly_spots seed values
-- =====================================================================
-- Per the GSRTC rate sheet:
--   monthly_spots = daily_spots × screens × days_per_month
--                 = 100 × screens × 30
--                 = 3000 × screens
-- Owner verified the resulting monthly totals match the Excel rate
-- sheet (₹22,56,000 across 264 screens).
-- =====================================================================
UPDATE public.gsrtc_stations SET monthly_spots = 3000 * screens_count
WHERE TRUE;


-- =====================================================================
-- 5. proposal_templates table — letter bodies stored as editable data
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.proposal_templates (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  segment         text NOT NULL CHECK (segment IN ('GOVERNMENT', 'PRIVATE')),
  media_type      text NOT NULL,
  language        text NOT NULL DEFAULT 'gu' CHECK (language IN ('gu', 'en')),
  subject_line    text NOT NULL,
  body_html       text NOT NULL,
  placeholders    text[] NOT NULL DEFAULT ARRAY[]::text[],
  is_active       boolean NOT NULL DEFAULT true,
  effective_from  date NOT NULL DEFAULT CURRENT_DATE,
  effective_to    date,
  notes           text,
  updated_by      uuid REFERENCES public.users (id),
  updated_at      timestamptz DEFAULT now(),
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proposal_templates_active
  ON public.proposal_templates (segment, media_type, language)
  WHERE is_active = true AND effective_to IS NULL;

DROP TRIGGER IF EXISTS proposal_templates_updated_at ON public.proposal_templates;
CREATE TRIGGER proposal_templates_updated_at
  BEFORE UPDATE ON public.proposal_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


-- =====================================================================
-- 6. Seed locked Gujarati templates
-- =====================================================================

-- 6a. AUTO_HOOD (Government)
INSERT INTO public.proposal_templates
  (segment, media_type, language, subject_line, body_html, placeholders, notes)
SELECT
  'GOVERNMENT', 'AUTO_HOOD', 'gu',
  E'ગુજરાત રાજ્યના સમગ્ર પ્રદેશમાં ઓટો રિક્ષા હૂડ પર આપશ્રીના વિભાગની યોજનાઓ/સંદેશાઓના પ્રચાર-પ્રસાર બાબત — DAVP-મંજૂર દરોએ કાર્યાદેશ આપવા અંગે.',
  E'<p>માનનીય સાહેબશ્રી,</p>\n\n<p>ગુજરાત સરકારની વિવિધ કલ્યાણકારી યોજનાઓ તથા જનજાગૃતિ સંદેશાઓના વ્યાપક પ્રચાર માટે આઉટડોર માધ્યમો વિશેષરૂપે ઉપયુક્ત ઠરે છે. અમે અનટાઇટલ્ડ એડવર્ટાઇઝિંગ — વડોદરા સ્થિત તથા ગુજરાતભરમાં બાર (૧૨) વર્ષનો અનુભવ ધરાવતી જાહેરાત એજન્સી — આપશ્રીના વિભાગ માટે ઓટો રિક્ષા હૂડ માધ્યમ દ્વારા આ સંદેશાઓને જનતા સુધી પહોંચાડવા તત્પર છીએ.</p>\n\n<p>ઓટો રિક્ષા હૂડ પરની જાહેરાત શહેર અને ગ્રામીણ બંને વિસ્તારોમાં દિવસભર ગતિશીલ રહે છે, જેના કારણે દરેક નાગરિકની નજરે અનેકવાર પડે છે. છેવાડાના નાગરિક સુધી પહોંચવાની ક્ષમતા સાથે, અન્ય માધ્યમોની તુલનામાં તે અત્યંત વ્યાજબી અને અસરકારક માધ્યમ છે.</p>\n\n<p><strong>ઓટો રિક્ષાના હૂડ પર જાહેરાત માટેનું વિગતવાર ખર્ચ વિભાજન &lt;DAVP-મંજૂર દરો અનુસાર&gt;:</strong></p>\n\n{{rate_table}}\n\n<p>ઉપર પ્રમાણેના દરોમાં {{districts_count}} જિલ્લાની ઓટો રિક્ષાઓનો સમાવેશ કરવામાં આવેલ છે; જિલ્લાવાર વિભાજન સાથે જોડેલ યાદીમાં દર્શાવેલ છે.</p>\n\n<p>આપના સહયોગની અપેક્ષા સહ,<br/>આભાર.</p>\n\n{{signer_block}}',
  ARRAY['recipient', 'date', 'quantity', 'rate_table', 'districts_count', 'signer_block'],
  E'Locked hybrid wording — owner-approved 30 Apr 2026. Get re-reviewed by Mehulbhai before sending to govt clients.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.proposal_templates
   WHERE segment = 'GOVERNMENT' AND media_type = 'AUTO_HOOD' AND language = 'gu' AND is_active = true
);


-- 6b. GSRTC_LED (Government)
INSERT INTO public.proposal_templates
  (segment, media_type, language, subject_line, body_html, placeholders, notes)
SELECT
  'GOVERNMENT', 'GSRTC_LED', 'gu',
  E'ગુજરાતના GSRTC બસ ડેપો પ્લેટફોર્મ પર AI-આધારિત ૫૫-ઈંચ LED ડિસ્પ્લે મારફતે આપશ્રીના વિભાગની સરકારી યોજનાઓ/સંદેશાઓ પ્રદર્શિત કરવા બાબતની દરખાસ્ત — GSRTC-નિર્ધારિત દરો અનુસાર.',
  E'<p>માનનીય સાહેબશ્રી,</p>\n\n<p>અમે અનટાઇટલ્ડ એડવર્ટાઇઝિંગ — વડોદરા સ્થિત તથા ગુજરાતભરમાં જાહેરાત પ્રદર્શિત કરતી અગ્રણી એજન્સી — ગુજરાત સરકારના વિવિધ વિભાગો સાથે જાહેરાત ક્ષેત્રે નવ (૯) વર્ષનો બહોળો અનુભવ ધરાવીએ છીએ.</p>\n\n<p>GSRTC દ્વારા આપવામાં આવેલ ટેન્ડર અંતર્ગત, અમે ગુજરાતના ૨૦ પ્રમુખ બસ ડેપો પ્લેટફોર્મ પર ૫૫-ઈંચ AI-આધારિત LED સ્ક્રીનની સંપૂર્ણ સ્થાપના અને કાર્યરત સંચાલન સફળતાપૂર્વક પૂર્ણ કરેલ છે. આ સ્ક્રીનો બસની રાહ જોતા હજારો યાત્રીઓના સીધા દૃષ્ટિક્ષેત્રમાં પ્રતિદિન ૧૪ કલાક સક્રિય રહે છે.</p>\n\n<p><strong>આપશ્રીના વિભાગ માટે અમે અમારી AI-આધારિત અત્યાધુનિક LED ડિસ્પ્લે સિસ્ટમ — જે નીચે મુજબની વિશિષ્ટ સુવિધાઓ પૂરી પાડે છે — ઉપલબ્ધ કરાવવા તત્પર છીએ:</strong></p>\n\n<ul>\n<li>ઉચ્ચ રીઝોલ્યુશન આઉટડોર LED સ્ક્રીન (૫૫ ઈંચ)</li>\n<li>રીમોટ કન્ટેન્ટ મેનેજમેન્ટ — એક જ જગ્યાએથી સંપૂર્ણ ૨૦ જિલ્લામાં કન્ટેન્ટ બદલી શકાય</li>\n<li>AI-આધારિત ઓડિયન્સ એનાલિટિક્સ:\n<ul>\n<li>દરરોજ કેટલા લોકોએ આપની જાહેરાત/સંદેશ જોયા તેની ચોક્કસ ગણતરી</li>\n<li>ઉંમર, જાતિ, સમયગાળા મુજબ વિગતવાર રિપોર્ટ</li>\n<li>માસિક/સાપ્તાહિક PDF રિપોર્ટ</li>\n</ul>\n</li>\n</ul>\n\n{{rate_table}}\n\n<p>આ કામગીરી માટે અમને સીધો કાર્યાદેશ આપવામાં આવે અથવા આવનારા મીડિયા પ્લાનમાં અમારી સેવાઓ સામેલ કરવા આપશ્રીને નમ્ર વિનંતી છે.</p>\n\n<p>આપના સહયોગની અપેક્ષા સહ,<br/>આભાર.</p>\n\n<p><strong>બિડાણ:</strong><br/>* GSRTC તરફથી મળેલ ભાવ પત્રક<br/>* અમારા તરફથી કરેલ ભાવ દરખાસ્ત ની નકલ<br/>* ૨૦ ડેપો મથકનું લિસ્ટ</p>\n\n{{signer_block}}',
  ARRAY['recipient', 'date', 'months', 'selected_stations', 'rate_table', 'signer_block'],
  E'Locked hybrid wording — owner-approved 30 Apr 2026. Get re-reviewed by Mehulbhai before sending to govt clients.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.proposal_templates
   WHERE segment = 'GOVERNMENT' AND media_type = 'GSRTC_LED' AND language = 'gu' AND is_active = true
);


-- =====================================================================
-- 7. RLS — proposal_templates (admin/owner/co_owner read-write,
--    everyone else read-only)
-- =====================================================================
ALTER TABLE public.proposal_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pt_read_all       ON public.proposal_templates;
CREATE POLICY pt_read_all       ON public.proposal_templates
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS pt_admin_write    ON public.proposal_templates;
CREATE POLICY pt_admin_write    ON public.proposal_templates
  FOR ALL USING (public.get_my_role() IN ('admin', 'owner', 'co_owner'));


-- =====================================================================
-- 8. RLS updates — extend admin checks to include 'owner' + 'co_owner'
-- =====================================================================
-- Existing policies check `get_my_role() = 'admin'`. We extend them to
-- include 'owner' and 'co_owner' as full-access roles.

-- USERS
DROP POLICY IF EXISTS users_admin_write ON public.users;
CREATE POLICY users_admin_write ON public.users
  FOR ALL USING (public.get_my_role() IN ('admin', 'owner', 'co_owner'));

-- CITIES
DROP POLICY IF EXISTS cities_admin_write ON public.cities;
CREATE POLICY cities_admin_write ON public.cities
  FOR ALL USING (public.get_my_role() IN ('admin', 'owner', 'co_owner'));

-- QUOTES
DROP POLICY IF EXISTS quotes_admin_all ON public.quotes;
CREATE POLICY quotes_admin_all ON public.quotes
  FOR ALL USING (public.get_my_role() IN ('admin', 'owner', 'co_owner'));

-- QUOTE_CITIES
DROP POLICY IF EXISTS qc_admin_all ON public.quote_cities;
CREATE POLICY qc_admin_all ON public.quote_cities
  FOR ALL USING (public.get_my_role() IN ('admin', 'owner', 'co_owner'));

-- PAYMENTS
DROP POLICY IF EXISTS payments_admin_all ON public.payments;
CREATE POLICY payments_admin_all ON public.payments
  FOR ALL USING (public.get_my_role() IN ('admin', 'owner', 'co_owner'));

-- STAFF INCENTIVE PROFILES
DROP POLICY IF EXISTS sip_admin_all ON public.staff_incentive_profiles;
CREATE POLICY sip_admin_all ON public.staff_incentive_profiles
  FOR ALL USING (public.get_my_role() IN ('admin', 'owner', 'co_owner'));

-- MONTHLY SALES DATA
DROP POLICY IF EXISTS msd_admin_all ON public.monthly_sales_data;
CREATE POLICY msd_admin_all ON public.monthly_sales_data
  FOR ALL USING (public.get_my_role() IN ('admin', 'owner', 'co_owner'));

-- FOLLOW UPS
DROP POLICY IF EXISTS fu_admin_all ON public.follow_ups;
CREATE POLICY fu_admin_all ON public.follow_ups
  FOR ALL USING (public.get_my_role() IN ('admin', 'owner', 'co_owner'));

-- INCENTIVE SETTINGS
DROP POLICY IF EXISTS is_admin_all ON public.incentive_settings;
CREATE POLICY is_admin_all ON public.incentive_settings
  FOR ALL USING (public.get_my_role() IN ('admin', 'owner', 'co_owner'));

-- AUTO DISTRICTS
DROP POLICY IF EXISTS auto_districts_admin_write ON public.auto_districts;
CREATE POLICY auto_districts_admin_write ON public.auto_districts
  FOR ALL USING (public.get_my_role() IN ('admin', 'owner', 'co_owner'));

-- GSRTC STATIONS
DROP POLICY IF EXISTS gsrtc_stations_admin_write ON public.gsrtc_stations;
CREATE POLICY gsrtc_stations_admin_write ON public.gsrtc_stations
  FOR ALL USING (public.get_my_role() IN ('admin', 'owner', 'co_owner'));

-- AUTO RATE MASTER
DROP POLICY IF EXISTS auto_rate_master_admin_write ON public.auto_rate_master;
CREATE POLICY auto_rate_master_admin_write ON public.auto_rate_master
  FOR ALL USING (public.get_my_role() IN ('admin', 'owner', 'co_owner'));

-- MEDIA SEGMENT VALIDITY
DROP POLICY IF EXISTS msv_admin_write ON public.media_segment_validity;
CREATE POLICY msv_admin_write ON public.media_segment_validity
  FOR ALL USING (public.get_my_role() IN ('admin', 'owner', 'co_owner'));


-- =====================================================================
-- 9. Mark existing admin user(s) as signers (Brijesh)
-- =====================================================================
-- Backfill signing_authority = true for all current admin users.
-- This catches both 'Brijesh / os@untitledad.in' and the new
-- 'Brijesh Solanki (Staging)' user from the seed_test_users file.
UPDATE public.users
   SET signing_authority = true
 WHERE role = 'admin'
   AND signing_authority = false;


-- =====================================================================
-- VERIFY (run each block separately):
--
-- 1. share_pct sums to 100
--    SELECT SUM(share_pct) AS total_pct FROM public.auto_districts;
--    -- expect: 100.00
--
-- 2. GSRTC monthly totals sum to ~₹22,56,000
--    SELECT SUM(monthly_spots * davp_per_slot_rate) AS total_monthly_inr
--      FROM public.gsrtc_stations WHERE is_active = true;
--    -- expect: 2256000
--
-- 3. Templates seeded
--    SELECT segment, media_type, language, length(body_html) AS body_chars
--      FROM public.proposal_templates ORDER BY 1, 2;
--    -- expect 2 rows: GOVERNMENT/AUTO_HOOD and GOVERNMENT/GSRTC_LED
--
-- 4. Role enum extended
--    SELECT DISTINCT role FROM public.users ORDER BY 1;
--
-- 5. Brijesh marked as signer
--    SELECT name, email, role, signing_authority FROM public.users
--     WHERE role = 'admin' OR signing_authority = true;
--
-- =====================================================================
