-- supabase_phase97_e_users_role_owner_purge.sql
--
-- Phase 97.E — close F-001b.
--
-- ROOT CAUSE
-- ──────────
-- CLAUDE.md §8 has stated for months: "Roles in use: admin, co_owner,
-- sales, agency, telecaller. No `owner` role (DB constraint dropped
-- it)." A 2026-05-28 live audit of `pg_constraint` on `public.users`
-- proves this claim is FALSE. The current constraints are:
--
--   users_role_check:
--     CHECK (role = ANY (ARRAY['admin', 'sales', 'owner', 'co_owner',
--       'agency', 'telecaller', 'office_staff', 'hr', 'accounts',
--       'staff']))
--
--   users_team_role_check:
--     CHECK (team_role IS NULL OR team_role = ANY (ARRAY['admin',
--       'owner', 'government_partner', 'sales_manager', 'sales',
--       'telecaller', 'creative_lead', 'designer', 'video_editor',
--       'ops_execution', 'accounts', 'hr', 'admin_staff',
--       'office_boy', 'agency']))
--
-- Both still allow 'owner'. Any admin (or any RLS path that lets
-- a user set their own role) can flip `role='owner'` or
-- `team_role='owner'` and land in a state that:
--   • Has no defined RLS policy (per Phase 97.0 audit A2 — 0 hits)
--   • Has no defined helper function semantics (per A3 — 0 hits)
--   • Is intentionally orphaned per §8 doc + Phase 97.8 frontend
--     literal purge
-- That creates ambiguity. F-001b closes the door at the DB layer so
-- the DB shape matches the documented role universe.
--
-- LIVE AUDIT RESULTS (2026-05-28)
-- ──────────────────────────────
-- A1 — pg_constraint: both checks still list 'owner' (FAIL → THIS FIX)
-- A2 — pg_policies:   0 rows mention standalone 'owner' (PASS)
-- A3 — pg_proc bodies: 0 rows mention standalone 'owner' (PASS)
-- A4 — users table:    0 rows carry role='owner' or team_role='owner'
--                       (PASS — ADD CONSTRAINT will not fail on data)
--
-- FIX
-- ───
-- Drop + re-create the two CHECK constraints WITHOUT 'owner'. All
-- other allowed values preserved byte-identical. No RLS / function
-- / data change.
--
-- AFTER:
--   users_role_check:      9 values (was 10) — drops 'owner'
--   users_team_role_check: 14 values (was 15) — drops 'owner'
--
-- Belt-and-suspenders complement to Phase 97.8 (F-001a) which
-- removed `'owner'` from the frontend literal arrays. Now both
-- frontend AND DB agree.
--
-- IDEMPOTENCY
-- ───────────
-- DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT. Re-runnable. No
-- table mutation. No data write.
--
-- SCOPE
-- ─────
-- This migration closes F-001b only. It does NOT touch:
--   • RLS policies (A2 audit — none reference 'owner')
--   • Function bodies (A3 audit — none reference 'owner')
--   • User rows (A4 audit — none carry the value)
--   • users_segment_access_check (no overlap)
--   • Foreign keys / PK / UNIQUE constraints

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users
  ADD  CONSTRAINT users_role_check
       CHECK (role = ANY (ARRAY[
         'admin'::text,
         'sales'::text,
         'co_owner'::text,
         'agency'::text,
         'telecaller'::text,
         'office_staff'::text,
         'hr'::text,
         'accounts'::text,
         'staff'::text
       ]));

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_team_role_check;
ALTER TABLE public.users
  ADD  CONSTRAINT users_team_role_check
       CHECK ((team_role IS NULL) OR (team_role = ANY (ARRAY[
         'admin'::text,
         'government_partner'::text,
         'sales_manager'::text,
         'sales'::text,
         'telecaller'::text,
         'creative_lead'::text,
         'designer'::text,
         'video_editor'::text,
         'ops_execution'::text,
         'accounts'::text,
         'hr'::text,
         'admin_staff'::text,
         'office_boy'::text,
         'agency'::text
       ])));

NOTIFY pgrst, 'reload schema';


-- ───────────── VERIFY ─────────────
-- Run all 3 in Supabase Studio after applying. Each must return the
-- expected result. If any fails, ROLLBACK (see block below).
--
-- 1. Both constraint definitions no longer contain 'owner' (2 rows,
--    both with `has_owner = false`):
--
--    SELECT conname,
--           pg_get_constraintdef(oid) ILIKE '%''owner''%' AS has_owner
--      FROM pg_constraint
--     WHERE conrelid = 'public.users'::regclass
--       AND contype  = 'c'
--       AND conname IN ('users_role_check', 'users_team_role_check')
--     ORDER BY conname;
--    -- Expected: 2 rows, has_owner=false on both
--
-- 2. Functional rejection — attempt to set role='owner' on any user
--    row. The UPDATE MUST raise check_violation. Transaction is
--    rolled back so no row actually changes:
--
--    BEGIN;
--    UPDATE public.users SET role = 'owner'
--     WHERE id = (SELECT id FROM public.users ORDER BY created_at LIMIT 1);
--    ROLLBACK;
--    -- Expected: ERROR: 23514: new row for relation "users" violates
--    --          check constraint "users_role_check"
--
-- 3. Same test for team_role:
--
--    BEGIN;
--    UPDATE public.users SET team_role = 'owner'
--     WHERE id = (SELECT id FROM public.users ORDER BY created_at LIMIT 1);
--    ROLLBACK;
--    -- Expected: ERROR: 23514: new row for relation "users" violates
--    --          check constraint "users_team_role_check"


-- ───────────── ROLLBACK ─────────────
-- Re-apply ONLY if a real regression appears (i.e. an unknown legacy
-- code path that still depends on `role='owner'` or `team_role=
-- 'owner'` and breaks under check_violation). A4 audit on 2026-05-28
-- showed 0 such rows exist, so a regression should NOT occur.
--
-- Note: leaving the rollback in place re-opens F-001b. Pair with an
-- alternative fix plan if you run it.
--
--   ALTER TABLE public.users
--     DROP CONSTRAINT IF EXISTS users_role_check;
--   ALTER TABLE public.users
--     ADD  CONSTRAINT users_role_check
--          CHECK (role = ANY (ARRAY[
--            'admin'::text, 'sales'::text, 'owner'::text,
--            'co_owner'::text, 'agency'::text, 'telecaller'::text,
--            'office_staff'::text, 'hr'::text, 'accounts'::text,
--            'staff'::text
--          ]));
--
--   ALTER TABLE public.users
--     DROP CONSTRAINT IF EXISTS users_team_role_check;
--   ALTER TABLE public.users
--     ADD  CONSTRAINT users_team_role_check
--          CHECK ((team_role IS NULL) OR (team_role = ANY (ARRAY[
--            'admin'::text, 'owner'::text, 'government_partner'::text,
--            'sales_manager'::text, 'sales'::text, 'telecaller'::text,
--            'creative_lead'::text, 'designer'::text,
--            'video_editor'::text, 'ops_execution'::text,
--            'accounts'::text, 'hr'::text, 'admin_staff'::text,
--            'office_boy'::text, 'agency'::text
--          ])));
--   NOTIFY pgrst, 'reload schema';
