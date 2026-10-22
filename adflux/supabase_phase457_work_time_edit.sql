-- Phase 457: change the due TIME of a task part (same people as work_set_due) + creator delete relaxed (see phase418 file).
CREATE OR REPLACE FUNCTION public.work_set_due_time(p_task uuid, p_part uuid, p_time time)
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
  IF p_part IS NULL THEN
    UPDATE public.work_task_parts SET due_time = p_time, due_alerted_at = NULL WHERE task_id = p_task AND status NOT IN ('finished','postponed');
  ELSE
    UPDATE public.work_task_parts SET due_time = p_time, due_alerted_at = NULL WHERE id = p_part AND task_id = p_task;
  END IF;
  PERFORM public.work_log(p_task, p_part, 'due_changed', jsonb_build_object('due_time', p_time));
END;
$function$;
REVOKE ALL ON FUNCTION public.work_set_due_time(uuid, uuid, time) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.work_set_due_time(uuid, uuid, time) TO authenticated;
NOTIFY pgrst, 'reload schema';
