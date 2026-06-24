-- ============================================================================
-- db/functions/auto_create_incentive_profile.sql — CANONICAL HOME (Phase 178 / Stage 2)
-- ============================================================================
-- ⭐ The ONE place auto_create_incentive_profile lives (§71). Was in phase11g + phase101_a1.
-- WHAT: AFTER-INSERT trigger on users. For a NEW role='sales' user with no profile,
--   seeds a staff_incentive_profiles row from incentive_settings defaults.
-- 🔒 LOCKED: role='sales' ONLY (other roles get no profile); idempotent (skips if a
--   profile already exists); defaults pulled from incentive_settings with COALESCE
--   fallbacks (multiplier 5, new 0.05, renewal 0.02, flat 10000). PLAIN (not DEFINER)
--   — that's the live shape; don't add SECURITY DEFINER without owner sign-off.
-- PROVENANCE: live dump 2026-06-24 (phase101_a1 body). Trigger wiring in phase files.
-- SUPERSEDES: supabase_phase11g_agency_role_parity.sql · supabase_phase101_a1_agency_split.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.auto_create_incentive_profile()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  s incentive_settings%ROWTYPE;
BEGIN
  IF NEW.role NOT IN ('sales') THEN
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
$function$;

NOTIFY pgrst, 'reload schema';
-- VERIFY (read-only): all TRUE. not_security_definer is the LOCK — this fn must stay
-- PLAIN; a TRUE→FALSE flip means someone added SECURITY DEFINER (owner sign-off only).
-- SELECT
--   pg_get_functiondef(p.oid) LIKE '%NEW.role NOT IN (''sales'')%'           AS sales_only,
--   pg_get_functiondef(p.oid) LIKE '%staff_incentive_profiles WHERE user_id%' AS idempotent,
--   NOT p.prosecdef                                                          AS not_security_definer
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = 'auto_create_incentive_profile';
