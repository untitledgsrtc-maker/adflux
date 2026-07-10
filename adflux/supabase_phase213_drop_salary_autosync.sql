-- =====================================================================
-- Phase 213 — REMOVE the designation→salary auto-sync (Phase 64) entirely
-- 2026-07-07 · owner directive "B": salary is 100% manual, no auto-anything.
--
-- WHY: Phase 64 installed two triggers →
--   • tg_users_profile_autosync        (users,        AFTER UPDATE OF designation, is_active)
--   • tg_designations_salary_propagate (designations, AFTER UPDATE OF default_monthly_salary)
--   both calling sync_user_profile_from_designation(uuid), which OVERWROTE
--   staff_incentive_profiles.monthly_salary with the designation's
--   default_monthly_salary. Result: a hand-set salary (Jayna 15,000)
--   silently snapped back to the designation rate (Telecaller 18,000)
--   whenever her designation/active-status was touched OR that rate-card
--   was edited. Owner confirmed BOTH triggers live 2026-07-07 (pg_trigger).
--   This affected EVERY salaried person, not just Jayna.
--
-- FIX (owner chose B): DROP both triggers + all 3 functions. Salary is now
--   purely what accounts/admin sets on the profile — never auto-changed.
--   Verified: NO caller anywhere in src / api / other SQL / db references
--   these 3 fns or 2 triggers (grep clean).
--
-- SAFE: DROP ... IF EXISTS (idempotent, re-runnable). Mutates NO salary
--   DATA — only removes the triggers/functions. Every current
--   monthly_salary value stays exactly as it is. §45-safe (no hot path;
--   removing a trigger only makes future designation edits do LESS).
--   Supersedes supabase_phase64_profile_autosync.sql (neutralized to a
--   DROP-only tombstone so re-pasting it can never resurrect the auto-sync).
--
-- AFTER THIS: re-set Jayna to 15,000 (and any other salary the auto-sync
--   had reverted — see the blast-radius query) and it STAYS.
-- =====================================================================

DROP TRIGGER IF EXISTS tg_users_profile_autosync        ON public.users;
DROP TRIGGER IF EXISTS tg_designations_salary_propagate ON public.designations;

DROP FUNCTION IF EXISTS public.tg_user_profile_autosync();
DROP FUNCTION IF EXISTS public.tg_designation_propagate_salary();
DROP FUNCTION IF EXISTS public.sync_user_profile_from_designation(uuid);

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY — both SELECTs must return ZERO rows (auto-sync is gone) ──
SELECT tgname, tgrelid::regclass AS on_table
FROM pg_trigger
WHERE tgname IN ('tg_users_profile_autosync', 'tg_designations_salary_propagate')
  AND NOT tgisinternal;

SELECT proname
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND proname IN ('sync_user_profile_from_designation',
                  'tg_user_profile_autosync',
                  'tg_designation_propagate_salary');

SELECT 'Phase 213 — designation salary auto-sync removed' AS status;
