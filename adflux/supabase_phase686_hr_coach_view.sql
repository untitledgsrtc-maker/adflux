-- supabase_phase686_hr_coach_view.sql (24-11-2026)
-- Owner 24-11-2026: "i want hr should see this page" (/coach, Team Evening).
-- 1. coach_team_view: HR is treated like the admin inside this one function (sees every
--    sales / telecaller / office / ops person, read-only page). Done by patching the LIVE
--    definition in place, so nothing else in the function changes; refuses if the
--    expected line is not found.
-- 2. coach_tips: new read-only policy for HR (the AI tip shown on each card).
-- Additive: admin / sales-manager paths unchanged. No write access added.

DO $$
DECLARE
  v_def text := pg_get_functiondef('public.coach_team_view(date)'::regprocedure);
  v_old text := 'v_admin boolean := COALESCE(public.get_my_role() = ''admin'', false);';
  v_new text := 'v_admin boolean := COALESCE(public.get_my_role() IN (''admin'', ''hr''), false);   -- Phase 686: HR sees the page like the admin';
BEGIN
  IF position(v_new IN v_def) > 0 THEN RETURN; END IF;   -- already applied
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'coach_team_view changed since Phase 576 - expected line not found, nothing applied';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END $$;

DROP POLICY IF EXISTS coach_tips_hr_read ON public.coach_tips;
CREATE POLICY coach_tips_hr_read ON public.coach_tips FOR SELECT
  USING (COALESCE((SELECT public.get_my_role()) = 'hr', false));

NOTIFY pgrst, 'reload schema';

-- VERIFY: expect hr_in_view = true, hr_tip_policy = 1
SELECT
  pg_get_functiondef('public.coach_team_view(date)'::regprocedure) LIKE '%IN (''admin'', ''hr'')%' AS hr_in_view,
  (SELECT count(*) FROM pg_policy WHERE polname = 'coach_tips_hr_read') AS hr_tip_policy;
