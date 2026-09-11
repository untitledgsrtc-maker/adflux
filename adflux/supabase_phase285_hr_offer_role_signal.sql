-- Phase 285 — persist the designation "role signal" on each offer so the
-- offer letter (and convert-to-user) can branch by role instead of guessing
-- from a free-text position string. Additive, idempotent.
-- WHY: OfferLetterPDF was sales-only; a snapshot of the picked designation's
-- auth_role / team_role / has_incentive / name lets it pick the right letter
-- (sales | ops | telecaller | generic) and lets convert mint the right role.
-- Snapshot (not just a FK) so a later designation edit never rewrites a sent offer.
-- Owner runs this in Supabase Studio BEFORE the frontend deploys (else the
-- offers list SELECT names columns that don't exist → PostgREST 400s).

ALTER TABLE public.hr_offers ADD COLUMN IF NOT EXISTS designation_auth_role   text;
ALTER TABLE public.hr_offers ADD COLUMN IF NOT EXISTS designation_team_role   text;
ALTER TABLE public.hr_offers ADD COLUMN IF NOT EXISTS designation_has_incentive boolean;
ALTER TABLE public.hr_offers ADD COLUMN IF NOT EXISTS designation_name        text;

NOTIFY pgrst, 'reload schema';

-- VERIFY: expect 4 rows.
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'hr_offers'
  AND column_name IN ('designation_auth_role','designation_team_role','designation_has_incentive','designation_name')
ORDER BY column_name;
