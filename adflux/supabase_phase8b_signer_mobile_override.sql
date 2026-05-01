-- =====================================================================
-- ADFLUX → UNTITLED OS  •  PHASE 8B
-- Per-quote editable signer mobile number
-- =====================================================================
--
-- WHAT THIS DOES:
--   Adds signer_mobile_override (text, nullable) to public.quotes.
--   When set, the GovtProposalRenderer uses this value instead of
--   the signer's default signature_mobile from the users table.
--   When null/empty, falls back to signer.signature_mobile.
--
-- WHY:
--   Owner spec, 1 May 2026 — the mobile number on the signature
--   block needs to be editable per proposal, because different
--   government departments occasionally need a desk-specific number
--   (e.g. accounts dept vs CEO direct). Editing the user record
--   would change every other quote that user signs, which is wrong.
--
-- IDEMPOTENT.
-- =====================================================================

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS signer_mobile_override text;
