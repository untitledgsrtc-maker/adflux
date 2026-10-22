-- Phase 436 (owner 2026-10-22, team feedback): 
--  1. a task with NO client could not be started ("pick a client first") - Riya / Diya / Khushbu office tasks. Now it runs on an internal client "Untitled Internal".
--  2. the "Still working?" idle question only ran for people switched on for activity tracking (only Safika). It now runs for everyone with a running
--     timer; screenshots / window titles are still recorded ONLY for tracked people.
--  3. client "Collabkeep" added (Khushbu asked for it).
-- Idempotent. UNDO: delete the 'Untitled Internal' / 'Collabkeep' rows if unused; re-add the work_is_tracked line in work_agent_idle.
INSERT INTO public.work_projects (name, kind, created_by)
SELECT 'Untitled Internal', 'internal', (SELECT id FROM public.users WHERE role='admin' AND is_active ORDER BY created_at LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM public.work_projects WHERE lower(btrim(name)) = 'untitled internal');
INSERT INTO public.work_projects (name, kind, created_by)
SELECT 'Collabkeep', 'client', (SELECT id FROM public.users WHERE role='admin' AND is_active ORDER BY created_at LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM public.work_projects WHERE lower(btrim(name)) = 'collabkeep');

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
  -- Phase 436: a task with no client (HR / finance / office tasks) is internal time, not an error.
  IF v_project IS NULL AND p_part IS NOT NULL THEN SELECT id INTO v_project FROM public.work_projects WHERE lower(btrim(name)) = 'untitled internal' LIMIT 1; END IF;
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
$function$
;

CREATE OR REPLACE FUNCTION public.work_agent_idle(p_entry uuid, p_idle_began timestamp with time zone, p_decision text, p_idle_seconds integer DEFAULT 0)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid(); r public.work_time_entries%ROWTYPE; v_end timestamptz;
BEGIN
  IF v_uid IS NULL OR NOT public.work_is_member() THEN RAISE EXCEPTION 'not on the timeclock' USING ERRCODE='42501'; END IF;
  IF p_decision NOT IN ('still_working', 'break', 'stop', 'auto_stopped') THEN RAISE EXCEPTION 'bad decision'; END IF;
  -- Phase 436: the "Still working?" question applies to everyone with a running timer (it records only idle seconds, no screens / windows).
  SELECT * INTO r FROM public.work_time_entries WHERE id = p_entry AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'that timer is not yours' USING ERRCODE='42501'; END IF;
  INSERT INTO public.work_idle_events (user_id, entry_id, idle_began, decision, idle_seconds)
  VALUES (v_uid, p_entry, p_idle_began, p_decision, GREATEST(0, COALESCE(p_idle_seconds, 0)))
  ON CONFLICT (user_id, idle_began) DO NOTHING;
  IF p_decision = 'break' THEN
    UPDATE public.work_time_entries SET break_seconds = break_seconds + LEAST(GREATEST(0, COALESCE(p_idle_seconds, 0)), 7200)
     WHERE id = r.id;
  ELSIF p_decision IN ('stop', 'auto_stopped') AND r.ended_at IS NULL THEN
    v_end := GREATEST(p_idle_began, r.started_at + interval '1 second');
    IF v_end > now() THEN v_end := now(); END IF;
    UPDATE public.work_time_entries SET ended_at = v_end, auto_stopped = (p_decision = 'auto_stopped') WHERE id = r.id;
    IF r.task_id IS NOT NULL THEN
      PERFORM public.work_log(r.task_id, r.part_id, 'paused',
        jsonb_build_object('seconds', extract(epoch FROM (v_end - r.started_at))::int, 'idle', p_decision));
    END IF;
  END IF;
END;
$function$
;
NOTIFY pgrst, 'reload schema';
