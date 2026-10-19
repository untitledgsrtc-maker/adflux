-- Phase 424 (owner 2026-10-19): any active person who can create a Work task can also type a NEW client name
-- (was: Work members + sales + telecaller only -> "not on the timeclock" for others, e.g. co-owner / ops head).
-- Agency stays blocked. Everything else in the function is unchanged.
CREATE OR REPLACE FUNCTION public.work_add_project(p_name text, p_kind text DEFAULT 'client'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_id uuid; v_name text := left(btrim(COALESCE(p_name,'')), 80);
BEGIN
  IF auth.uid() IS NULL
     OR NOT (public.work_is_member()
             OR COALESCE((SELECT u.is_active AND u.role <> 'agency' FROM public.users u WHERE u.id = auth.uid()), false))
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
