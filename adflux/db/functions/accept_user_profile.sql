-- ============================================================================
-- db/functions/accept_user_profile.sql — CANONICAL HOME (Phase 178 / Stage 2)
-- ============================================================================
-- ⭐ The ONE place accept_user_profile lives (§71). Was in phase87_5b + phase87_5b_1.
-- WHAT: HR sign-off on a rep profile (§87.5b) — stamps hr_accepted_at/by/note.
-- 🔒 LOCKED (security):
--   • §87.5b.1 NULL short-circuit — `get_my_role() IS NULL OR NOT IN (...)`. The §41
--     foot-gun: without the IS NULL arm, a JWT-less/no-users-row caller gets
--     NULL NOT IN → NULL → IF skips → gate BYPASSED. KEEP the IS NULL arm.
--   • Gate = admin / co_owner / hr (HR may accept). 42501 on deny.
--   • COALESCE keeps the EARLIEST acceptance metadata on re-call (idempotent).
-- PROVENANCE: live dump 2026-06-24 (phase87_5b_1 body). SECURITY DEFINER + pg_temp.
-- SUPERSEDES: supabase_phase87_5b_hr_acceptance.sql · supabase_phase87_5b_1_rpc_null_role_fix.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.accept_user_profile(p_user_id uuid, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Phase 87.5b.1 — NULL guard added so a JWT-less caller can't
  -- slip past the role gate via 3-valued-logic short-circuit.
  IF public.get_my_role() IS NULL
     OR public.get_my_role() NOT IN ('admin', 'co_owner', 'hr') THEN
    RAISE EXCEPTION 'permission denied — admin / co_owner / hr only'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id required' USING ERRCODE = '22004';
  END IF;

  UPDATE public.users
     SET hr_accepted_at     = COALESCE(hr_accepted_at, now()),
         hr_accepted_by     = COALESCE(hr_accepted_by, auth.uid()),
         hr_acceptance_note = COALESCE(p_note, hr_acceptance_note)
   WHERE id = p_user_id;
END;
$function$;

NOTIFY pgrst, 'reload schema';
-- VERIFY: LIKE '%IS NULL%' (null guard) AND '%''admin'', ''co_owner'', ''hr''%' (gate)
--         AND '%COALESCE(hr_accepted_at%' (idempotent) — all TRUE.
