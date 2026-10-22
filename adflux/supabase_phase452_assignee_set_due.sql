-- Phase 452: the person a task part is given to may change the due date of THEIR OWN unfinished part
-- (creator / heads keep full rights, whole-task date change still creator / head only).
CREATE OR REPLACE FUNCTION public.work_set_due(p_task uuid, p_part uuid, p_due date)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_creator uuid; v_own boolean := false;
BEGIN
  SELECT created_by INTO v_creator FROM public.work_tasks WHERE id = p_task;
  IF v_uid IS NOT NULL AND p_part IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM public.work_task_parts
                    WHERE id = p_part AND task_id = p_task AND assignee_id = v_uid AND status NOT IN ('finished','postponed')) INTO v_own;
  END IF;
  IF v_uid IS NULL OR NOT (public.work_is_head() OR v_creator = v_uid OR v_own) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE='42501'; END IF;
  IF p_part IS NULL THEN UPDATE public.work_tasks SET due_date = p_due WHERE id = p_task;
  ELSE UPDATE public.work_task_parts SET due_date = p_due WHERE id = p_part AND task_id = p_task; END IF;
  PERFORM public.work_log(p_task, p_part, 'due_changed', jsonb_build_object('due', p_due));
END;
$function$;
-- VERIFY: SELECT pg_get_functiondef('public.work_set_due(uuid,uuid,date)'::regprocedure) LIKE '%v_own%';
NOTIFY pgrst, 'reload schema';
