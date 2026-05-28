-- supabase_phase87_5b_1_rpc_null_role_fix.sql
--
-- Phase 87.5b.1 — hotfix the Phase 87.5b RPC role gates.
--
-- BUG
-- ───
-- Phase 87.5b shipped public.accept_user_profile() and
-- public.unaccept_user_profile() with a role check like:
--
--   IF public.get_my_role() NOT IN ('admin', 'co_owner', 'hr') THEN
--     RAISE EXCEPTION ... USING ERRCODE = '42501';
--   END IF;
--
-- When `get_my_role()` returns NULL (JWT-less context — e.g. a
-- cron job, a service-role bypass, or a SET LOCAL ROLE
-- authenticated test without a JWT), the comparison
-- `NULL NOT IN ('admin','co_owner','hr')` evaluates to NULL in
-- Postgres 3-valued logic. `IF NULL THEN ...` does NOT execute
-- the block. Result: the role gate is silently bypassed.
--
-- In production with a real PostgREST + non-admin JWT, the role
-- IS a non-NULL string ('sales', 'agency', 'telecaller', etc.) →
-- check fires correctly → 42501. So real reps still cannot
-- accept their own profile. But the gap is real and a hotfix is
-- the right call before any cron / edge function calls these
-- RPCs from a JWT-less context.
--
-- FIX
-- ───
-- Add an explicit `IS NULL` short-circuit:
--
--   IF public.get_my_role() IS NULL
--      OR public.get_my_role() NOT IN ('admin', 'co_owner', 'hr') THEN
--     RAISE EXCEPTION ...
--   END IF;
--
-- Function bodies are otherwise byte-identical to Phase 87.5b.
--
-- IDEMPOTENCY
-- ───────────
-- `CREATE OR REPLACE FUNCTION` × 2. Re-runnable. No new objects.
-- No table mutation. No data write.
--
-- SCOPE
-- ─────
-- This migration closes the Phase 87.5b NULL-role bypass only.
-- It does NOT touch the 3 columns, the column-pin policy, the
-- VERIFY pattern, or anything outside the 2 function bodies.


CREATE OR REPLACE FUNCTION public.accept_user_profile(
  p_user_id uuid,
  p_note    text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;


CREATE OR REPLACE FUNCTION public.unaccept_user_profile(
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;

NOTIFY pgrst, 'reload schema';


-- ───────────── VERIFY ─────────────
-- Run all 3 after applying. Each must return the expected result.
--
-- 1. Function definitions now contain the NULL guard (2 rows,
--    both `has_null_guard` = true):
--
--    SELECT proname,
--           pg_get_functiondef(oid) ~ 'IS NULL' AS has_null_guard
--      FROM pg_proc
--     WHERE proname IN ('accept_user_profile', 'unaccept_user_profile')
--     ORDER BY proname;
--    -- Expected: 2 rows, has_null_guard=true on both
--
-- 2. JWT-less call now raises 42501 instead of 22004 (the role
--    gate fires BEFORE the p_user_id NULL check):
--
--    BEGIN;
--    SET LOCAL ROLE authenticated;
--    SELECT public.accept_user_profile(
--      gen_random_uuid(),   -- non-NULL p_user_id so the role
--                            -- gate is the only thing in the way
--      'verify'
--    );
--    ROLLBACK;
--    -- Expected: ERROR 42501 (permission denied — admin /
--    --          co_owner / hr only)
--
-- 3. Phase 87.5b column-pin policy still has 10 IS DISTINCT FROM
--    clauses (note: Postgres normalizes `IS NOT DISTINCT FROM`
--    to `NOT (X IS DISTINCT FROM Y)`. The substring `IS DISTINCT
--    FROM` matches both the new HR pins and the Phase 97.1 pins
--    exactly once per column):
--
--    SELECT polname,
--           array_length(
--             regexp_split_to_array(
--               pg_get_expr(polwithcheck, polrelid),
--               'IS DISTINCT FROM'
--             ), 1
--           ) - 1 AS pinned_count
--      FROM pg_policy
--     WHERE polrelid = 'public.users'::regclass
--       AND polname  = 'users_self_update_avatar';
--    -- Expected: pinned_count = 10


-- ───────────── ROLLBACK ─────────────
-- Re-applies the Phase 87.5b function bodies byte-identical
-- (drops the NULL guard, restores 3VL short-circuit gap).
--
--   CREATE OR REPLACE FUNCTION public.accept_user_profile(
--     p_user_id uuid,
--     p_note    text DEFAULT NULL
--   )
--   RETURNS void
--   LANGUAGE plpgsql
--   SECURITY DEFINER
--   SET search_path = public, pg_temp
--   AS $$
--   BEGIN
--     IF public.get_my_role() NOT IN ('admin', 'co_owner', 'hr') THEN
--       RAISE EXCEPTION 'permission denied — admin / co_owner / hr only'
--         USING ERRCODE = '42501';
--     END IF;
--     IF p_user_id IS NULL THEN
--       RAISE EXCEPTION 'p_user_id required' USING ERRCODE = '22004';
--     END IF;
--     UPDATE public.users
--        SET hr_accepted_at     = COALESCE(hr_accepted_at, now()),
--            hr_accepted_by     = COALESCE(hr_accepted_by, auth.uid()),
--            hr_acceptance_note = COALESCE(p_note, hr_acceptance_note)
--      WHERE id = p_user_id;
--   END;
--   $$;
--
--   CREATE OR REPLACE FUNCTION public.unaccept_user_profile(
--     p_user_id uuid
--   )
--   RETURNS void
--   LANGUAGE plpgsql
--   SECURITY DEFINER
--   SET search_path = public, pg_temp
--   AS $$
--   BEGIN
--     IF public.get_my_role() NOT IN ('admin', 'co_owner') THEN
--       RAISE EXCEPTION 'permission denied — admin / co_owner only'
--         USING ERRCODE = '42501';
--     END IF;
--     IF p_user_id IS NULL THEN
--       RAISE EXCEPTION 'p_user_id required' USING ERRCODE = '22004';
--     END IF;
--     UPDATE public.users
--        SET hr_accepted_at     = NULL,
--            hr_accepted_by     = NULL,
--            hr_acceptance_note = NULL
--      WHERE id = p_user_id;
--   END;
--   $$;
--
--   NOTIFY pgrst, 'reload schema';
