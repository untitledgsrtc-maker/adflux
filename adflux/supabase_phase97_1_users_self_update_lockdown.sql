-- supabase_phase97_1_users_self_update_lockdown.sql
--
-- Phase 97.1 — close audit finding F-100.
--
-- ROOT CAUSE
-- ──────────
-- supabase_phase87_user_avatars.sql (Phase 87.5, 2026-05-24) added a
-- policy `users_self_update_avatar` to let a rep update their OWN
-- `profile_image_url` row when uploading a profile picture from
-- `/my-offer`. The policy was written as:
--
--   USING       (id = auth.uid())
--   WITH CHECK  (id = auth.uid())
--
-- No column restriction. Result: any authenticated rep can run
--   UPDATE users SET role='admin' WHERE id=auth.uid()
-- via PostgREST and instantly become admin. Every
-- get_my_role()-gated RLS policy downstream is bypassed.
--
-- This is finding F-100 from the 2026-05-27 production-readiness
-- audit (Critical, Confirmed). See CLAUDE.md §40 + the Phase 97.0
-- audit-agent fleet for context.
--
-- FIX
-- ───
-- Redefine the same policy so WITH CHECK additionally requires
-- 8 privileged columns to match the existing row via subquery —
-- the Postgres idiom for OLD-vs-NEW column-immutability under RLS.
-- The subquery reads the caller's current row via their own
-- SELECT path, returning the OLD value at statement-start MVCC
-- snapshot. NEW vs OLD comparison via IS NOT DISTINCT FROM
-- handles NULL on both sides (manager_id may be NULL for
-- top-of-chain users).
--
-- PINNED COLUMNS (self-UPDATE blocked):
--   id                  — implicit via `id = auth.uid()` clause
--   role
--   team_role
--   segment_access
--   manager_id
--   is_active
--   email
--   signing_authority
--
-- ALLOWED SELF-UPDATE COLUMNS (anything else on the row):
--   profile_image_url   — Phase 87.5 reason this policy exists
--   signature_mobile    — Phase 56 rep dial-from
--   daily_targets       — user-set JSONB targets
--   last_login_at, updated_at — auto-bumped fields
--   …any other non-privileged column the rep is supposed to
--    self-manage. Owner can extend the pin list if a new
--    privileged column is added in a future phase.
--
-- ADMIN PATH (unchanged)
-- ──────────────────────
-- `users_admin_write` (Phase 5) grants admin / co_owner FOR ALL
-- access on the same table. Postgres OR-merges row policies of
-- the same command — UPDATE succeeds if ANY policy's WITH CHECK
-- passes. Admin / co_owner continue to flip role, team_role,
-- segment_access, manager_id, is_active, etc. on any row.
--
-- IDEMPOTENCY
-- ───────────
-- DROP POLICY IF EXISTS + CREATE POLICY = safe to re-run. No
-- table mutation. No column addition. No data writes. Pure
-- policy replacement.
--
-- SCOPE
-- ─────
-- This migration closes F-100 only. It does NOT touch:
--   • F-001 — `owner` role purge from CHECK / RLS / JS
--   • F-101 — approve_leave() no role gate
--   • F-102 — compute_monthly_salary() no caller gate
--   • F-108 — eligible_for_paid_leave() no caller gate
--   • F-104 — get_my_role() missing search_path
-- Those land in separate future phase migrations.

DROP POLICY IF EXISTS users_self_update_avatar ON public.users;

CREATE POLICY users_self_update_avatar ON public.users
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (
    -- id is implicitly pinned: if NEW.id ≠ auth.uid(), the
    -- equality fails and the row is rejected. No additional
    -- subquery needed for id.
    id = auth.uid()
    -- The 7 other privileged columns. Subquery reads the
    -- caller's current row through their own SELECT RLS path
    -- (users_self_select / users_read_all). MVCC statement
    -- snapshot returns the OLD value during WITH CHECK
    -- evaluation, so NEW vs OLD comparison is well-defined.
    -- IS NOT DISTINCT FROM handles NULL-vs-NULL as a match.
    AND role              IS NOT DISTINCT FROM (SELECT u.role              FROM public.users u WHERE u.id = auth.uid())
    AND team_role         IS NOT DISTINCT FROM (SELECT u.team_role         FROM public.users u WHERE u.id = auth.uid())
    AND segment_access    IS NOT DISTINCT FROM (SELECT u.segment_access    FROM public.users u WHERE u.id = auth.uid())
    AND manager_id        IS NOT DISTINCT FROM (SELECT u.manager_id        FROM public.users u WHERE u.id = auth.uid())
    AND is_active         IS NOT DISTINCT FROM (SELECT u.is_active         FROM public.users u WHERE u.id = auth.uid())
    AND email             IS NOT DISTINCT FROM (SELECT u.email             FROM public.users u WHERE u.id = auth.uid())
    AND signing_authority IS NOT DISTINCT FROM (SELECT u.signing_authority FROM public.users u WHERE u.id = auth.uid())
  );

NOTIFY pgrst, 'reload schema';

-- ───────────── VERIFY ─────────────
-- Run all 3 in Supabase Studio after applying. Each must return
-- the expected result. If any fails, ROLLBACK (see block below).
--
-- 1. Policy exists with new shape (1 row, with_check_expr
--    must contain "IS NOT DISTINCT FROM"):
--
--    SELECT polname,
--           pg_get_expr(polqual,      polrelid) AS using_expr,
--           pg_get_expr(polwithcheck, polrelid) AS with_check_expr
--      FROM pg_policy
--     WHERE polrelid = 'public.users'::regclass
--       AND polname  = 'users_self_update_avatar';
--
-- 2. Confirm only the expected 2 UPDATE-capable policies exist
--    on `users` (no escape-hatch policy granting self-update
--    on privileged columns):
--
--    SELECT polname, polcmd
--      FROM pg_policy
--     WHERE polrelid = 'public.users'::regclass
--       AND polcmd  IN ('w', '*')   -- UPDATE or FOR ALL
--     ORDER BY polname;
--    -- Expected rows:
--    --   users_admin_write          | *    (admin/co_owner FOR ALL)
--    --   users_self_update_avatar   | w    (self UPDATE — patched)
--
-- 3. PostgREST schema reload landed (any SELECT works after the
--    NOTIFY; this just confirms session health):
--
--    SELECT 1;   -- returns 1


-- ───────────── ROLLBACK ─────────────
-- Apply ONLY if you observe a regression:
--   • A rep reports they cannot upload / update their own
--     profile picture from /my-offer despite being signed in.
--   • Admin user-management (Master Designations tab, HR new
--     user) starts erroring on UPDATE.
--   • Login returns null profile for any role.
--
-- Note: this rollback re-opens F-100 (any rep can escalate to
-- admin). Do NOT leave the rollback in place — pair with an
-- alternative fix plan immediately.
--
--   DROP POLICY IF EXISTS users_self_update_avatar ON public.users;
--   CREATE POLICY users_self_update_avatar ON public.users
--     FOR UPDATE
--     USING      (id = auth.uid())
--     WITH CHECK (id = auth.uid());
--   NOTIFY pgrst, 'reload schema';
--
-- This restores the Phase 87.5 policy byte-identical.
