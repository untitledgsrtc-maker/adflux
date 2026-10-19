-- supabase_phase413_work_reject.sql
-- Phase 413 (owner 19 Oct 2026): reject a task WITH A REASON, two ways.
--   1. DECLINE: the person given a task says "I can't do this" + reason. Task stays in Assigned with a red "Declined" note;
--      the person who created it is told and can give it to someone else.
--   2. SEND BACK: a head / the task creator rejects FINISHED work + reason. Part goes back to Assigned (cost + time cleared, like a
--      reopen) and the person is told.
-- No new status. The note clears itself when the task is reassigned or finished again. Idempotent.

ALTER TABLE public.work_task_parts ADD COLUMN IF NOT EXISTS reject_kind   text;
ALTER TABLE public.work_task_parts ADD COLUMN IF NOT EXISTS reject_reason text;
ALTER TABLE public.work_task_parts ADD COLUMN IF NOT EXISTS rejected_by   uuid;
ALTER TABLE public.work_task_parts ADD COLUMN IF NOT EXISTS rejected_at   timestamptz;
ALTER TABLE public.work_task_parts DROP CONSTRAINT IF EXISTS work_task_parts_reject_kind_check;
ALTER TABLE public.work_task_parts ADD CONSTRAINT work_task_parts_reject_kind_check CHECK (reject_kind IS NULL OR reject_kind IN ('declined','sent_back'));

GRANT SELECT (reject_kind, reject_reason, rejected_by, rejected_at) ON public.work_task_parts TO authenticated;

-- the note clears when the part changes hands or is finished again
CREATE OR REPLACE FUNCTION public.work_clear_reject() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.assignee_id IS DISTINCT FROM OLD.assignee_id OR (NEW.status = 'finished' AND OLD.status <> 'finished') THEN
    NEW.reject_kind := NULL; NEW.reject_reason := NULL; NEW.rejected_by := NULL; NEW.rejected_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_work_clear_reject ON public.work_task_parts;
CREATE TRIGGER trg_work_clear_reject BEFORE UPDATE ON public.work_task_parts FOR EACH ROW EXECUTE FUNCTION public.work_clear_reject();

CREATE OR REPLACE FUNCTION public.work_reject_part(p_part uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_part public.work_task_parts%ROWTYPE; v_task public.work_tasks%ROWTYPE;
        v_reason text := left(btrim(COALESCE(p_reason, '')), 300); v_actor text; v_head boolean;
BEGIN
  IF v_uid IS NULL OR NOT public.work_is_active_user() THEN RAISE EXCEPTION 'login required' USING ERRCODE='42501'; END IF;
  IF char_length(v_reason) < 3 THEN RAISE EXCEPTION 'write the reason (at least a few words)'; END IF;
  SELECT * INTO v_part FROM public.work_task_parts WHERE id = p_part FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'task not found'; END IF;
  SELECT * INTO v_task FROM public.work_tasks WHERE id = v_part.task_id;
  v_head := public.work_is_head();
  SELECT name INTO v_actor FROM public.users WHERE id = v_uid;

  IF v_part.status = 'finished' THEN
    -- send finished work back
    IF NOT (v_head OR v_task.created_by = v_uid) THEN RAISE EXCEPTION 'only the person who asked, or a head, can send finished work back' USING ERRCODE='42501'; END IF;
    UPDATE public.work_task_parts
       SET status = 'assigned', finished_at = NULL, cost_amount = NULL, seconds = NULL,
           reject_kind = 'sent_back', reject_reason = v_reason, rejected_by = v_uid, rejected_at = now()
     WHERE id = p_part;
    PERFORM public.work_refresh_task(v_part.task_id);
    PERFORM public.work_log(v_part.task_id, p_part, 'sent_back', jsonb_build_object('reason', v_reason));
    IF v_part.assignee_id <> v_uid THEN
      PERFORM public.work_push(v_part.assignee_id, 'Task sent back', COALESCE(v_actor, 'Someone') || ' sent back ' || left(v_task.title, 60) || ': ' || left(v_reason, 100), '/my-work', 'work-sb-' || p_part::text);
    END IF;
  ELSE
    -- decline an open task
    IF v_part.assignee_id <> v_uid AND NOT v_head THEN RAISE EXCEPTION 'only the person it is assigned to can decline it' USING ERRCODE='42501'; END IF;
    IF v_part.status = 'postponed' THEN RAISE EXCEPTION 'bring this task back before declining it'; END IF;
    IF EXISTS (SELECT 1 FROM public.work_time_entries WHERE user_id = v_part.assignee_id AND ended_at IS NULL AND part_id = p_part) THEN
      PERFORM public.work__stop_running(v_part.assignee_id, false);
    END IF;
    UPDATE public.work_task_parts
       SET status = 'assigned',
           reject_kind = 'declined', reject_reason = v_reason, rejected_by = v_uid, rejected_at = now()
     WHERE id = p_part;
    PERFORM public.work_refresh_task(v_part.task_id);
    PERFORM public.work_log(v_part.task_id, p_part, 'declined', jsonb_build_object('reason', v_reason));
    IF v_task.created_by IS NOT NULL AND v_task.created_by <> v_uid THEN
      PERFORM public.work_push(v_task.created_by, 'Task declined', COALESCE(v_actor, 'Someone') || ' declined ' || left(v_task.title, 60) || ': ' || left(v_reason, 100), '/my-work?tab=asked', 'work-dec-' || p_part::text);
    END IF;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.work_reject_part(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.work_reject_part(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY:
-- SELECT count(*) FROM information_schema.columns WHERE table_name='work_task_parts' AND column_name IN ('reject_kind','reject_reason','rejected_by','rejected_at');  -- 4
-- SELECT count(*) FROM pg_proc WHERE proname IN ('work_reject_part','work_clear_reject');  -- 2
