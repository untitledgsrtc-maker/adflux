-- supabase_phase109_4_hr_offer_pii.sql
-- Phase 109.4 (2026-06-01) — attach PAN-card + Aadhaar-card images to the
-- HR offer flow (candidate uploads on the public offer form; HR views in
-- OfferDetailModal next to the PAN/Aadhaar numbers).
--
-- PAN + Aadhaar card IMAGES are sensitive PII, so unlike `offer-letters`
-- (public) the new `hr-offer-pii` bucket is PRIVATE:
--   • SELECT  → admin / co_owner / hr only (HR opens via a short-lived
--               signed URL; nobody else, no public read).
--   • INSERT  → admin/hr OR an ANON candidate uploading ONLY to a path
--               whose first segment is a REAL, still-open invite_token
--               (uuid — unguessable; tighter than offer-letters which
--               allows any anon insert). Path: {token}/{pan|aadhaar}/{ts}.ext
--   • DELETE  → admin / co_owner / hr only.
--
-- hr_offers stores the storage PATH (not a URL); HR mints a signed URL
-- at view time. Idempotent.
--
-- CANONICAL submit_offer_acceptance lives HERE now (24-arg). If you ever
-- re-run supabase_hr_module.sql / supabase_all_migrations.sql (the old
-- 22-arg copy), re-run THIS file after — else PostgREST sees a 2-overload
-- ambiguity (same class as the meeting-counter re-run-reverts foot-gun).

-- ─── 1. hr_offers columns ────────────────────────────────────────────
ALTER TABLE public.hr_offers
  ADD COLUMN IF NOT EXISTS pan_card_path     text,
  ADD COLUMN IF NOT EXISTS aadhaar_card_path text;


-- ─── 2. Private PII bucket ───────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'hr-offer-pii', 'hr-offer-pii', false, 5242880,
  ARRAY['image/jpeg','image/jpg','image/png','application/pdf']
)
ON CONFLICT (id) DO UPDATE
  SET public             = false,
      file_size_limit    = 5242880,
      allowed_mime_types = EXCLUDED.allowed_mime_types;


-- ─── 2b. Token check helper (SECURITY DEFINER) ──────────────────────
-- The candidate is ANON and has NO RLS read on hr_offers, so a raw
-- `EXISTS (SELECT … FROM hr_offers)` inside the storage policy would
-- return zero rows for them and block the upload. This SECURITY DEFINER
-- helper bypasses hr_offers RLS so the token-scoped check actually works
-- for the anon candidate. Returns true only for a live (non-closed)
-- invite token.
CREATE OR REPLACE FUNCTION public.is_open_offer_token(p_seg text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.hr_offers o
    WHERE o.invite_token::text = p_seg
      -- Card upload is part of the fill; once accepted, no more writes.
      AND o.status NOT IN ('cancelled', 'converted_to_user', 'accepted')
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_open_offer_token(text) TO anon, authenticated;


-- ─── 3. Storage RLS ──────────────────────────────────────────────────
-- READ: staff only (private). createSignedUrl needs SELECT on the object,
-- so this is what lets HR open the card. Anon has no read.
DROP POLICY IF EXISTS "hr-offer-pii: staff read" ON storage.objects;
CREATE POLICY "hr-offer-pii: staff read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'hr-offer-pii'
    AND public.get_my_role() IN ('admin', 'co_owner', 'hr')
  );

-- INSERT: staff, OR an anon candidate writing under a live invite_token
-- path. Compare token as TEXT (no ::uuid cast on the untrusted path —
-- a malformed first segment just fails to match instead of erroring).
DROP POLICY IF EXISTS "hr-offer-pii: scoped insert" ON storage.objects;
CREATE POLICY "hr-offer-pii: scoped insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'hr-offer-pii'
    -- Only the two expected sub-folders — blocks arbitrary junk paths.
    AND split_part(name, '/', 2) IN ('pan', 'aadhaar')
    AND (
      public.get_my_role() IN ('admin', 'co_owner', 'hr')
      OR public.is_open_offer_token(split_part(name, '/', 1))
    )
  );

-- DELETE: staff only.
DROP POLICY IF EXISTS "hr-offer-pii: staff delete" ON storage.objects;
CREATE POLICY "hr-offer-pii: staff delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'hr-offer-pii'
    AND public.get_my_role() IN ('admin', 'co_owner', 'hr')
  );


-- ─── 4. submit_offer_acceptance — add the 2 card paths ───────────────
-- Adding params changes the signature, so DROP the old 22-arg version
-- then CREATE the 24-arg one (PostgREST resolves by named args; only the
-- new overload remains). Body is byte-identical except the 2 new UPDATE
-- assignments + the 2 new params (DEFAULT NULL so a stale client that
-- omits them still works).
DROP FUNCTION IF EXISTS public.submit_offer_acceptance(
  uuid, text, text, date, text, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text, text, text
);

CREATE OR REPLACE FUNCTION public.submit_offer_acceptance(
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
  p_offer_pdf_url            text,
  p_pan_card_path            text DEFAULT NULL,
  p_aadhaar_card_path        text DEFAULT NULL
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
    pan_card_path           = COALESCE(p_pan_card_path, pan_card_path),
    aadhaar_card_path       = COALESCE(p_aadhaar_card_path, aadhaar_card_path),
    accepted_terms_at       = now(),
    status                  = 'accepted'
  WHERE id = v_offer_id;

  RETURN v_offer_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_offer_acceptance(
  uuid, text, text, date, text, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text, text, text, text, text
) TO anon, authenticated;


NOTIFY pgrst, 'reload schema';


-- ─── VERIFY ──────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema='public' AND table_name='hr_offers'
       AND column_name IN ('pan_card_path','aadhaar_card_path'))          AS new_columns,   -- expect 2
  (SELECT count(*) FROM storage.buckets WHERE id='hr-offer-pii')          AS bucket_present, -- expect 1
  (SELECT public FROM storage.buckets WHERE id='hr-offer-pii')            AS bucket_public,  -- expect false
  (SELECT count(*) FROM pg_policies
     WHERE schemaname='storage' AND tablename='objects'
       AND policyname LIKE 'hr-offer-pii:%')                              AS pii_policies,   -- expect 3
  (SELECT count(*) FROM information_schema.parameters
     WHERE specific_schema='public'
       AND specific_name LIKE 'submit_offer_acceptance%'
       AND parameter_name IN ('p_pan_card_path','p_aadhaar_card_path'))   AS rpc_new_params; -- expect 2
