-- Phase 454: Urgent flag on Work tasks (shows first, red). Additive.
ALTER TABLE public.work_tasks ADD COLUMN IF NOT EXISTS is_urgent boolean NOT NULL DEFAULT false;
GRANT SELECT (is_urgent) ON public.work_tasks TO authenticated;   -- work_tasks has column-level grants

-- one create function: the old 7-argument version is replaced by an 8-argument one (p_urgent defaults to false,
-- so existing callers keep working)
DROP FUNCTION IF EXISTS public.work_create_task(text, uuid, text, date, jsonb, text[], time without time zone);
CREATE OR REPLACE FUNCTION public.work_create_task(p_title text, p_project uuid, p_note text, p_due date, p_parts jsonb,
  p_steps text[] DEFAULT NULL, p_due_time time DEFAULT NULL, p_urgent boolean DEFAULT false)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_task uuid; v_part jsonb; v_assignee uuid; v_i int := 0; v_s text; v_name text;
BEGIN
  IF v_uid IS NULL OR NOT public.work_is_active_user() THEN RAISE EXCEPTION 'login required' USING ERRCODE='42501'; END IF;
  IF NULLIF(btrim(p_title), '') IS NULL THEN RAISE EXCEPTION 'task needs a name'; END IF;
  IF p_due IS NULL THEN RAISE EXCEPTION 'a task needs a due date'; END IF;
  IF p_parts IS NULL OR jsonb_typeof(p_parts) <> 'array' OR jsonb_array_length(p_parts) = 0 THEN
    RAISE EXCEPTION 'pick at least one person';
  END IF;
  IF jsonb_array_length(p_parts) > 12 THEN RAISE EXCEPTION 'too many people on one task'; END IF;
  INSERT INTO public.work_tasks (title, project_id, note, created_by, due_date, is_urgent)
  VALUES (left(btrim(p_title), 120), p_project, NULLIF(btrim(p_note), ''), v_uid, p_due, COALESCE(p_urgent, false))
  RETURNING id INTO v_task;
  SELECT name INTO v_name FROM public.users WHERE id = v_uid;
  FOR v_part IN SELECT * FROM jsonb_array_elements(p_parts) LOOP
    v_assignee := NULLIF(v_part->>'assignee', '')::uuid;
    IF v_assignee IS NULL OR NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_assignee AND u.is_active) THEN
      RAISE EXCEPTION 'unknown or inactive person';
    END IF;
    INSERT INTO public.work_task_parts (task_id, assignee_id, label, due_date, due_time)
    VALUES (v_task, v_assignee, NULLIF(left(btrim(COALESCE(v_part->>'label','')), 80), ''),
            COALESCE(NULLIF(v_part->>'due','')::date, p_due), p_due_time);
    INSERT INTO public.work_members (user_id, added_by) VALUES (v_assignee, v_uid) ON CONFLICT (user_id) DO NOTHING;
    IF v_assignee <> v_uid THEN
      PERFORM public.work_push(v_assignee, CASE WHEN COALESCE(p_urgent,false) THEN 'URGENT task for you' ELSE 'New task for you' END,
                               COALESCE(v_name,'Someone') || ': ' || left(btrim(p_title), 80), '/my-work', 'work-task-' || v_task::text);
    END IF;
  END LOOP;
  IF p_steps IS NOT NULL THEN
    FOREACH v_s IN ARRAY p_steps LOOP
      IF NULLIF(btrim(v_s), '') IS NOT NULL THEN
        v_i := v_i + 1;
        INSERT INTO public.work_task_steps (task_id, label, position) VALUES (v_task, left(btrim(v_s), 120), v_i);
      END IF;
    END LOOP;
  END IF;
  PERFORM public.work_log(v_task, NULL, 'created', jsonb_build_object('parts', jsonb_array_length(p_parts), 'urgent', COALESCE(p_urgent,false)));
  RETURN v_task;
END;
$function$;
REVOKE ALL ON FUNCTION public.work_create_task(text, uuid, text, date, jsonb, text[], time, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.work_create_task(text, uuid, text, date, jsonb, text[], time, boolean) TO authenticated;

-- the creator or a head can turn Urgent on / off later
CREATE OR REPLACE FUNCTION public.work_set_urgent(p_task uuid, p_urgent boolean)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_creator uuid;
BEGIN
  SELECT created_by INTO v_creator FROM public.work_tasks WHERE id = p_task;
  IF v_uid IS NULL OR NOT (public.work_is_head() OR v_creator = v_uid) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE='42501'; END IF;
  UPDATE public.work_tasks SET is_urgent = COALESCE(p_urgent,false) WHERE id = p_task;
  PERFORM public.work_log(p_task, NULL, 'urgent_changed', jsonb_build_object('urgent', COALESCE(p_urgent,false)));
END;
$function$;
REVOKE ALL ON FUNCTION public.work_set_urgent(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.work_set_urgent(uuid, boolean) TO authenticated;
NOTIFY pgrst, 'reload schema';
-- VERIFY: SELECT count(*) FROM pg_proc WHERE proname='work_create_task' (=1), column is_urgent present, anon cannot execute either function.
