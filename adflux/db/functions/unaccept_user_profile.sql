-- ============================================================================
-- db/functions/unaccept_user_profile.sql — CANONICAL HOME (Phase 178 / Stage 2)
-- ============================================================================
-- ⭐ The ONE place unaccept_user_profile lives (§71). Was in phase87_5b + phase87_5b_1.
-- WHAT: reverses an HR sign-off (§87.5b) — clears hr_accepted_at/by/note.
-- 🔒 LOCKED (security):
--   • §87.5b.1 NULL short-circuit (`get_my_role() IS NULL OR NOT IN (...)`) — the §41
--     guard. KEEP the IS NULL arm.
--   • Gate = admin / co_owner ONLY — HR can accept but CANNOT reverse (narrower than
--     accept_user_profile, which admits hr). Do NOT add 'hr' here.
-- PROVENANCE: live dump 2026-06-24 (phase87_5b_1 body). SECURITY DEFINER + pg_temp.
-- SUPERSEDES: supabase_phase87_5b_hr_acceptance.sql · supabase_phase87_5b_1_rpc_null_role_fix.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.unaccept_user_profile(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Phase 87.5b.1 — same NULL guard as accept_user_profile.
  IF public.get_my_role() IS NULL
     OR public.get_my_role() NOT IN ('admin', 'co_owner') THEN
    RAISE EXCEPTION 'permission denied — admin / co_owner only'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id required' USING ERRCODE = '22004';
  END IF;

  UPDATE public.users
     SET hr_accepted_at     = NULL,
         hr_accepted_by     = NULL,
         hr_acceptance_note = NULL
   WHERE id = p_user_id;
END;
$function$;

NOTIFY pgrst, 'reload schema';
-- VERIFY: LIKE '%IS NULL%' (null guard) AND '%''admin'', ''co_owner''%' (gate, NO hr) — TRUE.
