-- Phase 443 (owner 2026-10-22): "I was working (count these minutes)" no longer counts by itself.
-- The person must type a reason; the away minutes are held back (break) and a PENDING time request is created
-- (Team Work > Approvals, same list as forgotten time) for admin / a head to approve. HR (Riya) is made a Work head so she can approve too.
-- Hours have NO pay effect (Work module rule). Idempotent.
DROP FUNCTION IF EXISTS public.work_agent_idle(uuid, timestamptz, text, integer);
CREATE OR REPLACE FUNCTION public.work_agent_idle(p_entry uuid, p_idle_began timestamptz, p_decision text, p_idle_seconds integer DEFAULT 0, p_note text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid(); r public.work_time_entries%ROWTYPE; v_end timestamptz; v_rows int; v_idle int; v_note text := NULLIF(btrim(p_note), ''); v_claim_end timestamptz; v_to uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.work_is_member() THEN RAISE EXCEPTION 'not on the timeclock' USING ERRCODE='42501'; END IF;
  IF p_decision NOT IN ('still_working', 'break', 'stop', 'auto_stopped') THEN RAISE EXCEPTION 'bad decision'; END IF;
  v_idle := GREATEST(0, COALESCE(p_idle_seconds, 0));
  IF p_decision = 'still_working' AND (v_note IS NULL OR length(v_note) < 10) THEN
    RAISE EXCEPTION 'write the reason first (at least 10 letters)';
  END IF;
  SELECT * INTO r FROM public.work_time_entries WHERE id = p_entry AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'that timer is not yours' USING ERRCODE='42501'; END IF;
  INSERT INTO public.work_idle_events (user_id, entry_id, idle_began, decision, idle_seconds)
  VALUES (v_uid, p_entry, p_idle_began, p_decision, v_idle)
  ON CONFLICT (user_id, idle_began) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RETURN; END IF;   -- already answered once: never double-count / double-request
  IF p_decision = 'break' THEN
    UPDATE public.work_time_entries SET break_seconds = break_seconds + LEAST(v_idle, 7200) WHERE id = r.id;
  ELSIF p_decision = 'still_working' THEN
    -- not counted yet: held back like a break, and sent to admin / head for approval with the typed reason
    UPDATE public.work_time_entries SET break_seconds = break_seconds + LEAST(v_idle, 7200) WHERE id = r.id;
    v_claim_end := LEAST(now(), p_idle_began + make_interval(secs => GREATEST(60, LEAST(v_idle, 7200))));
    IF v_claim_end > p_idle_began THEN
      INSERT INTO public.work_time_entries (user_id, project_id, task_id, part_id, task_label, started_at, ended_at, source, status, note)
      VALUES (v_uid, r.project_id, r.task_id, r.part_id, left('Idle claim - ' || COALESCE(r.task_label, 'work'), 80), p_idle_began, v_claim_end, 'added_later', 'pending',
              left('Said working while idle: ' || v_note, 500));
      FOR v_to IN SELECT u.id FROM public.users u
                   WHERE u.is_active AND u.id <> v_uid AND (u.role = 'admin' OR EXISTS (SELECT 1 FROM public.work_members m WHERE m.user_id = u.id AND m.is_head)) LOOP
        PERFORM public.work_push(v_to, 'Idle time claim to review', left(v_note, 80), '/team-work', 'work-idleclaim-' || v_uid::text || '-' || to_char(p_idle_began, 'HH24MI'));
      END LOOP;
    END IF;
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
$function$;
REVOKE EXECUTE ON FUNCTION public.work_agent_idle(uuid, timestamptz, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.work_agent_idle(uuid, timestamptz, text, integer, text) TO authenticated;
-- HR can approve: make Riya a Work head
UPDATE public.work_members SET is_head = true WHERE user_id IN (SELECT id FROM public.users WHERE role = 'hr' AND is_active);
NOTIFY pgrst, 'reload schema';
