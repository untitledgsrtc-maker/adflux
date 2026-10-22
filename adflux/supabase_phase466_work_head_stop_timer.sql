-- Phase 466: a head / admin can stop someone's running Work timer (forgotten timer, person left).
-- Stops at "now" through the same helper as the person's own Stop; adds a note and tells the person.
CREATE OR REPLACE FUNCTION public.work_stop_person_timer(p_user uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_id uuid; v_task uuid; v_part uuid; v_secs int;
BEGIN
  IF v_uid IS NULL OR NOT public.work_is_active_user() OR NOT public.work_is_head() THEN
    RAISE EXCEPTION 'heads only' USING ERRCODE='42501';
  END IF;
  v_id := public.work__stop_running(p_user, false);
  IF v_id IS NULL THEN RETURN NULL; END IF;
  UPDATE public.work_time_entries
     SET note = left(coalesce(note || ' | ', '') || 'Stopped by a head', 500)
   WHERE id = v_id;
  SELECT task_id, part_id, extract(epoch FROM (ended_at - started_at))::int INTO v_task, v_part, v_secs
    FROM public.work_time_entries WHERE id = v_id;
  IF v_task IS NOT NULL THEN PERFORM public.work_log(v_task, v_part, 'paused', jsonb_build_object('seconds', v_secs, 'by_head', true)); END IF;
  BEGIN
    PERFORM public.work_push(p_user, 'Your timer was stopped', 'A head stopped your running timer. Start it again if you are still working.', '/my-work', 'work-headstop-' || v_id::text);
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.work_stop_person_timer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.work_stop_person_timer(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
-- VERIFY: SELECT has_function_privilege('anon','public.work_stop_person_timer(uuid)','execute') AS anon_exec, has_function_privilege('authenticated','public.work_stop_person_timer(uuid)','execute') AS auth_exec;
