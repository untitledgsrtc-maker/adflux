-- Phase 514: owner 26 Oct 2026 - staff can bring their own finished task back to In Process.
-- Only change vs phase 395: the 'only the head can move a task back' guard now allows finished -> in_process
-- for the task's own assignee (non-owners are still blocked earlier: 'not your task'). Reopen clears finish time, cost, seconds
-- and writes a 'reopened' row to the task log. Idempotent (CREATE OR REPLACE).
-- UNDO: re-run the work_move_part block from supabase_phase395_work_postpone.sql.

CREATE OR REPLACE FUNCTION public.work_move_part(p_part uuid, p_to text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_part public.work_task_parts%ROWTYPE; v_head boolean; v_rank_from int; v_rank_to int;
BEGIN
  IF v_uid IS NULL OR NOT public.work_is_active_user() THEN RAISE EXCEPTION 'login required' USING ERRCODE='42501'; END IF;
  IF p_to = 'postponed' THEN RAISE EXCEPTION 'use the Postpone box (who asked, and the new date)'; END IF;
  IF p_to NOT IN ('assigned','in_process','finished') THEN RAISE EXCEPTION 'bad status'; END IF;
  SELECT * INTO v_part FROM public.work_task_parts WHERE id = p_part FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'task not found'; END IF;
  v_head := public.work_is_head();
  IF v_part.assignee_id <> v_uid AND NOT v_head THEN RAISE EXCEPTION 'not your task' USING ERRCODE='42501'; END IF;
  IF v_part.status = 'postponed' AND p_to = 'finished' THEN RAISE EXCEPTION 'bring this task back before finishing it'; END IF;
  -- Phase 395: a postponed task may be brought back early (rank 0, like before it started); the postpone fields clear
  IF v_part.status = 'postponed' AND p_to IN ('assigned','in_process') THEN
    UPDATE public.work_task_parts SET status = 'assigned', postponed_until = NULL, postponed_by_users = '{}', postponed_by_client = NULL, returned_at = now() WHERE id = p_part;
    PERFORM public.work_log(v_part.task_id, p_part, 'unpostponed', NULL);
    v_part.status := 'assigned';
  END IF;
  v_rank_from := CASE v_part.status WHEN 'assigned' THEN 1 WHEN 'in_process' THEN 2 ELSE 3 END;
  v_rank_to   := CASE p_to WHEN 'assigned' THEN 1 WHEN 'in_process' THEN 2 ELSE 3 END;
  IF v_rank_to = v_rank_from THEN RETURN; END IF;
  -- Phase 514: the person who owns a FINISHED task may reopen it (finished -> in_process). Going back to 'assigned' stays head-only.
  IF v_rank_to < v_rank_from AND NOT v_head AND NOT (v_rank_from = 3 AND p_to = 'in_process') THEN RAISE EXCEPTION 'only the head can move a task back'; END IF;
  IF p_to = 'finished' THEN
    PERFORM public.work_finish_part(p_part, NULL);
  ELSIF p_to = 'in_process' THEN
    IF v_rank_from = 3 THEN  -- reopen
      UPDATE public.work_task_parts SET status='in_process', finished_at=NULL, cost_amount=NULL, seconds=NULL WHERE id=p_part;
      PERFORM public.work_refresh_task(v_part.task_id);
      PERFORM public.work_log(v_part.task_id, p_part, 'reopened', NULL);
    ELSIF v_part.assignee_id = v_uid THEN
      PERFORM public.work_clock_start(NULL, NULL, p_part);
    ELSE
      UPDATE public.work_task_parts SET status='in_process', started_at = COALESCE(started_at, now()) WHERE id=p_part;
      PERFORM public.work_refresh_task(v_part.task_id);
      PERFORM public.work_log(v_part.task_id, p_part, 'moved', jsonb_build_object('to', p_to));
    END IF;
  ELSE -- back to assigned (head)
    IF EXISTS (SELECT 1 FROM public.work_time_entries WHERE user_id = v_part.assignee_id AND ended_at IS NULL AND part_id = p_part) THEN
      PERFORM public.work__stop_running(v_part.assignee_id, false);
    END IF;
    UPDATE public.work_task_parts SET status='assigned', finished_at=NULL, cost_amount=NULL, seconds=NULL WHERE id=p_part;
    PERFORM public.work_refresh_task(v_part.task_id);
    PERFORM public.work_log(v_part.task_id, p_part, 'moved', jsonb_build_object('to', p_to));
  END IF;
END;
$function$;

NOTIFY pgrst, 'reload schema';

-- VERIFY:
-- SELECT pg_get_functiondef('public.work_move_part(uuid,text)'::regprocedure) LIKE '%v_rank_from = 3 AND p_to = ''in_process''%' AS reopen_own_allowed;  -- true
