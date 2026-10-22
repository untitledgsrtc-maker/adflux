-- Phase 418 (owner 2026-10-19): delete a Work task, kept in an archive so nothing disappears without a trace.
-- Who: the person who created the task, or a head / admin. A creator who is not a head can delete only while nobody has started
-- it, no time is logged, it is not finished / postponed, and no due date has passed (else "ask a head").
-- Delete = copy the whole task (parts, steps, comments, log) into work_deleted_tasks, then remove the live rows. Every list, board,
-- report, score and nudge therefore stops seeing it with no change. Hours already logged stay (time entries only lose the link).
-- work_restore_task(archive id) puts it back (admin only). Idempotent.

CREATE TABLE IF NOT EXISTS public.work_deleted_tasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     uuid NOT NULL,
  title       text,
  deleted_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  deleted_at  timestamptz NOT NULL DEFAULT now(),
  restored_at timestamptz,
  snapshot    jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS work_deleted_tasks_task_idx ON public.work_deleted_tasks (task_id);
ALTER TABLE public.work_deleted_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS work_deleted_tasks_admin_read ON public.work_deleted_tasks;
CREATE POLICY work_deleted_tasks_admin_read ON public.work_deleted_tasks FOR SELECT TO authenticated
  USING (COALESCE(public.get_my_role() IN ('admin','co_owner'), false));
REVOKE ALL ON public.work_deleted_tasks FROM anon, authenticated;
GRANT SELECT ON public.work_deleted_tasks TO authenticated;

CREATE OR REPLACE FUNCTION public.work_delete_task(p_task uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_task public.work_tasks%ROWTYPE; v_head boolean; v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
        v_actor text; r record; v_snap jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.work_is_active_user() THEN RAISE EXCEPTION 'login required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_task FROM public.work_tasks WHERE id = p_task FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'task not found'; END IF;
  v_head := COALESCE(public.work_is_head(), false);
  IF NOT (v_head OR v_task.created_by = v_uid) THEN
    RAISE EXCEPTION 'only the person who created this task, or a head, can delete it' USING ERRCODE='42501';
  END IF;
  IF NOT v_head THEN
    -- Phase 457: the creator may delete unless work really happened (time logged / started / finished).
    -- A late due date, or a part that was declined / postponed, no longer blocks.
    IF EXISTS (SELECT 1 FROM public.work_task_parts p WHERE p.task_id = p_task AND (p.started_at IS NOT NULL OR p.finished_at IS NOT NULL OR p.status = 'finished'))
       OR EXISTS (SELECT 1 FROM public.work_time_entries e WHERE e.task_id = p_task) THEN
      RAISE EXCEPTION 'someone has already worked on this task - ask a head to delete it';
    END IF;
  END IF;
  -- stop a timer that is running on one of its parts (head deleting live work)
  FOR r IN SELECT DISTINCT e.user_id FROM public.work_time_entries e WHERE e.task_id = p_task AND e.ended_at IS NULL LOOP
    PERFORM public.work__stop_running(r.user_id, false);
  END LOOP;
  SELECT jsonb_build_object(
           'task',     to_jsonb(v_task),
           'parts',    COALESCE((SELECT jsonb_agg(to_jsonb(p)) FROM public.work_task_parts p WHERE p.task_id = p_task), '[]'::jsonb),
           'steps',    COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM public.work_task_steps s WHERE s.task_id = p_task), '[]'::jsonb),
           'comments', COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM public.work_task_comments c WHERE c.task_id = p_task), '[]'::jsonb),
           'log',      COALESCE((SELECT jsonb_agg(to_jsonb(l)) FROM public.work_task_log l WHERE l.task_id = p_task), '[]'::jsonb))
    INTO v_snap;
  INSERT INTO public.work_deleted_tasks (task_id, title, deleted_by, snapshot) VALUES (p_task, v_task.title, v_uid, v_snap);
  SELECT name INTO v_actor FROM public.users WHERE id = v_uid;
  FOR r IN SELECT DISTINCT p.assignee_id FROM public.work_task_parts p WHERE p.task_id = p_task AND p.assignee_id IS NOT NULL AND p.assignee_id <> v_uid LOOP
    PERFORM public.work_push(r.assignee_id, 'Task deleted', COALESCE(v_actor,'Someone') || ' deleted: ' || left(v_task.title, 80), '/my-work', 'work-del-' || p_task::text);
  END LOOP;
  DELETE FROM public.work_tasks WHERE id = p_task;
END;
$$;
REVOKE ALL ON FUNCTION public.work_delete_task(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.work_delete_task(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.work_restore_task(p_archive uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_a public.work_deleted_tasks%ROWTYPE; v_s jsonb; x jsonb;
BEGIN
  IF auth.uid() IS NULL OR COALESCE(public.get_my_role() IN ('admin','co_owner'), false) = false THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_a FROM public.work_deleted_tasks WHERE id = p_archive FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'archive row not found'; END IF;
  IF v_a.restored_at IS NOT NULL THEN RAISE EXCEPTION 'already restored'; END IF;
  IF EXISTS (SELECT 1 FROM public.work_tasks WHERE id = v_a.task_id) THEN RAISE EXCEPTION 'task already exists'; END IF;
  v_s := v_a.snapshot;
  INSERT INTO public.work_tasks SELECT * FROM jsonb_populate_record(NULL::public.work_tasks, v_s->'task');
  FOR x IN SELECT * FROM jsonb_array_elements(v_s->'parts')    LOOP INSERT INTO public.work_task_parts    SELECT * FROM jsonb_populate_record(NULL::public.work_task_parts, x); END LOOP;
  FOR x IN SELECT * FROM jsonb_array_elements(v_s->'steps')    LOOP INSERT INTO public.work_task_steps    SELECT * FROM jsonb_populate_record(NULL::public.work_task_steps, x); END LOOP;
  FOR x IN SELECT * FROM jsonb_array_elements(v_s->'comments') LOOP INSERT INTO public.work_task_comments SELECT * FROM jsonb_populate_record(NULL::public.work_task_comments, x); END LOOP;
  FOR x IN SELECT * FROM jsonb_array_elements(v_s->'log')      LOOP INSERT INTO public.work_task_log      SELECT * FROM jsonb_populate_record(NULL::public.work_task_log, x); END LOOP;
  UPDATE public.work_deleted_tasks SET restored_at = now() WHERE id = p_archive;
  RETURN v_a.task_id;
END;
$$;
REVOKE ALL ON FUNCTION public.work_restore_task(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.work_restore_task(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
