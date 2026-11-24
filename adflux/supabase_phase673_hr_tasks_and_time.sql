-- supabase_phase673_hr_tasks_and_time.sql (24-11-2026)
-- Owner 24-11-2026: "block her giving tasks in my work too" + "old approval forgotten time was good".
-- 1. HR can create tasks / repeating tasks only for HERSELF (any page: My Work, Team Work, templates).
--    Enforced on the rows themselves, so every path is covered. Background jobs (no signed-in user)
--    and every other role are untouched.
-- 2. HR may approve / decline forgotten-time requests again (work_decide_time), never her own.

CREATE OR REPLACE FUNCTION public.work_hr_only_self()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NEW.assignee_id IS DISTINCT FROM auth.uid()
     AND public.get_my_role() = 'hr'
     AND NOT public.work_is_head() THEN
    RAISE EXCEPTION 'HR can only add tasks for herself - ask a Team Work head to give tasks to others.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.work_hr_only_self() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_work_parts_hr_only_self ON public.work_task_parts;
CREATE TRIGGER trg_work_parts_hr_only_self
  BEFORE INSERT OR UPDATE OF assignee_id ON public.work_task_parts
  FOR EACH ROW EXECUTE FUNCTION public.work_hr_only_self();

DROP TRIGGER IF EXISTS trg_work_templates_hr_only_self ON public.work_templates;
CREATE TRIGGER trg_work_templates_hr_only_self
  BEFORE INSERT OR UPDATE OF assignee_id ON public.work_templates
  FOR EACH ROW EXECUTE FUNCTION public.work_hr_only_self();

CREATE OR REPLACE FUNCTION public.work_decide_time(p_entry uuid, p_approve boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_user uuid;
BEGIN
  -- Phase 673 (owner 24-11-2026): HR approves / declines forgotten time again (as when she was a head),
  -- but never her own entry.
  IF v_uid IS NULL OR NOT (public.work_is_head() OR public.get_my_role() = 'hr') THEN RAISE EXCEPTION 'head only' USING ERRCODE='42501'; END IF;
  IF NOT public.work_is_head() AND EXISTS (SELECT 1 FROM public.work_time_entries WHERE id = p_entry AND user_id = v_uid) THEN
    RAISE EXCEPTION 'you cannot decide your own time - a head decides it' USING ERRCODE='42501';
  END IF;
  UPDATE public.work_time_entries
     SET status = CASE WHEN p_approve THEN 'approved' ELSE 'declined' END, decided_by = v_uid, decided_at = now()
   WHERE id = p_entry AND status = 'pending'
  RETURNING user_id INTO v_user;
  IF v_user IS NOT NULL THEN
    PERFORM public.work_push(v_user, CASE WHEN p_approve THEN 'Time approved' ELSE 'Time declined' END,
                             'Your added-later time was ' || CASE WHEN p_approve THEN 'approved' ELSE 'declined' END,
                             '/my-work', 'work-time-' || p_entry::text);
  END IF;
END;
$function$;

NOTIFY pgrst, 'reload schema';

-- VERIFY: expect self_triggers=2, decide_allows_hr=true
SELECT
  (SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_work_parts_hr_only_self', 'trg_work_templates_hr_only_self')) AS self_triggers,
  (SELECT pg_get_functiondef(oid) LIKE '%get_my_role() = ''hr''%' FROM pg_proc WHERE proname = 'work_decide_time') AS decide_allows_hr;
