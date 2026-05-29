-- =====================================================================
-- ADFLUX → UNTITLED OS  •  PHASE 101.C.SQL.2
-- Drop self-assign block from validate_default_signer trigger
-- 2026-05-29 (Brijesh Solanki)
-- =====================================================================
--
-- WHY (owner directive 2026-05-29, reversal of Phase 101.C original
-- defense-in-depth):
--   Owner wants Hamesh (agency) to sign his own govt proposals. Phase
--   101.C SQL trigger blocked NEW.default_signer_user_id = NEW.id
--   (self-assignment) as a UI redundancy guard. UI dropdown already
--   excluded self via signing_authority filter pre-Path B; Phase
--   101.C.1 + Path B promoted Hamesh signing_authority=true so he now
--   appears in his own dropdown but the DB block fired.
--
-- WHAT THIS FILE DOES (idempotent, 1 op):
--   CREATE OR REPLACE validate_default_signer() WITHOUT the self-id
--   check. All other guards stay:
--     - NULL → early-return (clearing allowed)
--     - target missing → RAISE 23503
--     - target inactive OR signing_authority=false → RAISE 23514
--
-- TRIGGER unchanged (still BEFORE INSERT OR UPDATE OF
-- default_signer_user_id with NULL-skip WHEN clause).
--
-- ROLLBACK: re-paste the Phase 101.C SQL body (includes the
-- self-id IF block).
-- =====================================================================

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

  -- Phase 101.C.SQL.2 — self-assignment block REMOVED. Agency users
  -- who are also signing_authority=true (Phase 101.C.1 + Path B
  -- promote path) may now set themselves as their own default
  -- proposal signer. Govt proposal Step 2 locks to that agency on
  -- their own quotes. Owner directive 2026-05-29.

  -- Target existence + flags (unchanged).
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


NOTIFY pgrst, 'reload schema';


-- =====================================================================
-- VERIFY (paste each block in Studio after applying)
-- =====================================================================
--
-- V1: function body no longer references the self-assign guard.
--   SELECT
--     pg_get_functiondef(oid) ~ 'cannot equal the user''s own id' AS still_blocks_self
--     FROM pg_proc WHERE proname = 'validate_default_signer';
--   Expected: still_blocks_self = false
--
-- V2: function still has the non-signer guard.
--   SELECT
--     pg_get_functiondef(oid) ~ 'not an active signing-authority' AS has_signer_check
--     FROM pg_proc WHERE proname = 'validate_default_signer';
--   Expected: has_signer_check = true
--
-- V3 (live smoke — self-assign now allowed): set Hamesh = Hamesh.
--   UPDATE public.users
--      SET default_signer_user_id = id
--    WHERE name = 'Hamesh Modi';
--   Expected: 1 row updated, no error.
--   Re-read:
--     SELECT name, default_signer_user_id, id FROM public.users
--      WHERE name = 'Hamesh Modi';
--   Expected: default_signer_user_id = id.
--
-- V4 (live smoke — non-signer still blocked): try Hamesh = Dixita.
--   UPDATE public.users
--      SET default_signer_user_id = (SELECT id FROM users WHERE name='Dixita')
--    WHERE name = 'Hamesh Modi';
--   Expected: ERROR 23514 "not an active signing-authority user".
--
-- =====================================================================
-- ROLLBACK (paste in Studio only if VERIFY fails)
-- =====================================================================
--
-- Re-paste Phase 101.C body (function with self-id IF block):
--
-- CREATE OR REPLACE FUNCTION public.validate_default_signer()
-- RETURNS TRIGGER
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- SET search_path = public, pg_temp
-- AS $$
-- DECLARE v_active boolean; v_signer boolean;
-- BEGIN
--   IF NEW.default_signer_user_id IS NULL THEN RETURN NEW; END IF;
--   IF NEW.default_signer_user_id = NEW.id THEN
--     RAISE EXCEPTION 'default_signer_user_id cannot equal the user''s own id'
--       USING ERRCODE = '23514';
--   END IF;
--   SELECT is_active, signing_authority INTO v_active, v_signer
--     FROM public.users WHERE id = NEW.default_signer_user_id;
--   IF v_active IS NULL THEN
--     RAISE EXCEPTION 'default_signer_user_id target % does not exist',
--       NEW.default_signer_user_id USING ERRCODE = '23503';
--   END IF;
--   IF NOT v_active OR NOT COALESCE(v_signer, false) THEN
--     RAISE EXCEPTION 'default_signer_user_id target % is not an active signing-authority user',
--       NEW.default_signer_user_id USING ERRCODE = '23514';
--   END IF;
--   RETURN NEW;
-- END; $$;
--
-- NOTIFY pgrst, 'reload schema';
-- =====================================================================
