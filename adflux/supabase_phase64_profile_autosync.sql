-- =====================================================================
-- supabase_phase64_profile_autosync.sql — SUPERSEDED / NEUTRALIZED
-- 2026-07-07 (owner directive "B": salary is 100% manual, no auto-sync)
--
-- THIS FILE USED TO install the designation→salary auto-sync:
--   • sync_user_profile_from_designation(uuid)
--   • tg_user_profile_autosync()        + trigger tg_users_profile_autosync
--   • tg_designation_propagate_salary() + trigger tg_designations_salary_propagate
-- which OVERWROTE staff_incentive_profiles.monthly_salary with the
-- designation's default_monthly_salary. Result: a hand-set salary
-- (Jayna 15,000) silently snapped back to the designation rate
-- (Telecaller 18,000) whenever her designation/active-status was touched
-- OR the rate-card edited. It hit EVERY salaried person.
--
-- Owner removed it entirely 2026-07-07. Salary is now purely what
-- accounts/admin sets on the profile — never auto-changed.
--
-- The CREATE bodies are GONE. This file now only DROPs (idempotent) so
-- re-pasting it can NEVER resurrect the auto-sync (landmine-defuse, §72).
-- Canonical removal = supabase_phase213_drop_salary_autosync.sql — run that.
-- Kept here for history + so the old file is safe to re-run.
-- =====================================================================

DROP TRIGGER IF EXISTS tg_users_profile_autosync        ON public.users;
DROP TRIGGER IF EXISTS tg_designations_salary_propagate ON public.designations;

DROP FUNCTION IF EXISTS public.tg_user_profile_autosync();
DROP FUNCTION IF EXISTS public.tg_designation_propagate_salary();
DROP FUNCTION IF EXISTS public.sync_user_profile_from_designation(uuid);

NOTIFY pgrst, 'reload schema';

SELECT 'phase64 neutralized — designation salary auto-sync removed (see phase213)' AS status;
