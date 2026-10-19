-- Phase 427 (owner 2026-10-19): remove ONE person from a task that has other people on it.
-- Head/admin or the task creator; not for a finished part; the last remaining person cannot be removed (delete the task instead).
-- Idempotent. UNDO: DROP FUNCTION public.work_remove_part(uuid);
CREATE OR REPLACE FUNCTION public.work_remove_part(p_part uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_part public.work_task_parts%ROWTYPE; v_creator uuid; v_title text;
BEGIN
  SELECT * INTO v_part FROM public.work_task_parts WHERE id = p_part FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'task not found'; END IF;
  SELECT created_by, title INTO v_creator, v_title FROM public.work_tasks WHERE id = v_part.task_id;
  IF v_uid IS NULL OR NOT (public.work_is_head() OR v_creator = v_uid) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE='42501'; END IF;
  IF v_part.status = 'finished' THEN RAISE EXCEPTION 'already finished'; END IF;
  IF (SELECT count(*) FROM public.work_task_parts WHERE task_id = v_part.task_id) < 2 THEN
    RAISE EXCEPTION 'last person on the task - delete the task instead';
  END IF;
  IF EXISTS (SELECT 1 FROM public.work_time_entries WHERE user_id = v_part.assignee_id AND ended_at IS NULL AND part_id = p_part) THEN
    PERFORM public.work__stop_running(v_part.assignee_id, false);
  END IF;
  DELETE FROM public.work_task_parts WHERE id = p_part;
  PERFORM public.work_refresh_task(v_part.task_id);
  PERFORM public.work_log(v_part.task_id, NULL, 'removed', jsonb_build_object('user', v_part.assignee_id));
  PERFORM public.work_push(v_part.assignee_id, 'Task removed from you', left(v_title, 80), '/my-work', 'work-task-' || v_part.task_id::text);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.work_remove_part(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.work_remove_part(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
