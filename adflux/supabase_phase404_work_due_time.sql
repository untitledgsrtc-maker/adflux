-- supabase_phase404_work_due_time.sql
-- Phase 404: optional due TIME on a task part, plus a push when the time passes and the task is not finished.
-- Alert goes to the assignee once (due_alerted_at), only inside push hours (is_push_allowed_now) - it waits for 9 AM otherwise.
-- Idempotent.
ALTER TABLE public.work_task_parts ADD COLUMN IF NOT EXISTS due_time time;
ALTER TABLE public.work_task_parts ADD COLUMN IF NOT EXISTS due_alerted_at timestamptz;

DROP FUNCTION IF EXISTS public.work_create_task(text, uuid, text, date, jsonb, text[]);
CREATE OR REPLACE FUNCTION public.work_create_task(p_title text, p_project uuid, p_note text, p_due date, p_parts jsonb, p_steps text[] DEFAULT NULL::text[], p_due_time time DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_task uuid; v_part jsonb; v_assignee uuid; v_i int := 0; v_s text; v_name text;
BEGIN
  IF v_uid IS NULL OR NOT public.work_is_active_user() THEN RAISE EXCEPTION 'login required' USING ERRCODE='42501'; END IF;
  IF NULLIF(btrim(p_title), '') IS NULL THEN RAISE EXCEPTION 'task needs a name'; END IF;
  IF p_parts IS NULL OR jsonb_typeof(p_parts) <> 'array' OR jsonb_array_length(p_parts) = 0 THEN
    RAISE EXCEPTION 'pick at least one person';
  END IF;
  IF jsonb_array_length(p_parts) > 12 THEN RAISE EXCEPTION 'too many people on one task'; END IF;
  INSERT INTO public.work_tasks (title, project_id, note, created_by, due_date)
  VALUES (left(btrim(p_title), 120), p_project, NULLIF(btrim(p_note), ''), v_uid, p_due)
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
      PERFORM public.work_push(v_assignee, 'New task for you', COALESCE(v_name,'Someone') || ': ' || left(btrim(p_title), 80),
                               '/my-work', 'work-task-' || v_task::text);
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
  PERFORM public.work_log(v_task, NULL, 'created', jsonb_build_object('parts', jsonb_array_length(p_parts)));
  RETURN v_task;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.work_create_task(text, uuid, text, date, jsonb, text[], time) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.work_create_task(text, uuid, text, date, jsonb, text[], time) TO authenticated;

CREATE OR REPLACE FUNCTION public.work_alert_due_time() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE n int := 0; r record;
BEGIN
  IF NOT public.is_push_allowed_now() THEN RETURN 0; END IF;
  FOR r IN
    SELECT p.id, p.assignee_id, p.due_time, t.title
      FROM public.work_task_parts p JOIN public.work_tasks t ON t.id = p.task_id
     WHERE p.due_time IS NOT NULL AND p.due_alerted_at IS NULL AND p.due_date IS NOT NULL
       AND p.status IN ('assigned','in_process')
       AND (p.due_date + p.due_time) AT TIME ZONE 'Asia/Kolkata' < now()
       AND (p.due_date + p.due_time) AT TIME ZONE 'Asia/Kolkata' > now() - interval '2 days'
  LOOP
    PERFORM public.work_push(r.assignee_id, 'Task not completed',
      'Your task "' || left(r.title, 70) || '" was due at ' || to_char(r.due_time, 'HH12:MI AM') || ' and is not completed.',
      '/my-work', 'work-due-' || r.id::text);
    UPDATE public.work_task_parts SET due_alerted_at = now() WHERE id = r.id;
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION public.work_alert_due_time() FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule('work-alert-due-time') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'work-alert-due-time');
SELECT cron.schedule('work-alert-due-time', '*/5 * * * *', 'SELECT public.work_alert_due_time();');
NOTIFY pgrst, 'reload schema';
-- VERIFY: SELECT (SELECT count(*) FROM information_schema.columns WHERE table_name='work_task_parts' AND column_name IN ('due_time','due_alerted_at')) AS cols,
--                (SELECT count(*) FROM cron.job WHERE jobname='work-alert-due-time') AS cron;   -- 2 / 1
