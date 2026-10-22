-- Phase 448 (owner 2026-10-22): a task made BY HAND shows on the person's board at once (any due date);
-- a task the system made itself (repeating, from a won quote, HR / finance rules) shows only when it is near its due date.
-- work_tasks.is_auto marks the system-made ones. Idempotent. UNDO: ALTER TABLE public.work_tasks DROP COLUMN is_auto (and the trigger).
ALTER TABLE public.work_tasks ADD COLUMN IF NOT EXISTS is_auto boolean NOT NULL DEFAULT false;

-- system-made: repeating (template), from a quote, or created by the HR / finance rules (marked in the task log)
UPDATE public.work_tasks t SET is_auto = true
 WHERE NOT t.is_auto AND (t.template_id IS NOT NULL OR t.source_quote_id IS NOT NULL
   OR EXISTS (SELECT 1 FROM public.work_task_log l WHERE l.task_id = t.id AND l.event = 'created' AND (l.detail->>'rule' IS NOT NULL OR l.detail->>'recurring' IS NOT NULL)));

CREATE OR REPLACE FUNCTION public.work_tasks_mark_auto() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.template_id IS NOT NULL OR NEW.source_quote_id IS NOT NULL THEN NEW.is_auto := true; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_work_tasks_mark_auto ON public.work_tasks;
CREATE TRIGGER trg_work_tasks_mark_auto BEFORE INSERT ON public.work_tasks FOR EACH ROW EXECUTE FUNCTION public.work_tasks_mark_auto();

CREATE OR REPLACE FUNCTION public.work__plain_task(p_title text, p_due date, p_to uuid, p_creator uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_task uuid;
BEGIN
  IF p_to IS NULL OR EXISTS (SELECT 1 FROM public.work_tasks WHERE title = left(p_title,200) AND due_date IS NOT DISTINCT FROM p_due) THEN RETURN; END IF;
  INSERT INTO public.work_tasks (title, created_by, due_date, is_auto) VALUES (left(p_title,200), p_creator, p_due, true) RETURNING id INTO v_task;
  INSERT INTO public.work_task_parts (task_id, assignee_id, due_date) VALUES (v_task, p_to, p_due);
  INSERT INTO public.work_task_log (task_id, user_id, event, detail) VALUES (v_task, p_creator, 'created', '{"rule":"hr"}');
END $$;

CREATE OR REPLACE FUNCTION public.finance_mirror_to_work(p_title text, p_due date, p_hour int) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_to uuid; v_cr uuid; v_task uuid;
BEGIN
  SELECT u.id INTO v_to FROM public.users u WHERE u.role = 'accounts' AND u.is_active ORDER BY u.created_at LIMIT 1;
  SELECT id INTO v_cr FROM public.users WHERE role = 'admin' AND is_active ORDER BY created_at LIMIT 1;
  IF v_to IS NULL OR v_cr IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.work_tasks t JOIN public.work_task_parts p ON p.task_id = t.id
              WHERE t.title = left(p_title,200) AND p.assignee_id = v_to AND (t.due_date = p_due OR p.status <> 'finished')) THEN RETURN; END IF;
  INSERT INTO public.work_members (user_id, added_by) VALUES (v_to, v_cr) ON CONFLICT (user_id) DO NOTHING;
  INSERT INTO public.work_tasks (title, created_by, due_date, is_auto) VALUES (left(p_title,200), v_cr, p_due, true) RETURNING id INTO v_task;
  INSERT INTO public.work_task_parts (task_id, assignee_id, due_date, due_time) VALUES (v_task, v_to, p_due, make_time(p_hour, 0, 0));
  INSERT INTO public.work_task_log (task_id, user_id, event, detail) VALUES (v_task, v_cr, 'created', '{"rule":"finance"}');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

REVOKE EXECUTE ON FUNCTION public.work__plain_task(text,date,uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.finance_mirror_to_work(text,date,int) FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';
-- VERIFY: select count(*) filter (where is_auto) auto, count(*) filter (where not is_auto) manual from work_tasks;
