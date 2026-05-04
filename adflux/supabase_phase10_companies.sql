-- =====================================================================
-- ADFLUX → UNTITLED OS  •  PHASE 10
-- companies table — two legal entities behind the OS
-- =====================================================================
--
-- WHY:
--   Owner spec, 4 May 2026 — Untitled OS spans TWO legal entities:
--     • Untitled Advertising      — for the GOVERNMENT segment
--     • Untitled Adflux Pvt Ltd   — for the PRIVATE segment
--   Each has its own GSTIN, bank account, address. The proposal
--   letter / invoice / payment instructions must use the correct
--   one based on quote.segment.
--
-- DATA SOURCE:
--   Owner uploaded two real GST invoices (4 May 2026):
--     • Invoice #14 → Kanan International (issued by Untitled Advertising)
--     • Invoice #1  → Alacris Medical    (issued by Untitled Adflux Pvt Ltd)
--   GSTIN / bank / address / email all extracted from the invoice
--   headers and footers.
--
-- DESIGN:
--   • One row per legal entity, keyed by `segment` so the renderer
--     can JOIN quotes.segment → companies.segment in one shot.
--     UNIQUE (segment) = exactly one company per segment.
--   • Single row per segment is the expected v1 shape; if Untitled
--     ever spins up a third entity, expand the segment enum and
--     add another row. No schema change needed.
--   • Phone is shared across both companies (single owner number).
--     Per-quote signer_mobile_override still wins over company default
--     when set on a specific proposal.
--   • All fields editable via Master.Companies tab (separate batch).
--
-- IDEMPOTENT.
-- =====================================================================


-- 1) companies table -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.companies (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  segment           text NOT NULL UNIQUE
                      CHECK (segment IN ('GOVERNMENT', 'PRIVATE')),
  name              text NOT NULL,
  name_gu           text,                    -- Gujarati transliteration for the letter
  short_name        text,                    -- e.g. "Untitled Advertising" vs "Untitled Adflux Pvt. Ltd."
  address_line      text,
  city              text DEFAULT 'Vadodara',
  state             text DEFAULT 'Gujarat',
  pincode           text,
  phone             text,
  email             text,
  website           text,
  gstin             text,
  pan               text,
  bank_name         text,
  bank_branch       text,
  bank_acc_name     text,
  bank_acc_number   text,
  bank_ifsc         text,
  bank_micr         text,
  upi_id            text,
  logo_url          text,                    -- storage path, if logo uploaded later
  letterhead_html   text,                    -- optional override for letter top
  is_active         boolean NOT NULL DEFAULT true,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_companies_segment_active
  ON public.companies (segment, is_active);


-- 2) Seed both companies from invoice data --------------------------
INSERT INTO public.companies (
  segment, name, name_gu, short_name,
  address_line, city, state, pincode,
  phone, email, website,
  gstin, pan,
  bank_name, bank_branch, bank_acc_name, bank_acc_number, bank_ifsc, bank_micr,
  upi_id
)
VALUES
  ('GOVERNMENT',
   'Untitled Advertising',
   'અનટાઇટલ્ડ એડવર્ટાઇઝિંગ',
   'Untitled Advertising',
   '203, Sidcup Tower',
   'Vadodara', 'Gujarat', '390016',
   '9428273686',
   'untitledadvertising@gmail.com',
   'www.untitledad.in',
   '24CNXPS9413D1ZI',
   'CNXPS9413D',
   'Axis Bank',
   'VADODARA - 390007',
   'UNTITLED ADVERTISING',
   '917020075170214',
   'UTIB0000013',
   NULL,
   'untitled@axisbank'
  ),
  ('PRIVATE',
   'Untitled Adflux Private Limited',
   NULL,
   'Untitled Adflux Pvt. Ltd.',
   '203, Sidcup Tower',
   'Vadodara', 'Gujarat', '390007',
   '9428273686',
   'untitledadflux@gmail.com',
   NULL,
   '24AADCU7213R1ZX',
   'AADCU7213R',
   'HDFC Bank',
   'KARELIBUG',
   'UNTITLED ADFLUX PRIVATE LIMITED',
   '50200113893363',
   'HDFC0000147',
   '390240003',
   NULL
  )
ON CONFLICT (segment) DO NOTHING;


-- 3) RLS — read-all authenticated, admin-write ----------------------
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "co_read_all"     ON public.companies;
CREATE POLICY "co_read_all"     ON public.companies
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "co_admin_write"  ON public.companies;
CREATE POLICY "co_admin_write"  ON public.companies
  FOR ALL USING (public.get_my_role() IN ('admin', 'owner', 'co_owner'));


-- 4) updated_at trigger ---------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_companies_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS companies_touch ON public.companies;
CREATE TRIGGER companies_touch
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.touch_companies_updated_at();


-- =====================================================================
-- VERIFY:
--
--   SELECT segment, name, gstin, bank_name, bank_acc_number, bank_ifsc
--     FROM public.companies
--    ORDER BY segment;
--
--   -- Expected: 2 rows.
--
-- =====================================================================
