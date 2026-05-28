-- supabase_phase98_c_hr_offers_widen_self_read.sql
--
-- Phase 98.C — close F / B-002 hr_offers self-read.
--
-- BACKGROUND
-- ──────────
-- `hr_offers_sales_own` (defined in `supabase_hr_module.sql`) admits
-- only role='sales' to read own offer row:
--
--   USING ((get_my_role() = 'sales'::text)
--          AND (converted_user_id = auth.uid()))
--
-- Live audit on 2026-05-28 (Phase B):
--   * Dhara (role='telecaller')  → /my-offer empty
--   * Any agency rep              → /my-offer empty
--   * Vishal (role='co_owner')    → /my-offer empty
--   * HR role (if a user has it)  → /my-offer empty
--
-- The admin path `hr_offers_admin_all` (SECDEF) gives Brijesh full
-- RW. Reps with non-sales roles cannot view their own offer letter
-- even when one was issued to them.
--
-- FIX
-- ───
-- Drop + re-create the self-read policy renamed
-- `hr_offers_self_read` to make the new scope obvious. Widen the
-- role-admit list to: sales / telecaller / agency / co_owner / hr.
-- The own-row clause (`converted_user_id = auth.uid()`) is
-- preserved verbatim — no cross-rep leak. ADMIN POLICY UNTOUCHED.
--
-- IDEMPOTENCY
-- ───────────
-- DROP POLICY IF EXISTS for BOTH the old name and the new name
-- before CREATE → safe to re-run. NOTIFY pgrst at end. No table
-- mutation. No data write. No column add. No RPC change.
--
-- SCOPE
-- ─────
-- This migration closes B-002 only. It does NOT touch:
--   * `hr_offers_admin_all` (admin RW path — still admin-only;
--     widened to co_owner separately by FIX-B if approved)
--   * Phase 87.5b RPCs `accept_user_profile` /
--     `unaccept_user_profile` — role gates inside RPC unchanged
--   * Candidate-facing SECDEF RPCs `fetch_offer_by_token` /
--     `submit_offer_acceptance` — public-token path unchanged
--   * Phase 97.1 / 87.5b column-pin policy on `users` — unrelated
--   * `users.hr_accepted_at` / `hr_accepted_by` / `hr_acceptance_note`
--     — these live on `users`, not on `hr_offers`
--   * FIX-B (co_owner admin parity) — deferred pending D4
--   * FIX-D (KM threshold align) — JS change


-- Drop both the original Phase HR-module policy AND the new
-- target name so the migration is fully idempotent regardless of
-- prior state.
DROP POLICY IF EXISTS hr_offers_sales_own ON public.hr_offers;
DROP POLICY IF EXISTS hr_offers_self_read ON public.hr_offers;


CREATE POLICY hr_offers_self_read ON public.hr_offers
  FOR SELECT
  USING (
    get_my_role() IN ('sales', 'telecaller', 'agency', 'co_owner', 'hr')
    AND converted_user_id = auth.uid()
  );


NOTIFY pgrst, 'reload schema';


-- ───────────── VERIFY ─────────────
-- Run after applying. Each must return the expected result.
--
-- 1. Old policy dropped + new policy created (1 row, polname =
--    'hr_offers_self_read', cmd = 'r' = SELECT):
--
--    SELECT polname, polcmd,
--           pg_get_expr(polqual, polrelid) AS using_expr
--      FROM pg_policy
--     WHERE polrelid = 'public.hr_offers'::regclass
--     ORDER BY polname;
--    -- Expected:
--    --   hr_offers_admin_all  | *  | (get_my_role() = 'admin'::text)
--    --   hr_offers_self_read  | r  | ((get_my_role() = ANY (ARRAY[
--    --     'sales','telecaller','agency','co_owner','hr'])) AND
--    --     (converted_user_id = auth.uid()))
--    -- (The admin row is untouched. Only the second row is new.)
--
-- 2. Old policy name no longer present (0 rows):
--
--    SELECT polname
--      FROM pg_policy
--     WHERE polrelid = 'public.hr_offers'::regclass
--       AND polname  = 'hr_offers_sales_own';
--    -- Expected: 0 rows
--
-- 3. PostgREST schema reload landed (any SELECT works after the
--    NOTIFY; this confirms session health):
--
--    SELECT 1;
--    -- Expected: 1
--
-- LIVE SMOKE (manual, after deploy):
--   * Sign in as Dhara (telecaller) → /my-offer → if she has an
--     hr_offers row with converted_user_id = her uid, the offer
--     KV grid + accepted_date render. If no row exists for her,
--     the "no offer on file" path still renders normally.
--   * Sign in as Vishal (co_owner) → same check.
--   * Sign in as Brijesh (admin) → /my-offer + /people/:userId
--     still work as before (admin policy untouched).


-- ───────────── ROLLBACK ─────────────
-- Re-apply ONLY if a real regression surfaces (e.g. a security
-- audit decides one of the 4 widened roles should not see their
-- own offer for compliance reasons). Restores the original
-- `hr_offers_sales_own` byte-identical to the HR-module file.
-- Leaves admin policy intact. Re-opens B-002 (TC / agency /
-- co_owner / hr cannot view own offer).
--
--   DROP POLICY IF EXISTS hr_offers_self_read ON public.hr_offers;
--   DROP POLICY IF EXISTS hr_offers_sales_own ON public.hr_offers;
--   CREATE POLICY hr_offers_sales_own ON public.hr_offers
--     FOR SELECT
--     USING (
--       (get_my_role() = 'sales')
--       AND (converted_user_id = auth.uid())
--     );
--   NOTIFY pgrst, 'reload schema';
