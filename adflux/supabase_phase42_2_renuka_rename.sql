-- supabase_phase42_2_renuka_rename.sql
-- Hotfix: rename Graphic Designer Renuka → Vasava + create the
-- new TC-head Renuka row.
-- 18 May 2026
--
-- Bug: Phase 42 SQL tried to INSERT "Renuka" as telecaller team-
-- lead but skipped because the GD Renuka was already in users
-- (case-insensitive name match). TC-lead Renuka was never created.
--
-- Owner clarification: rename GD Renuka to "Vasava" (her actual
-- surname) so the name "Renuka" is free for the TC head.
--
-- Steps:
--   1. UPDATE existing GD Renuka → name='Vasava'.
--   2. INSERT new TC-head Renuka (was skipped before; will succeed
--      now that the name conflict is cleared).
--
-- Idempotent: each step guarded with IF EXISTS / IF NOT EXISTS.

DO $$
DECLARE
  v_brijesh_id uuid;
BEGIN
  -- Step 1: rename GD Renuka. Only fires if there's still a user
  -- named 'Renuka' with team_role 'designer' or NULL (i.e. the GD,
  -- not the TC-head we're about to insert).
  IF EXISTS (
    SELECT 1 FROM public.users
    WHERE lower(name) = 'renuka'
      AND (team_role IS NULL OR team_role <> 'sales_manager')
  ) THEN
    UPDATE public.users
       SET name = 'Vasava',
           updated_at = now()
     WHERE lower(name) = 'renuka'
       AND (team_role IS NULL OR team_role <> 'sales_manager');
    RAISE NOTICE 'Renamed GD Renuka -> Vasava.';
  ELSE
    RAISE NOTICE 'No GD Renuka found to rename (already done or never existed).';
  END IF;

  -- Step 2: insert TC-head Renuka. Skip only if a user with both
  -- name='Renuka' AND team_role='sales_manager' already exists.
  SELECT id INTO v_brijesh_id
    FROM public.users
   WHERE lower(email) = 'untitledadvertising@gmail.com'
   LIMIT 1;

  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE lower(name) = 'renuka' AND team_role = 'sales_manager'
  ) THEN
    INSERT INTO public.users (id, name, email, role, team_role, segment_access, manager_id, is_active, created_at)
    VALUES (
      gen_random_uuid(),
      'Renuka',
      'renuka.tc@untitledadvertising.in',
      'telecaller',
      'sales_manager',
      'ALL',
      v_brijesh_id,
      true,
      now()
    );
    RAISE NOTICE 'Inserted TC-head Renuka with email renuka.tc@untitledadvertising.in.';
  ELSE
    RAISE NOTICE 'TC-head Renuka already exists. Skipped.';
  END IF;
END $$;


NOTIFY pgrst, 'reload schema';


-- ─── VERIFY ──────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM public.users WHERE lower(name) = 'vasava')                                                AS vasava_present,
  (SELECT count(*) FROM public.users WHERE lower(name) = 'renuka' AND team_role = 'sales_manager')                AS renuka_tc_present,
  (SELECT count(*) FROM public.users WHERE lower(name) = 'renuka' AND (team_role IS NULL OR team_role <> 'sales_manager')) AS old_renuka_remaining;

-- Expected:
--   vasava_present        = 1  (renamed GD)
--   renuka_tc_present     = 1  (new TC head)
--   old_renuka_remaining  = 0
