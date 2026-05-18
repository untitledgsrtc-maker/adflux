-- supabase_phase50_designations_master.sql
-- Phase 50 — designations master + 3 new auth roles (hr/accounts/staff).
-- 18 May 2026
--
-- Owner directive: HR needs to create users + send offer letters
-- without manual SQL. New master table holds the 13 designations
-- in the actual roster (Vadodara HQ + 4 outpost cities), each
-- mapped to a sensible default salary band + auth role + team role.
--
-- Schema:
--   1. Widen users.role CHECK to add hr / accounts / staff.
--   2. New table designations:
--      name, auth_role, team_role, default_monthly_salary,
--      has_incentive, default_variable_pct, default_min_calls,
--      default_min_quotes, display_order, is_active.
--   3. Seed 13 active designations from owner's roster + 2 manager
--      designations (sales head, telecaller head).
--
-- Idempotent.


-- ─── 1. Auth role enum widening ──────────────────────────────────
-- Current (Phase 26b): admin / sales / owner / co_owner / agency /
-- telecaller / office_staff. Adding: hr, accounts, staff. Keeping
-- office_staff as legacy alias (some rows may still hold it).
ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role IN (
    'admin', 'sales', 'owner', 'co_owner', 'agency',
    'telecaller', 'office_staff',
    -- Phase 50 additions:
    'hr', 'accounts', 'staff'
  ));


-- ─── 2. Designations master table ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.designations (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                     text NOT NULL UNIQUE,
  auth_role                text NOT NULL,    -- maps to users.role enum
  team_role                text NOT NULL,    -- maps to users.team_role enum
  default_monthly_salary   numeric DEFAULT 0,
  has_incentive            boolean NOT NULL DEFAULT false,
  default_variable_pct     int NOT NULL DEFAULT 0   -- 0..100, 0 = flat salary
                           CHECK (default_variable_pct >= 0 AND default_variable_pct <= 100),
  default_min_calls        int DEFAULT 0,
  default_min_quotes       int DEFAULT 0,
  default_min_followups    int DEFAULT 0,
  display_order            int NOT NULL DEFAULT 0,
  is_active                boolean NOT NULL DEFAULT true,
  notes                    text,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_designations_active_order
  ON public.designations (is_active, display_order)
  WHERE is_active = true;


-- ─── 3. RLS ──────────────────────────────────────────────────────
ALTER TABLE public.designations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "des_read_all"    ON public.designations;
DROP POLICY IF EXISTS "des_admin_write" ON public.designations;

CREATE POLICY "des_read_all" ON public.designations
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "des_admin_write" ON public.designations
  FOR ALL TO authenticated
  USING      (public.get_my_role() IN ('admin', 'co_owner', 'hr'))
  WITH CHECK (public.get_my_role() IN ('admin', 'co_owner', 'hr'));


-- ─── 4. Seed designations ────────────────────────────────────────
-- 15 designations covering the entire 24-person roster (13 from
-- Brijesh's chart + 2 newly-added manager roles). Salary defaults
-- are owner-test SMB OOH norms; HR edits later via Master tab.

INSERT INTO public.designations (
  name, auth_role, team_role,
  default_monthly_salary, has_incentive, default_variable_pct,
  default_min_calls, default_min_quotes, default_min_followups,
  display_order, notes
)
SELECT * FROM (VALUES
  -- Leadership
  ('Proprietor',             'admin',       'owner',              200000, false,  0,  0, 0, 0, 10,
   'Brijesh — full P&L access, all module write.'),

  ('Partner in Government',  'co_owner',    'government_partner', 150000, true,  30,  0, 0, 0, 20,
   'Vishal — co-owner level access to govt segment data.'),

  ('Sales Head',             'sales',       'sales_manager',       80000, true,  30,  0, 5, 0, 30,
   'Jubin — sales_manager team_role. Earns own incentive + override % on team revenue.'),

  ('Telecaller Head',        'telecaller',  'sales_manager',       50000, true,  30, 50, 0, 0, 40,
   'Renuka (TC) — sales_manager team_role for telecaller team.'),

  -- HR / Admin / Finance
  ('HR',                     'hr',          'hr',                  35000, false,  0,  0, 0, 0, 50,
   'Riya — sees roster + offer letters + leave + TA approvals. Not P&L.'),

  ('Admin',                  'admin',       'admin',               40000, false,  0,  0, 0, 0, 60,
   'Dixita — full admin module access.'),

  ('Accounts',               'accounts',    'accounts',            45000, false,  0,  0, 0, 0, 70,
   'Diya — salary + payments + TA approvals. Not P&L.'),

  -- Sales (field)
  ('Sales Executive',        'sales',       'sales',               25000, true,  30,  0, 5, 5, 80,
   '~7 reps across Vadodara/Surat/Jamnagar/Gandhinagar/Veraval/Bhavnagar.'),

  -- Telecaller (inside-sales)
  ('Telecaller',             'telecaller',  'telecaller',          20000, true,  30, 50, 0, 0, 90,
   'Dhara + Rima + new hires. 50 calls/day · 30% connect · 5 qualified/wk.'),

  -- Creative
  ('Graphic Designer',       'staff',       'designer',            25000, false,  0,  0, 0, 0, 100,
   '~4 designers — Vasava, Safika, Shreya, Dikshita.'),

  ('Video Editor',           'staff',       'video_editor',        30000, false,  0,  0, 0, 0, 110,
   'Piyush.'),

  -- Operations
  ('Operation Execution',    'staff',       'ops_execution',       22000, false,  0,  0, 0, 0, 120,
   'Meet + Rahul — site work / installation.'),

  -- Support
  ('Office Boy',             'staff',       'office_boy',          12000, false,  0,  0, 0, 0, 130,
   'Kevin.'),

  -- Reserved (no current headcount but kept for future hires)
  ('Sr. Sales Executive',    'sales',       'sales',               40000, true,  30,  0, 8, 5, 140,
   'Reserved — for promotion from Sales Executive.'),

  ('Creative Lead',          'staff',       'creative_lead',       45000, false,  0,  0, 0, 0, 150,
   'Reserved — when team grows beyond 4 designers.')
) AS v(name, auth_role, team_role,
       default_monthly_salary, has_incentive, default_variable_pct,
       default_min_calls, default_min_quotes, default_min_followups,
       display_order, notes)
WHERE NOT EXISTS (
  SELECT 1 FROM public.designations WHERE name = v.name
);


NOTIFY pgrst, 'reload schema';


-- ─── VERIFY ──────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.tables
    WHERE table_schema='public' AND table_name='designations')              AS table_present,
  (SELECT count(*) FROM pg_policies
    WHERE schemaname='public' AND tablename='designations')                 AS rls_count,
  (SELECT count(*) FROM public.designations WHERE is_active = true)         AS active_designations,
  (SELECT count(*) FROM information_schema.check_constraints
    WHERE constraint_schema='public'
      AND constraint_name='users_role_check'
      AND check_clause ILIKE '%hr%'
      AND check_clause ILIKE '%accounts%'
      AND check_clause ILIKE '%staff%')                                     AS new_auth_roles_in_check;

-- Expected:
--   table_present          = 1
--   rls_count              = 2
--   active_designations    = 15
--   new_auth_roles_in_check = 1
