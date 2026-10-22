-- Phase 459: changing a task's due date (whole task) now moves every open person's part too, and the people are told.
-- Before, the task said 24/10 while Renuka's part still said 22/10.
CREATE OR REPLACE FUNCTION public.work_set_due(p_task uuid, p_part uuid, p_due date)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_creator uuid; v_own boolean := false; v_actor text; v_title text; r record;
BEGIN
  SELECT created_by, title INTO v_creator, v_title FROM public.work_tasks WHERE id = p_task;
  IF v_uid IS NOT NULL AND p_part IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM public.work_task_parts
                    WHERE id = p_part AND task_id = p_task AND assignee_id = v_uid AND status NOT IN ('finished','postponed')) INTO v_own;
  END IF;
  IF v_uid IS NULL OR NOT (public.work_is_head() OR v_creator = v_uid OR v_own) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE='42501'; END IF;
  SELECT name INTO v_actor FROM public.users WHERE id = v_uid;
  IF p_part IS NULL THEN
    UPDATE public.work_tasks SET due_date = p_due WHERE id = p_task;
    UPDATE public.work_task_parts SET due_date = p_due, due_alerted_at = NULL
     WHERE task_id = p_task AND status NOT IN ('finished','postponed');
    FOR r IN SELECT DISTINCT assignee_id FROM public.work_task_parts
              WHERE task_id = p_task AND status NOT IN ('finished','postponed') AND assignee_id <> v_uid LOOP
      PERFORM public.work_push(r.assignee_id, 'Due date changed', COALESCE(v_actor, 'Someone') || ' changed the due date of ' || left(v_title, 60)
              || ' to ' || COALESCE(to_char(p_due, 'DD/MM/YYYY'), 'no date'), '/my-work', 'work-due-' || p_task::text);
    END LOOP;
  ELSE
    UPDATE public.work_task_parts SET due_date = p_due, due_alerted_at = NULL WHERE id = p_part AND task_id = p_task;
  END IF;
  PERFORM public.work_log(p_task, p_part, 'due_changed', jsonb_build_object('due', p_due));
END;
$function$;
NOTIFY pgrst, 'reload schema';
