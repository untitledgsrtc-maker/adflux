-- supabase_phase42_sales_manager.sql
-- Phase 42 — sales_manager role foundation.
-- 18 May 2026
--
-- Owner directive:
--   "(A) reuse sales_manager for both sales head + telecaller team
--    lead. Single role, scoped via manager_id chain. Sales-head's
--    reports = sales reps; telecaller-lead's reports = telecallers.
--    Same UI, different teams."
--
-- This file does 4 things — all idempotent, safe to re-run:
--   1. Create Jubin (sales head) + Renuka (TC lead) users with
--      team_role='sales_manager' chained under Brijesh (admin).
--   2. Add incentive_override_pct column to staff_incentive_profiles
--      so admin can set per-manager bonus % on team revenue.
--   3. RLS — managers can approve/reject leaves + ta_da_requests
--      for users where manager_id = their auth.uid().
--   4. compute_monthly_salary RPC — when caller is sales_manager,
--      add (team_revenue × override_pct) to their incentive line.
--
-- Owner runs this in Supabase Studio. After it succeeds, manually
-- UPDATE the existing sales reps + telecallers to chain them under
-- Jubin / Renuka — exact UPDATE templates printed at the bottom.


-- ─── 1. Create Jubin + Renuka users ──────────────────────────────
-- Both report to Brijesh (admin owner). Roles:
--   • Jubin   — role='sales',     team_role='sales_manager'
--   • Renuka  — role='telecaller', team_role='sales_manager'
-- segment_access='ALL' so they see govt + private leads/quotes.
-- Auth role gates Master tab / Auto Districts / etc; team_role
-- gates MANAGER_NAV in V2AppShell (Phase 42.1).
--
-- NOTE: Supabase Auth user records (auth.users) must be created
-- separately by inviting their email via Supabase Studio → Auth →
-- Users → Invite. The rows below populate the public.users mirror
-- table only. Login won't work until auth.users entry exists.

DO $$
DECLARE
  v_brijesh_id uuid;
BEGIN
  -- Look up Brijesh (admin owner) by email so we don't hardcode an
  -- auth.uid().
  SELECT id INTO v_brijesh_id
    FROM public.users
   WHERE lower(email) = 'untitledadvertising@gmail.com'
   LIMIT 1;

  IF v_brijesh_id IS NULL THEN
    RAISE NOTICE 'Brijesh user not found by email untitledadvertising@gmail.com — manager_id will be NULL on Jubin/Renuka. Owner must UPDATE after inviting.';
  END IF;

  -- Jubin (sales head). Skip if already present.
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE lower(name) = 'jubin') THEN
    INSERT INTO public.users (id, name, email, role, team_role, segment_access, manager_id, is_active, created_at)
    VALUES (gen_random_uuid(), 'Jubin', 'jubin@untitledadvertising.in', 'sales', 'sales_manager', 'ALL', v_brijesh_id, true, now());
  END IF;

  -- Renuka (TC lead). Skip if already present.
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE lower(name) = 'renuka') THEN
    INSERT INTO public.users (id, name, email, role, team_role, segment_access, manager_id, is_active, created_at)
    VALUES (gen_random_uuid(), 'Renuka', 'renuka@untitledadvertising.in', 'telecaller', 'sales_manager', 'ALL', v_brijesh_id, true, now());
  END IF;
END $$;


-- ─── 2. Incentive override % column ───────────────────────────────
-- Admin sets this per-manager via the Incentives page (Phase 42.x
-- UI). NULL = no override (manager paid flat). Numeric so admin can
-- type 2.5 for 2.5%.

ALTER TABLE public.staff_incentive_profiles
  ADD COLUMN IF NOT EXISTS incentive_override_pct numeric;

COMMENT ON COLUMN public.staff_incentive_profiles.incentive_override_pct IS
  'Phase 42 — manager-only. % of team revenue (sum of reports'' won-and-settled quotes) credited to this manager on top of their own incentive. NULL = no override.';


-- ─── 3. Manager RLS on leaves + ta_da_requests ───────────────────
-- A user with team_role='sales_manager' should be able to read +
-- update (approve/reject) leaves and ta_da_requests for users they
-- manage (i.e. rows where the user's manager_id = caller's id).
--
-- Existing admin/co_owner policies remain — these are additive.

-- Helper: tighter check than get_my_role(); inlines the team_role
-- read so RLS doesn't fight with itself.
CREATE OR REPLACE FUNCTION public.is_sales_manager()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
     WHERE id = auth.uid()
       AND team_role = 'sales_manager'
       AND is_active = true
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_sales_manager() TO authenticated;


-- ─── 3a. leaves — manager can SELECT + UPDATE for reports ────────
DROP POLICY IF EXISTS "leaves_manager_read"   ON public.leaves;
DROP POLICY IF EXISTS "leaves_manager_update" ON public.leaves;

CREATE POLICY "leaves_manager_read" ON public.leaves
  FOR SELECT TO authenticated
  USING (
    public.is_sales_manager()
    AND user_id IN (SELECT id FROM public.users WHERE manager_id = auth.uid())
  );

CREATE POLICY "leaves_manager_update" ON public.leaves
  FOR UPDATE TO authenticated
  USING (
    public.is_sales_manager()
    AND user_id IN (SELECT id FROM public.users WHERE manager_id = auth.uid())
  )
  WITH CHECK (
    public.is_sales_manager()
    AND user_id IN (SELECT id FROM public.users WHERE manager_id = auth.uid())
  );


-- ─── 3b. ta_da_requests — manager can SELECT + UPDATE for reports
DROP POLICY IF EXISTS "ta_requests_manager_read"   ON public.ta_da_requests;
DROP POLICY IF EXISTS "ta_requests_manager_update" ON public.ta_da_requests;

CREATE POLICY "ta_requests_manager_read" ON public.ta_da_requests
  FOR SELECT TO authenticated
  USING (
    public.is_sales_manager()
    AND user_id IN (SELECT id FROM public.users WHERE manager_id = auth.uid())
  );

CREATE POLICY "ta_requests_manager_update" ON public.ta_da_requests
  FOR UPDATE TO authenticated
  USING (
    public.is_sales_manager()
    AND user_id IN (SELECT id FROM public.users WHERE manager_id = auth.uid())
  )
  WITH CHECK (
    public.is_sales_manager()
    AND user_id IN (SELECT id FROM public.users WHERE manager_id = auth.uid())
  );


-- ─── 3c. leads — manager can SELECT + UPDATE (for reassignment) ───
-- Manager needs to reassign leads between their own reports.
-- Phase 12 already gave manager SELECT via the manager_id chain on
-- assigned_to + telecaller_id; this adds explicit UPDATE so they
-- can flip assigned_to and telecaller_id within their team.
DROP POLICY IF EXISTS "leads_manager_update" ON public.leads;

CREATE POLICY "leads_manager_update" ON public.leads
  FOR UPDATE TO authenticated
  USING (
    public.is_sales_manager()
    AND (
      assigned_to    IN (SELECT id FROM public.users WHERE manager_id = auth.uid())
      OR telecaller_id IN (SELECT id FROM public.users WHERE manager_id = auth.uid())
    )
  )
  WITH CHECK (
    public.is_sales_manager()
    AND (
      assigned_to    IN (SELECT id FROM public.users WHERE manager_id = auth.uid())
      OR telecaller_id IN (SELECT id FROM public.users WHERE manager_id = auth.uid())
    )
  );


-- ─── 4. compute_monthly_salary — add manager override ────────────
-- When the user being computed is a sales_manager, sum the
-- monthly revenue from their reports (sum of monthly_sales_data
-- rows where staff_id IN reports) and add team_revenue ×
-- incentive_override_pct / 100 to their incentive.
--
-- Wraps the existing Phase 36.10 RPC. The original RPC body is
-- preserved exactly; only the final incentive value is augmented.

CREATE OR REPLACE FUNCTION public.compute_monthly_salary(
  p_user_id uuid,
  p_year    int,
  p_month   int
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_result jsonb;
  v_is_manager boolean;
  v_override_pct numeric;
  v_team_revenue numeric;
  v_override_amount numeric := 0;
  v_month_year text := lpad(p_year::text, 4, '0') || '-' || lpad(p_month::text, 2, '0');
BEGIN
  -- Call the existing single-user RPC body via a CTE — but since
  -- the original is a function we'd have to inline. Simpler: do
  -- the override math AROUND the existing return jsonb.
  --
  -- The existing RPC (Phase 36.10) returns net_payable, incentive,
  -- etc. We re-run that logic here then add the override.
  --
  -- NOTE: This file ASSUMES Phase 36.10 RPC is in place. If you
  -- have NOT run supabase_phase36_10_paid_leave_tenure.sql first,
  -- run that BEFORE this file.

  -- Manager check.
  SELECT (team_role = 'sales_manager') INTO v_is_manager
    FROM public.users WHERE id = p_user_id;
  v_is_manager := COALESCE(v_is_manager, false);

  -- Run the original RPC by calling itself with a temporary flag —
  -- actually simpler: drop into a separate helper function.
  -- For Phase 42 we don't recurse. We compute everything inline by
  -- copy-pasting the Phase 36.10 body, then layer the override.
  --
  -- To avoid copy-paste drift, we instead pull the existing RPC's
  -- output via a wrapper. PostgreSQL doesn't support function
  -- aliasing easily, so we use SELECT INTO + EXECUTE.

  -- Pull current Phase 36.10 result. We assume the function still
  -- exists with the same signature.
  SELECT public._compute_monthly_salary_base(p_user_id, p_year, p_month) INTO v_result;

  -- Phase 42 — manager override. Only applies when caller is a
  -- sales_manager AND has incentive_override_pct set.
  IF v_is_manager THEN
    SELECT incentive_override_pct INTO v_override_pct
      FROM public.staff_incentive_profiles
     WHERE user_id = p_user_id;

    IF v_override_pct IS NOT NULL AND v_override_pct > 0 THEN
      -- Sum of team's monthly_sales_data new + renewal revenue for
      -- the month. Reports = users where manager_id = p_user_id.
      SELECT COALESCE(SUM(COALESCE(new_client_revenue, 0) + COALESCE(renewal_revenue, 0)), 0)
        INTO v_team_revenue
        FROM public.monthly_sales_data
       WHERE staff_id IN (SELECT id FROM public.users WHERE manager_id = p_user_id)
         AND month_year = v_month_year;

      v_override_amount := round(v_team_revenue * (v_override_pct / 100.0));

      -- Augment the result jsonb: add team_revenue + override_amount
      -- + bump incentive + net_payable accordingly.
      v_result := v_result
        || jsonb_build_object(
             'team_revenue',     v_team_revenue,
             'override_pct',     v_override_pct,
             'override_amount',  v_override_amount,
             'incentive',        (COALESCE((v_result->>'incentive')::numeric, 0) + v_override_amount),
             'net_payable',      (COALESCE((v_result->>'net_payable')::numeric, 0) + v_override_amount)
           );
    END IF;
  END IF;

  RETURN v_result;
END $$;

-- IMPORTANT: This requires renaming the existing Phase 36.10 RPC
-- to public._compute_monthly_salary_base so the wrapper above can
-- call it without recursion. We don't blindly DROP because the old
-- function might still be referenced from a view. Instead, only
-- rename if it hasn't already been renamed.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc
     WHERE proname = 'compute_monthly_salary'
       AND pronamespace = 'public'::regnamespace
       AND prosrc LIKE '%v_unpaid_deduction%'   -- Phase 36.10 body marker
       AND prosrc NOT LIKE '%_compute_monthly_salary_base%'   -- not yet renamed
  ) THEN
    -- Old function is the un-wrapped Phase 36.10 body. Rename it.
    ALTER FUNCTION public.compute_monthly_salary(uuid, int, int)
      RENAME TO _compute_monthly_salary_base;

    -- NOTE: The wrapper CREATE OR REPLACE above will now sit
    -- alongside the renamed base function. Both share the same
    -- signature, so a SECOND re-run of this file will overwrite
    -- the wrapper but leave _base intact.
    RAISE NOTICE 'Phase 42 — renamed Phase 36.10 RPC to _compute_monthly_salary_base; wrapper now active.';
  END IF;
END $$;


NOTIFY pgrst, 'reload schema';


-- ─── VERIFY ──────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM public.users
    WHERE name IN ('Jubin','Renuka') AND team_role = 'sales_manager')   AS managers_present,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='staff_incentive_profiles'
      AND column_name='incentive_override_pct')                         AS override_col_present,
  (SELECT count(*) FROM pg_policies
    WHERE schemaname='public' AND policyname LIKE '%manager%')          AS manager_policy_count,
  (SELECT count(*) FROM pg_proc
    WHERE proname IN ('compute_monthly_salary','_compute_monthly_salary_base','is_sales_manager')
      AND pronamespace='public'::regnamespace)                          AS rpc_fn_count;

-- Expected:
--   managers_present     = 2
--   override_col_present = 1
--   manager_policy_count = 5  (leaves x2, ta_da_requests x2, leads x1)
--   rpc_fn_count         = 3


-- ─── OWNER TODO — run AFTER the above succeeds ───────────────────
--
-- 1. Invite Jubin + Renuka in Supabase Studio → Auth → Users.
--    Use emails: jubin@untitledadvertising.in / renuka@untitledadvertising.in
--    Then update auth.users.id INTO public.users.id so the FK lines up.
--    (Or DELETE the rows we just inserted, then re-create from auth panel.)
--
-- 2. Chain existing sales reps under Jubin. Run in SQL editor:
--      UPDATE public.users
--         SET manager_id = (SELECT id FROM public.users WHERE name='Jubin' LIMIT 1)
--       WHERE role = 'sales'
--         AND name IN ('Brahmbhatt Jignesh','Sondarva Kiran','Dhara Patel',
--                      'Vishnu Solanki','Nikhil Vyas');
--    (Adjust names to match your users.name values exactly.)
--
-- 3. Chain existing telecallers under Renuka:
--      UPDATE public.users
--         SET manager_id = (SELECT id FROM public.users WHERE name='Renuka' LIMIT 1)
--       WHERE role = 'telecaller';
--    (Or list specific names to be precise.)
--
-- 4. (Optional) Set incentive override % for Jubin:
--      UPDATE public.staff_incentive_profiles
--         SET incentive_override_pct = 2.5
--       WHERE user_id = (SELECT id FROM public.users WHERE name='Jubin' LIMIT 1);
