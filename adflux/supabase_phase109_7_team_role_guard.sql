-- supabase_phase109_7_team_role_guard.sql
-- Phase 109.7 (2026-06-01) — permanent guard: a field rep can NEVER again
-- end up with a NULL team_role, regardless of which path created them.
--
-- Background: the admin "Reps in field" card keys on users.role; the Team
-- Dashboard keys on users.team_role. When the two drift, a rep shows on
-- one surface but not the other (Phase 109.6 healed Abhinav, Phase 109.5
-- fixed the convert path). This trigger makes the invariant impossible to
-- break at the DB layer — independent of the frontend path (convert,
-- Add-Member modal, /hr/new-user, raw SQL, future code):
--
--   role IN ('sales','telecaller')  ⇒  team_role is never NULL.
--
-- It ONLY fills a NULL — it never overwrites an explicit team_role, so a
-- deliberate 'sales_manager' (Jubin/Renuka) is untouched. Agency/admin/
-- co_owner/hr/accounts/staff are left alone (they don't map 1:1 to a
-- field team_role and aren't on the Team Dashboard). Idempotent.
--
-- BEFORE INSERT OR UPDATE — runs before the existing AFTER INSERT
-- auto_create_incentive_profile trigger, no interaction with it.

CREATE OR REPLACE FUNCTION public.users_sync_team_role()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.team_role IS NULL AND NEW.role IN ('sales', 'telecaller') THEN
    NEW.team_role := NEW.role;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_sync_team_role ON public.users;
CREATE TRIGGER trg_users_sync_team_role
  BEFORE INSERT OR UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.users_sync_team_role();

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────────
-- 1. Trigger present (expect 1 row):
SELECT tgname
  FROM pg_trigger
 WHERE tgrelid = 'public.users'::regclass
   AND tgname = 'trg_users_sync_team_role';

-- 2. No field rep left with a NULL team_role (expect 0):
SELECT count(*) AS null_field_reps
  FROM public.users
 WHERE team_role IS NULL AND role IN ('sales', 'telecaller');

-- 3. Live proof — a sales user with team_role explicitly NULLed is
--    auto-refilled by the trigger (this UPDATE sets NULL, the trigger
--    flips it back to 'sales' before the row is written; expect the row
--    to come back with team_role = role). Harmless no-op if the row's
--    team_role already equals role.
--    (Run only if you want to see it work — uses the first sales user.)
-- UPDATE public.users SET team_role = NULL
--  WHERE id = (SELECT id FROM public.users WHERE role='sales' LIMIT 1)
--  RETURNING name, role, team_role;
