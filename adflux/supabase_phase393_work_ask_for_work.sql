-- supabase_phase393_work_ask_for_work.sql
-- Phase 393 (17 Oct 2026): sales + telecaller can ask the Work team for work, including typing a NEW client name.
-- work_create_task already allows any active user; only work_add_project was members-only. Now: Work members OR role sales/telecaller.
-- Agency and everyone else still cannot add clients. Idempotent (CREATE OR REPLACE). Body = the live function + one changed gate.
CREATE OR REPLACE FUNCTION public.work_add_project(p_name text, p_kind text DEFAULT 'client'::text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_id uuid; v_name text := left(btrim(COALESCE(p_name,'')), 80);
BEGIN
  IF auth.uid() IS NULL
     OR NOT (public.work_is_member()
             OR COALESCE((SELECT u.role IN ('sales','telecaller') AND u.is_active FROM public.users u WHERE u.id = auth.uid()), false))
  THEN RAISE EXCEPTION 'not on the timeclock' USING ERRCODE='42501'; END IF;
  IF v_name = '' THEN RAISE EXCEPTION 'type a name'; END IF;
  IF p_kind NOT IN ('client','internal','govt') THEN p_kind := 'client'; END IF;
  SELECT id INTO v_id FROM public.work_projects WHERE lower(btrim(name)) = lower(v_name);
  IF v_id IS NOT NULL THEN
    UPDATE public.work_projects SET is_active = true WHERE id = v_id AND NOT is_active AND public.work_is_head();
    RETURN v_id;
  END IF;
  INSERT INTO public.work_projects (name, kind, created_by) VALUES (v_name, p_kind, auth.uid()) RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;
NOTIFY pgrst, 'reload schema';
-- VERIFY: SELECT pg_get_functiondef('public.work_add_project'::regproc) LIKE '%sales%telecaller%' AS gate_ok;
