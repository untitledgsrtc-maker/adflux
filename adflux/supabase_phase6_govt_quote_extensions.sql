-- =====================================================================
-- ADFLUX → UNTITLED OS  •  PHASE 6
-- Government quote extensions: signer + line item polymorphism
-- =====================================================================
--
-- WHAT THIS DOES (plain language):
--   Adds the columns the Government wizard needs to save proposals into
--   the existing quotes / quote_cities tables. Pragmatic: we extend
--   what's already there instead of creating a new proposals table.
--
--   1. quotes.signer_user_id — which signing-authority user signed.
--   2. quotes.auto_total_quantity — Auto Hood total rickshaw count.
--   3. quotes.gsrtc_campaign_months — GSRTC LED campaign duration in
--      months.
--   4. quotes.recipient_block — denormalized snapshot of the multi-line
--      recipient address used in the rendered letter (so a future edit
--      to the client's address doesn't rewrite history on past quotes).
--   5. quote_cities — extended to be polymorphic:
--        - ref_kind: 'CITY' (existing default), 'DISTRICT', 'STATION'
--        - ref_id: uuid pointing at auto_districts.id or
--          gsrtc_stations.id (NULL for legacy CITY rows that point
--          via city_id instead)
--        - description: human-readable label snapshot
--        - qty: numeric quantity (rickshaws for DISTRICT, monthly
--          spots for STATION)
--        - unit_rate: per-unit rate snapshot (DAVP for govt)
--        - amount: line total
--   6. users.signature_mobile + users.signature_title — used to render
--      the signer block at the bottom of the letter. Brijesh's mobile
--      and title backfilled here.
--
-- IDEMPOTENT.
-- STAGING ONLY.
-- =====================================================================


-- 1) Quote-level new columns ------------------------------------------
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS signer_user_id          uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS auto_total_quantity     integer,
  ADD COLUMN IF NOT EXISTS gsrtc_campaign_months   integer,
  ADD COLUMN IF NOT EXISTS recipient_block         text,
  ADD COLUMN IF NOT EXISTS proposal_date           date;

-- Auto-default proposal_date for new govt rows where caller forgets it
ALTER TABLE public.quotes
  ALTER COLUMN proposal_date SET DEFAULT CURRENT_DATE;


-- 2) quote_cities polymorphism ---------------------------------------
ALTER TABLE public.quote_cities
  ADD COLUMN IF NOT EXISTS ref_kind     text NOT NULL DEFAULT 'CITY'
                           CHECK (ref_kind IN ('CITY','DISTRICT','STATION','FREE_TEXT')),
  ADD COLUMN IF NOT EXISTS ref_id       uuid,
  ADD COLUMN IF NOT EXISTS description  text,
  ADD COLUMN IF NOT EXISTS qty          numeric,
  ADD COLUMN IF NOT EXISTS unit_rate    numeric,
  ADD COLUMN IF NOT EXISTS amount       numeric;

-- Helpful index for filtering by ref kind
CREATE INDEX IF NOT EXISTS idx_qc_ref_kind ON public.quote_cities (ref_kind);


-- 3) Signer block fields on users -------------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS signature_mobile text,
  ADD COLUMN IF NOT EXISTS signature_title  text;

-- Backfill known signer details (30 Apr 2026 owner-confirmed)
UPDATE public.users
   SET signature_mobile = '9428273686',
       signature_title  = 'Founder & CEO'
 WHERE email IN ('os@untitledad.in', 'brijesh-staging@untitledadvertising.in')
   AND signature_mobile IS NULL;

UPDATE public.users
   SET signature_mobile = '9924350285',
       signature_title  = 'CEO'
 WHERE email = 'vishal@untitledad.in'
   AND signature_mobile IS NULL;


-- =====================================================================
-- VERIFY:
--
--   SELECT name, email, role, signature_title, signature_mobile
--     FROM public.users
--    WHERE signing_authority = true
--    ORDER BY role, name;
--
--   -- Expected: titles + mobiles for Brijesh (Founder & CEO / 9428273686)
--   --           and Vishal Chauhan (CEO / 9924350285)
--
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'quotes' AND column_name IN
--      ('signer_user_id','auto_total_quantity','gsrtc_campaign_months',
--       'recipient_block','proposal_date');
--   -- Expected: 5 rows
--
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'quote_cities' AND column_name IN
--      ('ref_kind','ref_id','description','qty','unit_rate','amount');
--   -- Expected: 6 rows
--
-- =====================================================================
