-- Phase 428 (owner yes 2026-10-19): deactivating a person (users.is_active=false) now also blocks sign-in
-- (auth.users.banned_until = infinity); re-activating lifts it. Existing deactivated people are blocked too.
-- Idempotent. UNDO: DROP TRIGGER trg_users_block_signin ON public.users; UPDATE auth.users SET banned_until=NULL WHERE id IN (SELECT id FROM public.users WHERE NOT is_active);
CREATE OR REPLACE FUNCTION public.users_block_signin() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
BEGIN
  IF NEW.is_active IS FALSE THEN
    UPDATE auth.users SET banned_until = 'infinity' WHERE id = NEW.id;
  ELSE
    UPDATE auth.users SET banned_until = NULL WHERE id = NEW.id AND banned_until IS NOT NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.users_block_signin() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_users_block_signin ON public.users;
CREATE TRIGGER trg_users_block_signin AFTER UPDATE OF is_active ON public.users
  FOR EACH ROW WHEN (OLD.is_active IS DISTINCT FROM NEW.is_active) EXECUTE FUNCTION public.users_block_signin();
UPDATE auth.users SET banned_until = 'infinity' WHERE id IN (SELECT id FROM public.users WHERE is_active IS FALSE) AND banned_until IS NULL;
NOTIFY pgrst, 'reload schema';
-- VERIFY: select count(*) from auth.users a join public.users u on u.id=a.id where not u.is_active and a.banned_until is null;  -- expect 0
