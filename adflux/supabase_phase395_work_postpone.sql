-- supabase_phase395_work_postpone.sql
-- Phase 395 (owner 16 Oct 2026): a 4th board status POSTPONED. Dropping a task there asks WHO asked for the delay (one or more
-- team members and/or a client name) and the NEW DATE; on that date (07:05 IST, working days) it returns to Assigned by itself.
-- Postponing: the person who owns the part, or any head. Tagged team members can see the task. No approval step.
-- Idempotent.

ALTER TABLE public.work_task_parts ADD COLUMN IF NOT EXISTS postponed_until     date;
ALTER TABLE public.work_task_parts ADD COLUMN IF NOT EXISTS postponed_by_users  uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE public.work_task_parts ADD COLUMN IF NOT EXISTS postponed_by_client text;
ALTER TABLE public.work_task_parts ADD COLUMN IF NOT EXISTS postponed_reason    text;
ALTER TABLE public.work_task_parts ADD COLUMN IF NOT EXISTS postponed_at        timestamptz;
ALTER TABLE public.work_task_parts ADD COLUMN IF NOT EXISTS postpone_count      int NOT NULL DEFAULT 0;
ALTER TABLE public.work_task_parts ADD COLUMN IF NOT EXISTS returned_at         timestamptz;

ALTER TABLE public.work_task_parts DROP CONSTRAINT IF EXISTS work_task_parts_status_check;
ALTER TABLE public.work_task_parts ADD CONSTRAINT work_task_parts_status_check
  CHECK (status = ANY (ARRAY['assigned','in_process','finished','postponed']));
CREATE INDEX IF NOT EXISTS work_parts_postponed_idx ON public.work_task_parts (postponed_until) WHERE status = 'postponed';

-- clients read the new columns (cost_amount stays hidden)
GRANT SELECT (postponed_until, postponed_by_users, postponed_by_client, postponed_reason, postponed_at, postpone_count, returned_at)
  ON public.work_task_parts TO authenticated;

-- work_can_see_task stays EXACTLY as in phase 365 (it also gates comments / checklist writes). Tagged people get a READ-ONLY helper
-- used only by the task + part SELECT policies, so they can see the task but not write anything on it.
CREATE OR REPLACE FUNCTION public.work_can_see_task(p_task uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    public.work_is_active_user() AND (
      public.work_is_head()
      OR EXISTS (SELECT 1 FROM public.work_tasks t WHERE t.id = p_task AND t.created_by = auth.uid())
      OR EXISTS (SELECT 1 FROM public.work_task_parts p WHERE p.task_id = p_task AND p.assignee_id = auth.uid())
    ), false);
$function$;

CREATE OR REPLACE FUNCTION public.work_can_read_task(p_task uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(
    public.work_can_see_task(p_task)
    OR (public.work_is_active_user()
        AND EXISTS (SELECT 1 FROM public.work_task_parts p WHERE p.task_id = p_task AND auth.uid() = ANY (p.postponed_by_users))), false);
$$;
REVOKE ALL ON FUNCTION public.work_can_read_task(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.work_can_read_task(uuid) TO authenticated;
DROP POLICY IF EXISTS work_tasks_read ON public.work_tasks;
CREATE POLICY work_tasks_read ON public.work_tasks FOR SELECT TO authenticated USING (public.work_can_read_task(id));
DROP POLICY IF EXISTS work_parts_read ON public.work_task_parts;
CREATE POLICY work_parts_read ON public.work_task_parts FOR SELECT TO authenticated USING (public.work_can_read_task(task_id));

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
  IF v_rank_to < v_rank_from AND NOT v_head THEN RAISE EXCEPTION 'only the head can move a task back'; END IF;
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

CREATE OR REPLACE FUNCTION public.work_clock_start(p_project uuid, p_label text, p_part uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_part public.work_task_parts%ROWTYPE; v_task public.work_tasks%ROWTYPE;
        v_project uuid := p_project; v_label text := NULLIF(btrim(p_label), ''); v_entry uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.work_is_member() THEN RAISE EXCEPTION 'not on the timeclock' USING ERRCODE='42501'; END IF;
  IF p_part IS NOT NULL THEN
    SELECT * INTO v_part FROM public.work_task_parts WHERE id = p_part FOR UPDATE;
    IF NOT FOUND OR v_part.assignee_id <> v_uid THEN RAISE EXCEPTION 'that task is not yours' USING ERRCODE='42501'; END IF;
    IF v_part.status = 'finished' THEN RAISE EXCEPTION 'this task is already finished'; END IF;
    IF v_part.status = 'postponed' THEN RAISE EXCEPTION 'this task is postponed until %', to_char(v_part.postponed_until, 'DD Mon'); END IF;
    SELECT * INTO v_task FROM public.work_tasks WHERE id = v_part.task_id;
    v_project := COALESCE(v_project, v_task.project_id);
    v_label := COALESCE(v_label, v_task.title);
  END IF;
  IF v_project IS NULL THEN RAISE EXCEPTION 'pick a client first'; END IF;
  IF v_label IS NULL THEN RAISE EXCEPTION 'type what you are doing'; END IF;
  IF length(v_label) > 80 THEN v_label := left(v_label, 80); END IF;
  PERFORM public.work__stop_running(v_uid, false);
  INSERT INTO public.work_time_entries (user_id, project_id, task_id, part_id, task_label, started_at)
  VALUES (v_uid, v_project, v_task.id, v_part.id, v_label, now())
  RETURNING id INTO v_entry;
  IF p_part IS NOT NULL THEN
    UPDATE public.work_task_parts SET status = 'in_process', started_at = COALESCE(started_at, now()) WHERE id = p_part;
    PERFORM public.work_refresh_task(v_task.id);
    PERFORM public.work_log(v_task.id, p_part, 'started', NULL);
  END IF;
  RETURN v_entry;
END;
$function$;

-- work_finish_part: a postponed part cannot be finished directly (canonical copy: this file, over phase 365 / 382)
CREATE OR REPLACE FUNCTION public.work_finish_part(p_part uuid, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_part public.work_task_parts%ROWTYPE; v_task public.work_tasks%ROWTYPE;
        v_secs int; v_cost numeric; v_name text; v_done boolean;
BEGIN
  IF v_uid IS NULL OR NOT public.work_is_active_user() THEN RAISE EXCEPTION 'login required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_part FROM public.work_task_parts WHERE id = p_part FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'task not found'; END IF;
  IF v_part.assignee_id <> v_uid AND NOT public.work_is_head() THEN RAISE EXCEPTION 'not your task' USING ERRCODE='42501'; END IF;
  IF v_part.status = 'finished' THEN RETURN; END IF;
  IF v_part.status = 'postponed' THEN RAISE EXCEPTION 'bring this task back before finishing it'; END IF;
  -- stop the assignee's running timer if it is on this part
  IF EXISTS (SELECT 1 FROM public.work_time_entries WHERE user_id = v_part.assignee_id AND ended_at IS NULL AND part_id = p_part) THEN
    PERFORM public.work__stop_running(v_part.assignee_id, false);
  END IF;
  SELECT COALESCE(sum(GREATEST(0, extract(epoch FROM (ended_at - started_at)) - break_seconds)), 0)::int INTO v_secs
    FROM public.work_time_entries WHERE part_id = p_part AND ended_at IS NOT NULL AND status = 'approved';
  v_cost := round(v_secs / 3600.0 * public.work_user_rate(v_part.assignee_id), 2);
  UPDATE public.work_task_parts
     SET status = 'finished', finished_at = now(), finish_note = NULLIF(btrim(p_note), ''),
         seconds = v_secs, cost_amount = v_cost, started_at = COALESCE(started_at, now())
   WHERE id = p_part;
  PERFORM public.work_refresh_task(v_part.task_id);
  SELECT * INTO v_task FROM public.work_tasks WHERE id = v_part.task_id;
  PERFORM public.work_log(v_part.task_id, p_part, 'finished', jsonb_build_object('seconds', v_secs, 'by_head', v_uid <> v_part.assignee_id));
  v_done := (v_task.status = 'finished');
  IF v_task.created_by IS NOT NULL AND v_task.created_by <> v_uid THEN
    SELECT name INTO v_name FROM public.users WHERE id = v_part.assignee_id;
    PERFORM public.work_push(v_task.created_by,
      CASE WHEN v_done THEN 'Task finished' ELSE 'Part finished' END,
      COALESCE(v_name,'Someone') || ' finished: ' || left(v_task.title, 80), '/my-work?tab=asked', 'work-done-' || v_task.id::text);
  END IF;
END;
$function$;

-- the Postpone box
CREATE OR REPLACE FUNCTION public.work_postpone_part(p_part uuid, p_until date, p_by_users uuid[], p_by_client text, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_part public.work_task_parts%ROWTYPE; v_task public.work_tasks%ROWTYPE;
        v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date; v_users uuid[]; v_client text := NULLIF(btrim(p_by_client), '');
        v_actor text; v_names text; v_u uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.work_is_active_user() THEN RAISE EXCEPTION 'login required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_part FROM public.work_task_parts WHERE id = p_part FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'task not found'; END IF;
  IF v_part.assignee_id <> v_uid AND NOT public.work_is_head() THEN RAISE EXCEPTION 'only the owner of the task or a head can postpone it' USING ERRCODE='42501'; END IF;
  IF v_part.status = 'finished' THEN RAISE EXCEPTION 'this task is already finished'; END IF;
  IF p_until IS NULL OR p_until <= v_today THEN RAISE EXCEPTION 'pick a date after today'; END IF;
  IF p_until > v_today + 120 THEN RAISE EXCEPTION 'pick a date within 120 days'; END IF;
  SELECT COALESCE(array_agg(DISTINCT u.id), '{}') INTO v_users FROM public.users u WHERE u.id = ANY (COALESCE(p_by_users, '{}')) AND u.is_active AND u.role <> 'agency';
  IF COALESCE(array_length(v_users, 1), 0) > 6 THEN RAISE EXCEPTION 'tag at most 6 people'; END IF;
  IF COALESCE(array_length(v_users, 1), 0) = 0 AND v_client IS NULL THEN RAISE EXCEPTION 'say who asked for the delay (a team member or the client)'; END IF;
  -- a running timer on this task stops first
  IF EXISTS (SELECT 1 FROM public.work_time_entries WHERE user_id = v_part.assignee_id AND ended_at IS NULL AND part_id = p_part) THEN
    PERFORM public.work__stop_running(v_part.assignee_id, false);
  END IF;
  UPDATE public.work_task_parts
     SET status = 'postponed', postponed_until = p_until, postponed_by_users = v_users, postponed_by_client = left(v_client, 80),
         postponed_reason = left(NULLIF(btrim(p_reason), ''), 200), postponed_at = now(), postpone_count = postpone_count + 1
   WHERE id = p_part;
  PERFORM public.work_refresh_task(v_part.task_id);
  SELECT * INTO v_task FROM public.work_tasks WHERE id = v_part.task_id;
  SELECT COALESCE(string_agg(u.name, ', '), '') INTO v_names FROM public.users u WHERE u.id = ANY (v_users);
  v_names := trim(both ', ' FROM v_names || CASE WHEN v_client IS NOT NULL THEN ', ' || v_client || ' (client)' ELSE '' END);
  PERFORM public.work_log(v_part.task_id, p_part, 'postponed', jsonb_build_object('until', p_until, 'by', v_names, 'reason', p_reason, 'was_due', v_part.due_date));
  SELECT name INTO v_actor FROM public.users WHERE id = v_uid;
  -- tell the tagged people, the task creator and the owner (not the person who did it)
  FOR v_u IN SELECT DISTINCT x FROM unnest(v_users || ARRAY[v_task.created_by, v_part.assignee_id]) AS x WHERE x IS NOT NULL AND x <> v_uid LOOP
    PERFORM public.work_push(v_u, 'Task postponed', COALESCE(v_actor, 'Someone') || ' postponed ' || left(v_task.title, 60) || ' to ' || to_char(p_until, 'DD Mon') || ' (asked by ' || v_names || ')', '/my-work', 'work-post-' || p_part::text);
  END LOOP;
END;
$$;

-- daily: postponed tasks whose date has come go back to Assigned (due that day), the owner + creator are told
CREATE OR REPLACE FUNCTION public.work_return_postponed() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date; r record; v_n int := 0; v_title text; v_creator uuid;
BEGIN
  IF public.is_off_day(v_today) THEN RETURN 0; END IF;      -- Sundays and holidays: the next working day picks them up
  FOR r IN SELECT id, task_id, assignee_id FROM public.work_task_parts WHERE status = 'postponed' AND postponed_until <= v_today FOR UPDATE LOOP
    UPDATE public.work_task_parts SET status = 'assigned', due_date = v_today, returned_at = now(), postponed_until = NULL, postponed_by_users = '{}', postponed_by_client = NULL WHERE id = r.id;
    PERFORM public.work_refresh_task(r.task_id);
    INSERT INTO public.work_task_log (task_id, part_id, user_id, event, detail) VALUES (r.task_id, r.id, NULL, 'returned', NULL);
    SELECT title, created_by INTO v_title, v_creator FROM public.work_tasks WHERE id = r.task_id;
    PERFORM public.work_push(r.assignee_id, 'Back on your list', left(COALESCE(v_title, 'A task'), 80) || ' is back in Assigned', '/my-work', 'work-ret-' || r.id::text);
    IF v_creator IS NOT NULL AND v_creator <> r.assignee_id THEN
      PERFORM public.work_push(v_creator, 'Postponed task is back', left(COALESCE(v_title, 'A task'), 80) || ' is back in Assigned', '/my-work', 'work-retc-' || r.id::text);
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

-- lock down: clients may call the box; the daily return is cron only
REVOKE ALL ON FUNCTION public.work_postpone_part(uuid, date, uuid[], text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.work_postpone_part(uuid, date, uuid[], text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.work_return_postponed() FROM PUBLIC, anon, authenticated;

DO $$ BEGIN PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'work-return-postponed'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('work-return-postponed', '35 1 * * *', $$SELECT public.work_return_postponed()$$);   -- 07:05 IST

NOTIFY pgrst, 'reload schema';
-- VERIFY (also work_can_read_task exists, work_can_see_task has no postponed_by_users): SELECT (SELECT pg_get_constraintdef(oid) LIKE '%postponed%' FROM pg_constraint WHERE conname='work_task_parts_status_check') AS st,
--   (SELECT count(*) FROM cron.job WHERE jobname='work-return-postponed') AS cron,
--   has_function_privilege('anon','public.work_postpone_part(uuid,date,uuid[],text,text)','EXECUTE') AS anon_exec,
--   has_function_privilege('authenticated','public.work_return_postponed()','EXECUTE') AS client_return;   -- t / 1 / f / f
