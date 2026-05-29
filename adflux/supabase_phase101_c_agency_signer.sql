-- =====================================================================
-- ADFLUX → UNTITLED OS  •  PHASE 101.C
-- Agency default proposal signer — SQL backend
-- 2026-05-29 (Brijesh Solanki)
-- =====================================================================
--
-- WHY (owner directive 2026-05-29):
--   Agency users can create government proposals (Auto Hood + GSRTC LED)
--   but Step 2 "Signed by" is still manual. Admin wants to assign a
--   default proposal signer per agency user. Agency must NOT pick;
--   the wizard auto-seeds + locks Step 2 to the admin-assigned signer.
--   Agency must NOT become a signer themselves — only existing
--   signing_authority users (Brijesh + Vishal today) qualify as targets.
--
-- WHAT THIS FILE DOES (idempotent, ship BEFORE Phase 101.C.JSX):
--   1. users.default_signer_user_id uuid — new column, nullable, FK to
--      users(id) ON DELETE SET NULL.
--   2. validate_default_signer() trigger function — BEFORE INSERT OR
--      UPDATE OF default_signer_user_id. Blocks writes where the target
--      doesn't exist, is inactive, or isn't a signing_authority user.
--      SECURITY DEFINER + SET search_path per Phase 97.2 doctrine.
--   3. NO backfill (owner C-2: admin will set Hamesh's default via UI
--      after Phase 101.C.JSX deploy).
--   4. NO CASCADE on demotion (owner C-3: defer signer-demotion auto-
--      null to Phase 101.C.1 hotfix if needed).
--
-- WHAT THIS FILE DOES NOT TOUCH:
--   - users.signing_authority column (Phase 5 — unchanged)
--   - useSigners hook source query (filters signing_authority=true)
--   - Existing quote rows with saved signer_user_id (snapshots preserved)
--   - Wizard / Step2DateSigner / TeamMemberModal (Phase 101.C.JSX)
--   - Agency commission / dashboard / earnings (Phase 101.A1 + A2 + B)
-- =====================================================================


-- ─────────────────────────────────────────────────────────────────────
-- (1) users.default_signer_user_id column
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS default_signer_user_id uuid;

-- FK constraint. Postgres has no IF NOT EXISTS for FOREIGN KEY, so
-- wrap in DO block that catches duplicate_object on re-run.
-- ON DELETE SET NULL: if a signer user is hard-deleted, agency rows
-- pointing at them clear silently. soft-deactivate via is_active=false
-- doesn't trigger this (would only fire if someone runs DELETE
-- against the row, which is rare).
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.users
      ADD CONSTRAINT users_default_signer_fk
      FOREIGN KEY (default_signer_user_id)
      REFERENCES public.users(id)
      ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;


-- ─────────────────────────────────────────────────────────────────────
-- (2) Validation trigger — block writes to invalid signer targets
-- ─────────────────────────────────────────────────────────────────────
-- Owner Q-101.C-1: include validation trigger.
--
-- Fires BEFORE INSERT OR UPDATE OF default_signer_user_id. Validates
-- that the target row:
--   a) exists,
--   b) is_active = true,
--   c) signing_authority = true.
--
-- If target is NULL, skip (clearing a default is allowed).
--
-- SECURITY DEFINER + SET search_path = public, pg_temp per Phase 97.2
-- doctrine. SECDEF here is belt-and-braces: admin TeamMemberModal
-- writes already have full RLS access, but SECDEF + search_path means
-- no caller can inject a different `users` table via search_path
-- manipulation and bypass the validation.
--
-- Scope: only touches the SELECT against users WHERE id =
-- NEW.default_signer_user_id. No side-effects, no writes.
--
-- AT WRITE TIME ONLY: if admin later flips target.signing_authority
-- from true to false, existing agency rows keep their stale pointer.
-- Owner C-3 deferred CASCADE to potential Phase 101.C.1 hotfix.

CREATE OR REPLACE FUNCTION public.validate_default_signer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_active boolean;
  v_signer boolean;
BEGIN
  -- Clearing the default is always allowed.
  IF NEW.default_signer_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Self-assignment block: a user cannot be their own default signer.
  -- Mostly a guard against an admin accidentally pointing an agency
  -- user to themselves via the dropdown (agency wouldn't appear in
  -- the UI signers list, but defense-in-depth at DB level).
  IF NEW.default_signer_user_id = NEW.id THEN
    RAISE EXCEPTION 'default_signer_user_id cannot equal the user''s own id'
      USING ERRCODE = '23514';
  END IF;

  -- Target existence + flags.
  SELECT is_active, signing_authority
    INTO v_active, v_signer
    FROM public.users
   WHERE id = NEW.default_signer_user_id;

  IF v_active IS NULL THEN
    RAISE EXCEPTION 'default_signer_user_id target % does not exist',
      NEW.default_signer_user_id
      USING ERRCODE = '23503';
  END IF;

  IF NOT v_active OR NOT COALESCE(v_signer, false) THEN
    RAISE EXCEPTION 'default_signer_user_id target % is not an active signing-authority user',
      NEW.default_signer_user_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────
-- (3) Trigger binding — BEFORE INSERT OR UPDATE OF default_signer_user_id
-- ─────────────────────────────────────────────────────────────────────
-- WHEN clause narrows to actual writes of the column. Skipping the
-- function call entirely when the column isn't being written keeps
-- normal user updates (name / email / role flips / commission %)
-- fast and avoids needless SELECT-against-users on every update.

DROP TRIGGER IF EXISTS users_validate_default_signer ON public.users;
CREATE TRIGGER users_validate_default_signer
  BEFORE INSERT OR UPDATE OF default_signer_user_id ON public.users
  FOR EACH ROW
  WHEN (NEW.default_signer_user_id IS NOT NULL)
  EXECUTE FUNCTION public.validate_default_signer();


-- ─────────────────────────────────────────────────────────────────────
-- Refresh PostgREST schema cache
-- ─────────────────────────────────────────────────────────────────────

NOTIFY pgrst, 'reload schema';


-- =====================================================================
-- VERIFY (paste each block in Studio after applying)
-- =====================================================================
--
-- V1: column present
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND table_name = 'users'
--      AND column_name = 'default_signer_user_id';
--   Expected: 1 row, data_type=uuid, is_nullable=YES
--
-- V2: FK constraint present
--   SELECT conname FROM pg_constraint
--    WHERE conname = 'users_default_signer_fk';
--   Expected: 1 row
--
-- V3: validate function present + SECDEF + search_path
--   SELECT
--     prosecdef                          AS is_secdef,
--     proconfig                          AS configs
--     FROM pg_proc
--    WHERE proname = 'validate_default_signer';
--   Expected: 1 row, is_secdef=t,
--             configs contains 'search_path=public, pg_temp'
--
-- V4: trigger present + WHEN clause
--   SELECT
--     tgname,
--     pg_get_triggerdef(oid) ~ 'NEW\.default_signer_user_id IS NOT NULL' AS has_when
--     FROM pg_trigger
--    WHERE tgname = 'users_validate_default_signer';
--   Expected: 1 row, has_when=t
--
-- V5 (live smoke — happy path): set Hamesh's default to Brijesh.
--   First, find both UUIDs:
--     SELECT id, name, role, signing_authority FROM public.users
--      WHERE name IN ('Hamesh Modi', 'Brijesh Solanki')
--        AND is_active = true;
--   Then:
--     UPDATE public.users
--        SET default_signer_user_id = '<BRIJESH_UUID>'::uuid
--      WHERE id = '<HAMESH_UUID>'::uuid;
--   Expected: 1 row updated, no error.
--   Then re-read:
--     SELECT name, default_signer_user_id
--       FROM public.users WHERE name = 'Hamesh Modi';
--   Expected: default_signer_user_id = Brijesh's UUID.
--
-- V6 (live smoke — error path: target lacks signing_authority): try
-- setting Hamesh's default to a sales rep.
--   Find sales rep:
--     SELECT id, name, signing_authority FROM public.users
--      WHERE name = 'Dixita';
--   Then:
--     UPDATE public.users
--        SET default_signer_user_id = '<DIXITA_UUID>'::uuid
--      WHERE name = 'Hamesh Modi';
--   Expected: ERROR 23514 "default_signer_user_id target ... is not
--   an active signing-authority user".
--
-- V7 (live smoke — error path: self-assignment).
--   UPDATE public.users
--      SET default_signer_user_id = id
--    WHERE name = 'Hamesh Modi';
--   Expected: ERROR 23514 "cannot equal the user's own id".
--
-- V8 (live smoke — clearing): set back to NULL.
--   UPDATE public.users
--      SET default_signer_user_id = NULL
--    WHERE name = 'Hamesh Modi';
--   Expected: 1 row updated, no error.
--   (Owner C-2: no backfill — after V8, Hamesh stays NULL until admin
--    sets via UI after Phase 101.C.JSX ships.)
--
-- V9 (sanity — non-agency users unaffected):
--   UPDATE public.users SET name = name WHERE role = 'sales';
--   Expected: N rows updated, no trigger fire (column unchanged).
--
-- =====================================================================
-- ROLLBACK (paste in Studio only if VERIFY fails)
-- =====================================================================
--
-- a) Drop the trigger + function
--   DROP TRIGGER IF EXISTS users_validate_default_signer ON public.users;
--   DROP FUNCTION IF EXISTS public.validate_default_signer();
--
-- b) Drop the FK constraint
--   ALTER TABLE public.users
--     DROP CONSTRAINT IF EXISTS users_default_signer_fk;
--
-- c) Drop the column (this also clears any value already set)
--   ALTER TABLE public.users
--     DROP COLUMN IF EXISTS default_signer_user_id;
--
-- d) Refresh PostgREST
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
