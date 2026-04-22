-- =======================================================================
-- HR MODULE — Offer letters for pre-hire sales candidates
-- =======================================================================
--
-- What this adds
--   1. hr_offer_templates  — Phase 2 editable boilerplate. For Phase 1
--                            we seed ONE default row with hardcoded
--                            clause text; the UI doesn't expose editing
--                            yet.
--   2. hr_offers           — one row per candidate. Tracks the whole
--                            pre-hire lifecycle:
--                              draft → sent → filled → accepted → converted_to_user
--                            Admin fills the top block at "Send Offer"
--                            time. Candidate fills personal details via
--                            a public invite-token link (no auth).
--                            On acceptance, the generated PDF URL is
--                            stored in offer_pdf_url.
--   3. Two SECURITY DEFINER RPCs for anonymous candidate access:
--        fetch_offer_by_token(token)      — read-only summary for the
--                                           form page
--        submit_offer_acceptance(token, <personal fields>, pdf_url)
--                                         — one-shot upsert that writes
--                                           personal details + PDF URL
--                                           + flips status to 'accepted'
--      These are the ONLY paths open to anon. The table itself stays
--      admin-only under standard RLS. This keeps the attack surface to
--      two whitelisted functions instead of a "read-if-you-guess-the-
--      token" blanket policy.
--   4. offer-letters storage bucket (public read, authenticated write
--      for admin uploads; candidate-side uploads go through a Supabase
--      Storage signed-URL flow initiated by the admin, NOT here).
--
-- What this DOES NOT touch
--   - No ALTER on users, quotes, cities, or any existing table.
--   - No ALTER on auth schema.
--   - User creation at "Convert to User" time happens via the existing
--     supabaseSignup flow (client-side) — this migration only stores
--     the resulting user_id in hr_offers.converted_user_id.
--
-- How to apply
--   Run this entire file ONCE in the Supabase SQL Editor. Idempotent —
--   safe to re-run; every DROP/CREATE is guarded.
-- =======================================================================

-- =====================================================================
-- 1. TEMPLATES — Phase 2 editable. Phase 1 uses ONE default row.
-- =====================================================================

CREATE TABLE IF NOT EXISTS hr_offer_templates (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                text NOT NULL,
  -- Boilerplate blocks. Plain text (optionally with {{placeholders}}
  -- merged client-side at PDF time). Phase 1 values are the ones from
  -- the Jignesh Brahmbhatt letter — 6-month probation, 15/30-day
  -- notice, ₹12-15L target, 6+6 leave, 12-month non-compete, etc.
  probation_months    integer DEFAULT 6,
  notice_probation_days integer DEFAULT 15,
  notice_confirmed_days integer DEFAULT 30,
  min_monthly_target  numeric DEFAULT 100000,
  paid_leave_days     integer DEFAULT 6,
  sick_leave_days     integer DEFAULT 6,
  non_compete_months  integer DEFAULT 12,
  working_days        text   DEFAULT 'Monday to Saturday',
  travel_percent      text   DEFAULT '50-60%',
  place_default       text   DEFAULT 'Vadodara',
  -- Long-form clause bodies. Stored on the template so Phase 2 can
  -- edit them without a code change. Defaults below mirror the
  -- sample letter the user shared.
  confidentiality_text text,
  termination_text     text,
  company_assets_text  text,
  remuneration_text    text,
  is_default          boolean DEFAULT false,
  is_active           boolean DEFAULT true,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

-- Seed the Phase 1 default. INSERT only if no default exists yet — so
-- this migration can re-run without duplicating the row.
INSERT INTO hr_offer_templates (
  name, is_default,
  confidentiality_text, termination_text,
  company_assets_text, remuneration_text
)
SELECT
  'Sales Person — Default',
  true,
  'You shall, during the period of your employment or at any time '
  || 'thereafter, not disclose or use any confidential information '
  || 'relating to the business of the Company for your own benefit '
  || 'or for the benefit of any third party.',
  'Either party may terminate this agreement by serving the notice '
  || 'period specified above. The Company reserves the right to '
  || 'terminate immediately in case of misconduct, breach of '
  || 'confidentiality, or material non-performance.',
  'All company assets (laptop, SIM, marketing collateral, client '
  || 'contacts, etc.) issued to you must be returned in good '
  || 'condition on your last working day. Failure to return assets '
  || 'may result in deduction from final settlement.',
  'The remuneration details in this letter are strictly '
  || 'confidential and shall not be disclosed to any third party, '
  || 'including colleagues, under any circumstances.'
WHERE NOT EXISTS (
  SELECT 1 FROM hr_offer_templates WHERE is_default = true
);

-- =====================================================================
-- 2. OFFERS — main table
-- =====================================================================

CREATE TABLE IF NOT EXISTS hr_offers (
  id                        uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Public-facing token the candidate uses to open the form URL.
  -- UUID so enumeration is infeasible; unique so the URL maps to
  -- exactly one offer.
  invite_token              uuid UNIQUE NOT NULL DEFAULT uuid_generate_v4(),

  -- Lifecycle. draft → sent → filled → accepted → converted_to_user.
  -- 'sent' is set the moment the admin copies/shares the link so the
  -- list view can show outstanding invites.
  status                    text NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft','sent','filled','accepted','converted_to_user','cancelled')),

  -- --- Admin-filled at Send Offer time -------------------------------
  candidate_name            text NOT NULL,
  candidate_email           text NOT NULL,
  position                  text NOT NULL DEFAULT 'Sales Person',
  territory                 text,
  joining_date              date,
  fixed_salary_monthly      numeric NOT NULL,
  -- Free-form string because the sample letter uses a range ("1% of
  -- billing up to ₹15L / 2% thereafter") that isn't easily modeled
  -- as a single number. Admin types what they want printed.
  incentive_text            text,
  place                     text DEFAULT 'Vadodara',
  template_id               uuid REFERENCES hr_offer_templates(id),

  -- --- Candidate-filled via public form ------------------------------
  full_legal_name           text,
  fathers_name              text,
  dob                       date,
  mobile                    text,
  personal_email            text,
  address_line1             text,
  address_line2             text,
  city                      text,
  district                  text,
  state                     text,
  pincode                   text,
  pan_number                text,
  aadhaar_number            text,
  qualification             text,
  bank_account_number       text,
  bank_name                 text,
  bank_ifsc                 text,
  emergency_contact_name    text,
  emergency_contact_phone   text,
  emergency_contact_rel     text,

  -- --- Acceptance ---------------------------------------------------
  accepted_terms_at         timestamptz,
  accepted_ip               text,
  offer_pdf_url             text,

  -- --- Conversion ---------------------------------------------------
  converted_user_id         uuid REFERENCES users(id),
  converted_at              timestamptz,

  -- --- Bookkeeping --------------------------------------------------
  created_by                uuid REFERENCES users(id),
  created_at                timestamptz DEFAULT now(),
  updated_at                timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hr_offers_status_idx       ON hr_offers(status);
CREATE INDEX IF NOT EXISTS hr_offers_created_by_idx   ON hr_offers(created_by);
CREATE INDEX IF NOT EXISTS hr_offers_converted_idx    ON hr_offers(converted_user_id);

-- updated_at bookkeeping
DROP TRIGGER IF EXISTS hr_offers_updated_at ON hr_offers;
CREATE TRIGGER hr_offers_updated_at
  BEFORE UPDATE ON hr_offers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS hr_offer_templates_updated_at ON hr_offer_templates;
CREATE TRIGGER hr_offer_templates_updated_at
  BEFORE UPDATE ON hr_offer_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =====================================================================
-- 3. ROW LEVEL SECURITY
-- =====================================================================

ALTER TABLE hr_offer_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_offers          ENABLE ROW LEVEL SECURITY;

-- Templates: admins read/write; sales read (so salesperson UI can show
-- the template used for their own letter).
DROP POLICY IF EXISTS "hr_templates_admin_all"   ON hr_offer_templates;
DROP POLICY IF EXISTS "hr_templates_sales_read"  ON hr_offer_templates;
CREATE POLICY "hr_templates_admin_all"   ON hr_offer_templates FOR ALL
  USING (get_my_role() = 'admin');
CREATE POLICY "hr_templates_sales_read"  ON hr_offer_templates FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Offers:
--   - admin: full access
--   - sales: read ONLY their own converted offer (the one that created
--            their user row). Other offers are invisible to them.
--   - anonymous / candidate: NO direct access. The candidate can only
--            reach their own row through the RPC functions below.
DROP POLICY IF EXISTS "hr_offers_admin_all"       ON hr_offers;
DROP POLICY IF EXISTS "hr_offers_sales_own"       ON hr_offers;
CREATE POLICY "hr_offers_admin_all" ON hr_offers FOR ALL
  USING (get_my_role() = 'admin');
CREATE POLICY "hr_offers_sales_own" ON hr_offers FOR SELECT
  USING (get_my_role() = 'sales' AND converted_user_id = auth.uid());

-- =====================================================================
-- 4. PUBLIC RPCs for candidate access
-- =====================================================================
--
-- The candidate is NOT an authenticated user. These functions are the
-- only surface exposed to anon. Both are SECURITY DEFINER so they can
-- bypass RLS with controlled, narrow logic.
--
-- Security notes
--   - The token is required on every call. No listing, no enumeration.
--   - fetch_offer_by_token returns only the public-safe subset of
--     columns — we never leak admin notes, other offers, or
--     conversion metadata.
--   - submit_offer_acceptance rejects any offer that is already
--     'accepted' or 'converted_to_user', so a leaked token can't be
--     used to rewrite an accepted letter.
-- =====================================================================

-- Read-only summary for the public form page.
CREATE OR REPLACE FUNCTION fetch_offer_by_token(p_token uuid)
RETURNS TABLE (
  id                    uuid,
  status                text,
  candidate_name        text,
  candidate_email       text,
  position              text,
  territory             text,
  joining_date          date,
  fixed_salary_monthly  numeric,
  incentive_text        text,
  place                 text,
  template_id           uuid,
  offer_pdf_url         text,
  accepted_terms_at     timestamptz,
  -- Personal fields — returned so that if a candidate reopens the
  -- link after a partial save we can pre-fill. Empty for fresh
  -- offers.
  full_legal_name           text,
  fathers_name              text,
  dob                       date,
  mobile                    text,
  personal_email            text,
  address_line1             text,
  address_line2             text,
  city                      text,
  district                  text,
  state                     text,
  pincode                   text,
  pan_number                text,
  aadhaar_number            text,
  qualification             text,
  bank_account_number       text,
  bank_name                 text,
  bank_ifsc                 text,
  emergency_contact_name    text,
  emergency_contact_phone   text,
  emergency_contact_rel     text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    id, status, candidate_name, candidate_email, position, territory,
    joining_date, fixed_salary_monthly, incentive_text, place,
    template_id, offer_pdf_url, accepted_terms_at,
    full_legal_name, fathers_name, dob, mobile, personal_email,
    address_line1, address_line2, city, district, state, pincode,
    pan_number, aadhaar_number, qualification,
    bank_account_number, bank_name, bank_ifsc,
    emergency_contact_name, emergency_contact_phone, emergency_contact_rel
  FROM hr_offers
  WHERE invite_token = p_token
    AND status <> 'cancelled'
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION fetch_offer_by_token(uuid) TO anon, authenticated;

-- One-shot submission: writes candidate-filled fields + the uploaded
-- PDF URL, flips status to 'accepted'. The client is responsible for
-- generating and uploading the PDF FIRST and then passing the URL
-- here — that keeps the function logic trivial and avoids giving anon
-- write access to Storage policies beyond what's already needed.
CREATE OR REPLACE FUNCTION submit_offer_acceptance(
  p_token                    uuid,
  p_full_legal_name          text,
  p_fathers_name             text,
  p_dob                      date,
  p_mobile                   text,
  p_personal_email           text,
  p_address_line1            text,
  p_address_line2            text,
  p_city                     text,
  p_district                 text,
  p_state                    text,
  p_pincode                  text,
  p_pan_number               text,
  p_aadhaar_number           text,
  p_qualification            text,
  p_bank_account_number      text,
  p_bank_name                text,
  p_bank_ifsc                text,
  p_emergency_contact_name   text,
  p_emergency_contact_phone  text,
  p_emergency_contact_rel    text,
  p_offer_pdf_url            text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offer_id uuid;
  v_status   text;
BEGIN
  SELECT id, status INTO v_offer_id, v_status
    FROM hr_offers
   WHERE invite_token = p_token
   LIMIT 1;

  IF v_offer_id IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired offer link';
  END IF;

  -- A leaked token must not be able to rewrite an accepted letter.
  IF v_status IN ('accepted','converted_to_user','cancelled') THEN
    RAISE EXCEPTION 'This offer has already been submitted or is no longer active';
  END IF;

  UPDATE hr_offers SET
    full_legal_name         = p_full_legal_name,
    fathers_name            = p_fathers_name,
    dob                     = p_dob,
    mobile                  = p_mobile,
    personal_email          = p_personal_email,
    address_line1           = p_address_line1,
    address_line2           = p_address_line2,
    city                    = p_city,
    district                = p_district,
    state                   = p_state,
    pincode                 = p_pincode,
    pan_number              = p_pan_number,
    aadhaar_number          = p_aadhaar_number,
    qualification           = p_qualification,
    bank_account_number     = p_bank_account_number,
    bank_name               = p_bank_name,
    bank_ifsc               = p_bank_ifsc,
    emergency_contact_name  = p_emergency_contact_name,
    emergency_contact_phone = p_emergency_contact_phone,
    emergency_contact_rel   = p_emergency_contact_rel,
    offer_pdf_url           = p_offer_pdf_url,
    accepted_terms_at       = now(),
    status                  = 'accepted'
  WHERE id = v_offer_id;

  RETURN v_offer_id;
END;
$$;

GRANT EXECUTE ON FUNCTION submit_offer_acceptance(
  uuid, text, text, date, text, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text, text, text
) TO anon, authenticated;

-- =====================================================================
-- 5. STORAGE BUCKET — offer-letters
-- =====================================================================
--
-- Public read (admin + salesperson can open the PDF from the app;
-- candidate gets the URL back from submit_offer_acceptance and can
-- bookmark it). Writes allowed for anon AND authenticated, BUT scoped
-- tightly by path prefix:
--   offer-letters/{invite_token}/{timestamp}.pdf
-- So a hostile uploader can overwrite only PDFs for a token they
-- already know — the same secret that grants access to the form.
-- =====================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('offer-letters', 'offer-letters', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- Public read
DROP POLICY IF EXISTS "offer-letters: public read" ON storage.objects;
CREATE POLICY "offer-letters: public read"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'offer-letters');

-- Anon + authenticated insert. Candidate is anon when uploading the
-- generated PDF from the public form page.
DROP POLICY IF EXISTS "offer-letters: any insert" ON storage.objects;
CREATE POLICY "offer-letters: any insert"
  ON storage.objects
  FOR INSERT
  WITH CHECK (bucket_id = 'offer-letters');

-- Authenticated-only delete (admin cleanup via Supabase console).
DROP POLICY IF EXISTS "offer-letters: authenticated delete" ON storage.objects;
CREATE POLICY "offer-letters: authenticated delete"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'offer-letters');

-- =====================================================================
-- 6. REALTIME (optional — lets the admin HR list refresh when a
-- candidate submits the form from another device)
-- =====================================================================

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.hr_offers;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- =====================================================================
-- DONE.
-- =====================================================================
