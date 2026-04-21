-- =====================================================
-- UNTITLED ADFLUX — COMPLETE SUPABASE SCHEMA (v2, fresh)
-- =====================================================
--
-- This is ONE file. Run it once in a brand new Supabase project's
-- SQL Editor. It creates everything: tables, triggers, RLS policies,
-- and turns on realtime for the dashboard.
--
-- AFTER you run this, go to the DEPLOY_GUIDE.md (Section 3, Step 4)
-- to seed your admin user. That seed step is a SEPARATE SQL snippet
-- — it's NOT in this file because it needs the UUID that Supabase
-- Auth generates when you create your admin login.
-- =====================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- TABLES
-- =====================================================

CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name              text NOT NULL,
  email             text UNIQUE NOT NULL,
  role              text NOT NULL CHECK (role IN ('admin', 'sales')),
  is_active         boolean DEFAULT true,
  created_at        timestamptz DEFAULT now()
);

CREATE TABLE cities (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name              text NOT NULL,
  station_name      text,
  grade             text CHECK (grade IN ('A', 'B', 'C')),
  screens           integer DEFAULT 1,
  screen_size_inch  integer,
  monthly_rate      numeric DEFAULT 0,
  offer_rate        numeric DEFAULT 0,
  impressions_day   integer DEFAULT 0,
  impressions_month integer DEFAULT 0,
  unique_viewers    integer DEFAULT 0,
  photo_url         text,
  is_active         boolean DEFAULT true,
  created_at        timestamptz DEFAULT now()
);

CREATE TABLE quotes (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  quote_number          text UNIQUE NOT NULL,
  client_name           text NOT NULL,
  client_company        text,
  client_phone          text,
  client_email          text,
  client_gst            text,
  client_address        text,
  client_notes          text,
  duration_months       integer DEFAULT 1,
  duration_mult         numeric DEFAULT 1,
  subtotal              numeric DEFAULT 0,
  gst_amount            numeric DEFAULT 0,
  total_amount          numeric DEFAULT 0,
  revenue_type          text DEFAULT 'new' CHECK (revenue_type IN ('new', 'renewal')),
  status                text DEFAULT 'draft' CHECK (status IN ('draft','sent','negotiating','won','lost')),
  created_by            uuid REFERENCES users(id),
  sales_person_name     text,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now(),
  follow_up_date        date,
  follow_up_done        boolean DEFAULT false,
  campaign_start_date   date,
  campaign_end_date     date
);

CREATE TABLE quote_cities (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  quote_id          uuid REFERENCES quotes(id) ON DELETE CASCADE,
  city_id           uuid REFERENCES cities(id),
  city_name         text NOT NULL,
  screens           integer DEFAULT 1,
  grade             text,
  listed_rate       numeric DEFAULT 0,
  offered_rate      numeric DEFAULT 0,
  override_reason   text,
  campaign_total    numeric DEFAULT 0,
  duration_months   integer DEFAULT 1
);

CREATE TABLE payments (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  quote_id          uuid REFERENCES quotes(id) ON DELETE CASCADE,
  amount_received   numeric NOT NULL,
  payment_mode      text CHECK (payment_mode IN ('NEFT','RTGS','UPI','Cheque','Cash')),
  payment_date      date DEFAULT CURRENT_DATE,
  reference_number  text,
  payment_notes     text,
  received_by       uuid REFERENCES users(id),
  is_final_payment  boolean DEFAULT false,
  created_at        timestamptz DEFAULT now()
);

CREATE TABLE staff_incentive_profiles (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               uuid UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  monthly_salary        numeric DEFAULT 0,
  sales_multiplier      numeric DEFAULT 5,
  new_client_rate       numeric DEFAULT 0.05,
  renewal_rate          numeric DEFAULT 0.02,
  flat_bonus            numeric DEFAULT 10000,
  join_date             date DEFAULT CURRENT_DATE,
  last_increment_date   date,
  is_active             boolean DEFAULT true
);

CREATE TABLE monthly_sales_data (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_id              uuid REFERENCES users(id) ON DELETE CASCADE,
  month_year            text NOT NULL,
  new_client_revenue    numeric DEFAULT 0,
  renewal_revenue       numeric DEFAULT 0,
  updated_at            timestamptz DEFAULT now(),
  UNIQUE(staff_id, month_year)
);

CREATE TABLE follow_ups (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  quote_id          uuid REFERENCES quotes(id) ON DELETE CASCADE,
  assigned_to       uuid REFERENCES users(id),
  follow_up_date    date NOT NULL,
  note              text,
  is_done           boolean DEFAULT false,
  done_at           timestamptz,
  created_at        timestamptz DEFAULT now()
);

CREATE TABLE incentive_settings (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  default_multiplier    numeric DEFAULT 5,
  new_client_rate       numeric DEFAULT 0.05,
  renewal_rate          numeric DEFAULT 0.02,
  default_flat_bonus    numeric DEFAULT 10000,
  updated_at            timestamptz DEFAULT now()
);

-- Seed the single global incentive settings row
INSERT INTO incentive_settings (id) VALUES (uuid_generate_v4());

-- =====================================================
-- FUNCTIONS & TRIGGERS
-- =====================================================

-- 1. updated_at bookkeeping for quotes
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER quotes_updated_at
  BEFORE UPDATE ON quotes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 2. Quote number generator — HARDENED
--    • Uses MAX(sequence)+1 so deleted rows don't collide
--    • Serialises inserts to avoid duplicate numbers under load
--    • ALWAYS overrides whatever the client sent — stops junk like
--      UA-2026-326788 from slipping in.
CREATE OR REPLACE FUNCTION generate_quote_number()
RETURNS TRIGGER AS $$
DECLARE
  year_str text;
  next_seq integer;
BEGIN
  year_str := to_char(now(), 'YYYY');

  LOCK TABLE quotes IN SHARE ROW EXCLUSIVE MODE;

  SELECT COALESCE(
           MAX(
             NULLIF(
               regexp_replace(quote_number, '^UA-' || year_str || '-', ''),
               ''
             )::int
           ),
           0
         ) + 1
    INTO next_seq
    FROM quotes
   WHERE quote_number ~ ('^UA-' || year_str || '-[0-9]+$');

  NEW.quote_number := 'UA-' || year_str || '-' || LPAD(next_seq::text, 4, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER quotes_quote_number
  BEFORE INSERT ON quotes
  FOR EACH ROW
  EXECUTE FUNCTION generate_quote_number();

-- 3. Auto-create a follow-up when a quote flips to "sent"
CREATE OR REPLACE FUNCTION auto_create_followup()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'sent' AND (OLD.status IS NULL OR OLD.status != 'sent') THEN
    INSERT INTO follow_ups (quote_id, assigned_to, follow_up_date, note)
    VALUES (
      NEW.id,
      NEW.created_by,
      (now() + INTERVAL '3 days')::date,
      'Auto follow-up after quote sent'
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER quotes_auto_followup
  AFTER INSERT OR UPDATE OF status ON quotes
  FOR EACH ROW EXECUTE FUNCTION auto_create_followup();

-- 4. When a final payment arrives, credit the sales person's
--    monthly_sales_data for that month
CREATE OR REPLACE FUNCTION handle_final_payment()
RETURNS TRIGGER AS $$
DECLARE
  quote_rec quotes%ROWTYPE;
  month_str text;
  rev_type text;
BEGIN
  IF NEW.is_final_payment = true AND (OLD.is_final_payment IS NULL OR OLD.is_final_payment = false) THEN
    SELECT * INTO quote_rec FROM quotes WHERE id = NEW.quote_id;
    month_str := to_char(NEW.payment_date, 'YYYY-MM');
    rev_type  := quote_rec.revenue_type;

    IF rev_type = 'new' THEN
      INSERT INTO monthly_sales_data (staff_id, month_year, new_client_revenue)
      VALUES (quote_rec.created_by, month_str, quote_rec.subtotal)
      ON CONFLICT (staff_id, month_year)
      DO UPDATE SET
        new_client_revenue = monthly_sales_data.new_client_revenue + quote_rec.subtotal,
        updated_at = now();
    ELSE
      INSERT INTO monthly_sales_data (staff_id, month_year, renewal_revenue)
      VALUES (quote_rec.created_by, month_str, quote_rec.subtotal)
      ON CONFLICT (staff_id, month_year)
      DO UPDATE SET
        renewal_revenue = monthly_sales_data.renewal_revenue + quote_rec.subtotal,
        updated_at = now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payments_final_trigger
  AFTER INSERT OR UPDATE OF is_final_payment ON payments
  FOR EACH ROW EXECUTE FUNCTION handle_final_payment();

-- 5. Auto-create a staff_incentive_profile whenever a sales user
--    is added. Admins don't need profiles.
CREATE OR REPLACE FUNCTION auto_create_incentive_profile()
RETURNS TRIGGER AS $$
DECLARE
  s incentive_settings%ROWTYPE;
BEGIN
  IF NEW.role <> 'sales' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM staff_incentive_profiles WHERE user_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  SELECT * INTO s FROM incentive_settings LIMIT 1;

  INSERT INTO staff_incentive_profiles (
    user_id, monthly_salary, sales_multiplier,
    new_client_rate, renewal_rate, flat_bonus,
    join_date, is_active
  ) VALUES (
    NEW.id, 0,
    COALESCE(s.default_multiplier, 5),
    COALESCE(s.new_client_rate, 0.05),
    COALESCE(s.renewal_rate, 0.02),
    COALESCE(s.default_flat_bonus, 10000),
    CURRENT_DATE, true
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_auto_incentive_profile
  AFTER INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION auto_create_incentive_profile();

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE cities ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_cities ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_incentive_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_sales_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE follow_ups ENABLE ROW LEVEL SECURITY;
ALTER TABLE incentive_settings ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION get_my_role()
RETURNS text AS $$
  SELECT role FROM users WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER;

-- USERS
CREATE POLICY "users_read_all"    ON users FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "users_admin_write" ON users FOR ALL    USING (get_my_role() = 'admin');

-- CITIES
CREATE POLICY "cities_read_all"    ON cities FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "cities_admin_write" ON cities FOR ALL    USING (get_my_role() = 'admin');

-- QUOTES
CREATE POLICY "quotes_admin_all"   ON quotes FOR ALL USING (get_my_role() = 'admin');
CREATE POLICY "quotes_sales_own"   ON quotes FOR ALL
  USING (get_my_role() = 'sales' AND created_by = auth.uid());

-- QUOTE_CITIES
CREATE POLICY "qc_admin_all"       ON quote_cities FOR ALL USING (get_my_role() = 'admin');
CREATE POLICY "qc_sales_own"       ON quote_cities FOR ALL
  USING (
    get_my_role() = 'sales' AND
    quote_id IN (SELECT id FROM quotes WHERE created_by = auth.uid())
  );

-- PAYMENTS
CREATE POLICY "payments_admin_all" ON payments FOR ALL USING (get_my_role() = 'admin');
CREATE POLICY "payments_sales_read_own" ON payments FOR SELECT
  USING (
    get_my_role() = 'sales' AND
    quote_id IN (SELECT id FROM quotes WHERE created_by = auth.uid())
  );
-- Allow sales to insert payments on their own quotes
CREATE POLICY "payments_sales_insert_own" ON payments FOR INSERT
  WITH CHECK (
    get_my_role() = 'sales' AND
    quote_id IN (SELECT id FROM quotes WHERE created_by = auth.uid())
  );

-- STAFF INCENTIVE PROFILES
CREATE POLICY "sip_admin_all" ON staff_incentive_profiles FOR ALL USING (get_my_role() = 'admin');
CREATE POLICY "sip_sales_own" ON staff_incentive_profiles FOR SELECT
  USING (get_my_role() = 'sales' AND user_id = auth.uid());

-- MONTHLY SALES DATA
CREATE POLICY "msd_admin_all" ON monthly_sales_data FOR ALL USING (get_my_role() = 'admin');
CREATE POLICY "msd_sales_own" ON monthly_sales_data FOR SELECT
  USING (get_my_role() = 'sales' AND staff_id = auth.uid());

-- FOLLOW UPS
CREATE POLICY "fu_admin_all"  ON follow_ups FOR ALL USING (get_my_role() = 'admin');
CREATE POLICY "fu_sales_own"  ON follow_ups FOR ALL
  USING (get_my_role() = 'sales' AND assigned_to = auth.uid());

-- INCENTIVE SETTINGS
CREATE POLICY "is_admin_all"  ON incentive_settings FOR ALL    USING (get_my_role() = 'admin');
CREATE POLICY "is_sales_read" ON incentive_settings FOR SELECT USING (auth.uid() IS NOT NULL);

-- =====================================================
-- REALTIME — lets the dashboard update live when a payment
-- is recorded on another page / another person's device
-- =====================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.payments;            EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.quotes;              EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.monthly_sales_data;  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- =====================================================
-- DONE. Next step is in DEPLOY_GUIDE.md → "Seed admin user".
-- =====================================================
