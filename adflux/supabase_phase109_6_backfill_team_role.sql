-- supabase_phase109_6_backfill_team_role.sql
-- Phase 109.6 (2026-06-01) — heal field reps with a NULL team_role.
--
-- Root cause: the OLD convert-to-user flow (OfferDetailModal before
-- Phase 109.5) inserted users with `role` set but `team_role` left NULL.
-- The admin dashboard "Reps in field" card keys on `users.role`, while
-- the Team Dashboard rep list keys on `users.team_role IN
-- ('sales','sales_manager','telecaller')`. So a NULL-team_role rep
-- (e.g. Abhinav, converted by the old flow) shows on the admin card but
-- is INVISIBLE on the Team Dashboard.
--
-- Fix: set team_role = role for the two field roles where it's missing.
-- ONLY touches rows where team_role IS NULL — never overwrites an
-- intentional assignment (e.g. a sales rep promoted to 'sales_manager'
-- already has team_role set, so it's skipped). Phase 109.5 already stops
-- new converts from landing in this state. Idempotent (re-run = no-op).

-- ─── Diagnostic: who is affected (run, eyeball, then the UPDATE) ──────
SELECT id, name, role, team_role, is_active
  FROM public.users
 WHERE team_role IS NULL
   AND role IN ('sales', 'telecaller')
 ORDER BY name;

-- ─── Backfill ────────────────────────────────────────────────────────
UPDATE public.users
   SET team_role = role
 WHERE team_role IS NULL
   AND role IN ('sales', 'telecaller');

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY — expect 0 field reps left with a NULL team_role, and
--     Abhinav now carries team_role = 'sales' ───────────────────────
SELECT
  (SELECT count(*) FROM public.users
     WHERE team_role IS NULL AND role IN ('sales','telecaller'))   AS still_null_field_reps;  -- expect 0

SELECT id, name, role, team_role, is_active
  FROM public.users
 WHERE name ILIKE '%abhinav%';
