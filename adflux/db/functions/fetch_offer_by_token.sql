-- ============================================================================
-- db/functions/fetch_offer_by_token.sql — CANONICAL HOME (Phase 329 / §71)
-- ============================================================================
-- The ONE place fetch_offer_by_token lives. Edit THIS file; do not write a new
-- phaseN copy (CLAUDE.md §71 rule 1). To deploy a change: paste THIS WHOLE FILE
-- into Supabase Studio, once. Safe to re-run. Order vs the code deploy does not
-- matter (the page just ignores fields it doesn't get yet).
--   Expected result of the last grid (ONE row): anon_can_execute = true,
--   authenticated_can_execute = true, overload_count = 1, arg_and_column_names = 42,
--   has_designation_columns = true, kept_old_columns = true.
--   If the first step stops with "Phase 285 columns missing", run
--   supabase_phase285_hr_offer_role_signal.sql first, then paste this file again
--   (nothing was changed — the pre-flight below runs before anything is touched).
--
-- WHAT: the pre-login read behind the public /offer/:token page (OfferForm.jsx,
--   called twice: on load and after submit). Returns the ONE hr_offers row whose
--   invite_token = p_token and status <> 'cancelled' — nothing else, no listing.
--   SECURITY DEFINER because the candidate is anon and has no RLS read on hr_offers.
--
-- Phase 329 (2026-10-02): added the 4 Phase-285 role-signal columns
--   (designation_auth_role · designation_team_role · designation_has_incentive ·
--   designation_name). WHY: OfferForm hands this row to OfferLetterPDF to build the
--   candidate-signed PDF; without designation_auth_role the PDF always fell back to the
--   SALES letter, even for ops / telecaller / accounts offers (OfferLetterPDF resolves
--   the variant from offer.designation_auth_role). The 4 columns are appended LAST.
--
-- LOCKED (do not strip):
--   • anon + authenticated EXECUTE — the candidate opens the link before any login
--     (§211 anon allow-list: fetch_offer_by_token · is_open_offer_token ·
--     submit_offer_acceptance). Removing anon breaks every offer link.
--   • WHERE invite_token = p_token AND status <> 'cancelled' + LIMIT 1.
--   • B-pii (owner 2026-10-05): the candidate's personal details are NO LONGER returned.
--     Only full_legal_name (shown on the "Offer accepted" screen) still comes back; dob,
--     mobile, personal_email, address, PAN, Aadhaar, qualification, bank and emergency
--     columns are returned as NULL (the OUT columns stay, so the page and the 41-column
--     shape are unchanged). WHY SAFE: the page only writes these fields in ONE submit
--     (submit_offer_acceptance sets them and status='accepted' together; once accepted it
--     refuses more writes) - checked live: all 13 offers holding a PAN are accepted or
--     converted, none before. So the old "reopen after a partial save" prefill never had
--     data to show; and the accepted screen needs only name, status and offer_pdf_url.
--     HR reads the full row directly from hr_offers (RLS), not through this function.
--     Do NOT put them back: anyone holding the link could read PAN / Aadhaar / bank.
--
-- RE-RUN HAZARD: supabase_hr_module.sql and the generated supabase_all_migrations.sql
--   still carry the OLD 37-column body of this function (DROP + CREATE). Re-running
--   either silently strips the 4 designation columns again — re-run THIS file after.
--
-- Return-type change ⇒ DROP + CREATE (42P13), in ONE transaction (see below).
-- Requires Phase 285 (hr_offers.designation_* columns) — already live.
-- ============================================================================

-- ==== pre-flight (changes nothing) ==============================================
-- Stops with a plain message if the Phase 285 columns are missing, instead of a raw
-- "column does not exist" error from CREATE FUNCTION. Runs BEFORE the transaction, so
-- when it stops, today's function is left exactly as it is.
DO $$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'hr_offers'
         AND column_name IN ('designation_auth_role','designation_team_role',
                             'designation_has_incentive','designation_name')) <> 4 THEN
    RAISE EXCEPTION 'Phase 285 columns missing on hr_offers - run supabase_phase285_hr_offer_role_signal.sql first, then paste this file again.';
  END IF;
END $$;

-- ==== replace the function (one transaction) ====================================
-- Return type changes (4 new OUT columns) → Postgres refuses CREATE OR REPLACE
-- (42P13), so DROP first. DROP + CREATE + GRANT sit in ONE transaction: the public
-- /offer/:token page can never see a moment with no function, and any error rolls
-- the whole thing back leaving today's function untouched.
BEGIN;

DROP FUNCTION IF EXISTS public.fetch_offer_by_token(uuid);

CREATE OR REPLACE FUNCTION public.fetch_offer_by_token(p_token uuid)
RETURNS TABLE (
  id                    uuid,
  status                text,
  candidate_name        text,
  candidate_email       text,
  "position"            text,
  territory             text,
  joining_date          date,
  fixed_salary_monthly  numeric,
  incentive_text        text,
  incentive_sales_multiplier numeric,
  incentive_new_client_rate  numeric,
  incentive_renewal_rate     numeric,
  incentive_flat_bonus       numeric,
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
  emergency_contact_rel     text,
  -- Phase 285 role-signal snapshot (appended LAST so every existing column keeps
  -- its position). OfferForm spreads these into the object it hands to
  -- OfferLetterPDF so the candidate-signed PDF picks the right per-role letter.
  designation_auth_role     text,
  designation_team_role     text,
  designation_has_incentive boolean,
  designation_name          text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    id, status, candidate_name, candidate_email, "position", territory,
    joining_date, fixed_salary_monthly, incentive_text,
    incentive_sales_multiplier, incentive_new_client_rate,
    incentive_renewal_rate, incentive_flat_bonus,
    place, template_id, offer_pdf_url, accepted_terms_at,
    full_legal_name,
    -- B-pii (5 Oct 2026): the open link no longer returns the candidate's personal
    -- details. NULL placeholders keep the 41-column shape + order identical.
    NULL::text, NULL::date, NULL::text, NULL::text,
    NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,
    NULL::text, NULL::text, NULL::text,
    NULL::text, NULL::text, NULL::text,
    NULL::text, NULL::text, NULL::text,
    designation_auth_role, designation_team_role,
    designation_has_incentive, designation_name
  FROM public.hr_offers
  WHERE invite_token = p_token
    AND status <> 'cancelled'
  LIMIT 1;
$$;

-- DROP + CREATE hands the new function Postgres' PUBLIC default again. Restore the
-- Phase 211 posture: strip PUBLIC, grant ONLY the two roles that need it. anon is
-- required — the candidate opens /offer/:token before any login (§211 allow-list:
-- fetch_offer_by_token · is_open_offer_token · submit_offer_acceptance).
REVOKE ALL ON FUNCTION public.fetch_offer_by_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fetch_offer_by_token(uuid) TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- VERIFY: ONE row (Studio only shows the last result, so everything is in one grid).
-- Expect every column exactly as written in its comment:
SELECT
  has_function_privilege('anon',          'public.fetch_offer_by_token(uuid)', 'EXECUTE') AS anon_can_execute,           -- true
  has_function_privilege('authenticated', 'public.fetch_offer_by_token(uuid)', 'EXECUTE') AS authenticated_can_execute, -- true
  (SELECT count(*) FROM pg_proc WHERE proname = 'fetch_offer_by_token')                    AS overload_count,             -- 1
  (SELECT cardinality(proargnames) FROM pg_proc
    WHERE oid = 'public.fetch_offer_by_token(uuid)'::regprocedure)                         AS arg_and_column_names,       -- 42 (1 arg + 41 columns)
  pg_get_function_result('public.fetch_offer_by_token(uuid)'::regprocedure)
    LIKE '%designation_auth_role%designation_team_role%designation_has_incentive%designation_name%' AS has_designation_columns, -- true
  pg_get_function_result('public.fetch_offer_by_token(uuid)'::regprocedure)
    LIKE '%pan_number text%bank_ifsc text%emergency_contact_phone text%'                  AS kept_old_columns;           -- true
