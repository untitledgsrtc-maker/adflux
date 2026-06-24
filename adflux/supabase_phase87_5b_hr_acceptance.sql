-- supabase_phase87_5b_hr_acceptance.sql
--
-- Phase 87.5b — one-time HR sign-off on rep profile/offer bundle.
--
-- BACKGROUND
-- ──────────
-- Phase 87.5 (commit 4cb4250) shipped the rep profile picture
-- upload and rep-side `/my-offer` view. The original owner
-- directive from 24 May 2026 also asked for an HR acceptance
-- step:
--   "in profile that can see their full details while they submit
--    the offer and accept the offer by HR ..."
-- Only the upload + view pieces shipped. This migration closes the
-- HR sign-off gap with the minimum viable schema + RPCs.
--
-- OWNER DECISIONS (2026-05-28)
-- ────────────────────────────
--   B  : one-time sign-off, not a per-edit approval workflow
--   Q1 : HR action surface lives on RepProfileV2 (/people/:userId)
--        only. Route widens to admin / co_owner / hr — no global
--        RequirePrivileged change.
--   Q2 : Include `hr_acceptance_note text` for free-form context.
--   Q3 : Include admin/co_owner-only unaccept path so mistaken
--        acceptances can be reversed. HR cannot reverse.
--
-- WHAT THIS MIGRATION DOES
-- ────────────────────────
--   1. Add 3 columns to `public.users`:
--        hr_accepted_at      timestamptz
--        hr_accepted_by      uuid REFERENCES users(id)
--        hr_acceptance_note  text
--   2. Extend the Phase 97.1 column-pin policy
--      `users_self_update_avatar` to also pin the 3 new HR fields,
--      so a rep cannot self-flip `hr_accepted_at` via PostgREST.
--      Result: 7 existing explicit pins (role, team_role,
--      segment_access, manager_id, is_active, email,
--      signing_authority) + 3 new = 10 `IS NOT DISTINCT FROM`
--      clauses, plus the implicit `id = auth.uid()` equality
--      (not counted by the regex VERIFY).
--   3. Create SECURITY DEFINER RPC `accept_user_profile(uuid, text)`
--      gated by `get_my_role() IN ('admin','co_owner','hr')`. Sets
--      `hr_accepted_at = now()` + `hr_accepted_by = auth.uid()` +
--      optional `hr_acceptance_note`. Idempotent — COALESCE keeps
--      the earliest acceptance fields when re-called.
--   4. Create SECURITY DEFINER RPC `unaccept_user_profile(uuid)`
--      gated by `get_my_role() IN ('admin','co_owner')`. Clears
--      all 3 fields. HR cannot call this.
--   5. GRANT EXECUTE on both RPCs to `authenticated` so PostgREST
--      can route the call. The internal role check is the real gate.
--
-- IDEMPOTENCY
-- ───────────
-- `ADD COLUMN IF NOT EXISTS`, `DROP POLICY IF EXISTS` then `CREATE
-- POLICY`, `CREATE OR REPLACE FUNCTION`. Re-runnable.
--
-- SCOPE
-- ─────
-- This migration closes Phase 87.5b only. It does NOT:
--   * Build a profile-edit approval workflow
--   * Build avatar moderation
--   * Touch Phase 76.2 / 87.6 / P&L / TDS / unrelated cleanup
--   * Block rep daily work — `hr_accepted_at = NULL` is the default
--     state for every existing user and does not gate anything
--   * Modify Phase 87.5 upload pipeline — profile_image_url stays
--     non-pinned so rep can still self-upload via /my-offer


-- ─── 1. Add columns ─────────────────────────────────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS hr_accepted_at timestamptz;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS hr_accepted_by uuid REFERENCES public.users(id);

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS hr_acceptance_note text;


-- ─── 2. Extend Phase 97.1 column-pin policy ────────────────────────
-- 8 original pins + 3 new HR-acceptance pins = 11 total. Subquery
-- pattern + IS NOT DISTINCT FROM preserves Phase 97.1 semantics for
-- the 8 existing columns byte-identical; only the 3 acceptance pins
-- are added.
DROP POLICY IF EXISTS users_self_update_avatar ON public.users;

CREATE POLICY users_self_update_avatar ON public.users
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND role              IS NOT DISTINCT FROM (SELECT u.role              FROM public.users u WHERE u.id = auth.uid())
    AND team_role         IS NOT DISTINCT FROM (SELECT u.team_role         FROM public.users u WHERE u.id = auth.uid())
    AND segment_access    IS NOT DISTINCT FROM (SELECT u.segment_access    FROM public.users u WHERE u.id = auth.uid())
    AND manager_id        IS NOT DISTINCT FROM (SELECT u.manager_id        FROM public.users u WHERE u.id = auth.uid())
    AND is_active         IS NOT DISTINCT FROM (SELECT u.is_active         FROM public.users u WHERE u.id = auth.uid())
    AND email             IS NOT DISTINCT FROM (SELECT u.email             FROM public.users u WHERE u.id = auth.uid())
    AND signing_authority IS NOT DISTINCT FROM (SELECT u.signing_authority FROM public.users u WHERE u.id = auth.uid())
    -- Phase 87.5b — HR sign-off fields cannot be self-flipped.
    AND hr_accepted_at     IS NOT DISTINCT FROM (SELECT u.hr_accepted_at     FROM public.users u WHERE u.id = auth.uid())
    AND hr_accepted_by     IS NOT DISTINCT FROM (SELECT u.hr_accepted_by     FROM public.users u WHERE u.id = auth.uid())
    AND hr_acceptance_note IS NOT DISTINCT FROM (SELECT u.hr_acceptance_note FROM public.users u WHERE u.id = auth.uid())
  );


-- ─── 3. RPC: accept_user_profile ───────────────────────────────────
-- admin / co_owner / hr can sign off on any rep's profile bundle.
-- COALESCE on each field keeps the earliest acceptance metadata if
-- the RPC is re-called by mistake; admin must explicitly unaccept
-- + re-accept to refresh `hr_accepted_at`.
-- -------------------------------------------------------------------------
-- accept_user_profile REMOVED from this file (Phase 178). Canonical: db/functions/accept_user_profile.sql
-- Do NOT re-add (§71). Trigger/grant wiring stays.
-- -------------------------------------------------------------------------


-- ─── 4. RPC: unaccept_user_profile ─────────────────────────────────
-- admin / co_owner only. HR cannot reverse their own acceptance.
-- -------------------------------------------------------------------------
-- unaccept_user_profile REMOVED from this file (Phase 178). Canonical: db/functions/unaccept_user_profile.sql
-- Do NOT re-add (§71). Trigger/grant wiring stays.
-- -------------------------------------------------------------------------


-- ─── 5. Grants ─────────────────────────────────────────────────────
-- PostgREST exposes any function with EXECUTE on `authenticated`.
-- Internal `get_my_role()` check is the real gate (see Phase 97.A2
-- for the same pattern on enqueue_push — and the inverse, REVOKEd
-- there because that function's body lacks an internal role check).
GRANT EXECUTE ON FUNCTION public.accept_user_profile(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unaccept_user_profile(uuid)     TO authenticated;

NOTIFY pgrst, 'reload schema';


-- ───────────── VERIFY ─────────────
-- Run all 5 in Supabase Studio after applying. Each must return the
-- expected result. If any fails, ROLLBACK (see block below).
--
-- 1. All 3 new columns present (3 rows):
--
--    SELECT column_name, data_type
--      FROM information_schema.columns
--     WHERE table_schema = 'public'
--       AND table_name   = 'users'
--       AND column_name  IN ('hr_accepted_at', 'hr_accepted_by', 'hr_acceptance_note')
--     ORDER BY column_name;
--    -- Expected: 3 rows
--
-- 2. Phase 97.1 policy now has 10 IS-NOT-DISTINCT-FROM column pins
--    (1 row, `pinned_count` = 10). The implicit `id = auth.uid()`
--    equality is NOT counted by the regex — it lives in the
--    leading clause, not as a subquery pin. Conceptually the row
--    has 11 immutable columns (id + 7 original + 3 new), but
--    pg_get_expr regex matches only the 10 explicit subquery pins.
--
--    SELECT polname,
--           array_length(
--             regexp_split_to_array(
--               pg_get_expr(polwithcheck, polrelid),
--               'IS NOT DISTINCT FROM'
--             ), 1
--           ) - 1 AS pinned_count
--      FROM pg_policy
--     WHERE polrelid = 'public.users'::regclass
--       AND polname  = 'users_self_update_avatar';
--    -- Expected: pinned_count = 10
--
-- 3. Both RPCs present + SECURITY DEFINER + owned by postgres
--    (2 rows):
--
--    SELECT proname,
--           prosecdef                 AS is_secdef,
--           pg_get_userbyid(proowner) AS owner_role
--      FROM pg_proc
--     WHERE proname IN ('accept_user_profile', 'unaccept_user_profile')
--     ORDER BY proname;
--    -- Expected: 2 rows, both is_secdef=true, owner_role=postgres
--
-- 4. Role gate works on accept_user_profile (transactional):
--
--    BEGIN;
--    SET LOCAL ROLE authenticated;
--    SELECT public.accept_user_profile(
--      (SELECT id FROM public.users ORDER BY created_at LIMIT 1),
--      'verify'
--    );
--    ROLLBACK;
--    -- Expected: 42501 because the test SET LOCAL ROLE auth context
--    -- has no JWT → get_my_role() returns NULL → fails the IN check.
--    -- In production, an authenticated admin / co_owner / hr session
--    -- succeeds because the JWT-derived role passes.
--
-- 5. PostgREST schema reload landed (any SELECT works after the
--    NOTIFY; this confirms session health):
--
--    SELECT 1;
--    -- Expected: 1


-- ───────────── ROLLBACK ─────────────
-- Default rollback (non-destructive): drops the 2 RPCs + restores
-- the Phase 97.1 column-pin policy byte-identical. The 3 new
-- columns stay in place (NULL on every row — no data loss, no
-- migration debt).
--
--   DROP FUNCTION IF EXISTS public.accept_user_profile(uuid, text);
--   DROP FUNCTION IF EXISTS public.unaccept_user_profile(uuid);
--
--   DROP POLICY IF EXISTS users_self_update_avatar ON public.users;
--   CREATE POLICY users_self_update_avatar ON public.users
--     FOR UPDATE
--     USING (id = auth.uid())
--     WITH CHECK (
--       id = auth.uid()
--       AND role              IS NOT DISTINCT FROM (SELECT u.role              FROM public.users u WHERE u.id = auth.uid())
--       AND team_role         IS NOT DISTINCT FROM (SELECT u.team_role         FROM public.users u WHERE u.id = auth.uid())
--       AND segment_access    IS NOT DISTINCT FROM (SELECT u.segment_access    FROM public.users u WHERE u.id = auth.uid())
--       AND manager_id        IS NOT DISTINCT FROM (SELECT u.manager_id        FROM public.users u WHERE u.id = auth.uid())
--       AND is_active         IS NOT DISTINCT FROM (SELECT u.is_active         FROM public.users u WHERE u.id = auth.uid())
--       AND email             IS NOT DISTINCT FROM (SELECT u.email             FROM public.users u WHERE u.id = auth.uid())
--       AND signing_authority IS NOT DISTINCT FROM (SELECT u.signing_authority FROM public.users u WHERE u.id = auth.uid())
--     );
--   NOTIFY pgrst, 'reload schema';
--
-- Destructive rollback (data loss — only if owner explicitly wants
-- the 3 columns gone):
--
--   ALTER TABLE public.users DROP COLUMN IF EXISTS hr_acceptance_note;
--   ALTER TABLE public.users DROP COLUMN IF EXISTS hr_accepted_by;
--   ALTER TABLE public.users DROP COLUMN IF EXISTS hr_accepted_at;
--   NOTIFY pgrst, 'reload schema';
