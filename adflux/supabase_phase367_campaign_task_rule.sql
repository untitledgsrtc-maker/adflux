-- Phase 367 - Every WON private LED quote creates its 3 campaign tasks (owner rule 2026-10-14).
--   1. Approve video from client        -> due the day the quote is marked Won
--   2. Share log report                 -> every Monday from the campaign start until its end date
--   3. End-date report + remove campaign-> due on the campaign end date
-- Assigned to the "campaign tasks" person (work_rule_settings, Safika). One set per QUOTE.
-- Also: (a) Won on a private LED quote now REQUIRES campaign start + end dates,
--       (b) an assignee may reassign their OWN task part to anyone,
--       (c) approved leave pushes the person the tasks that fall on that day,
--       (d) switches OFF yesterday's per-client weekly templates (the rule replaces them).
-- Idempotent. UNDO notes at the bottom. Dry-run: replace the final COMMIT with ROLLBACK.
BEGIN;

-- ---------- 1. settings + link columns ----------
CREATE TABLE IF NOT EXISTS public.work_rule_settings (
  key     text PRIMARY KEY,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL
);
ALTER TABLE public.work_rule_settings ENABLE ROW LEVEL SECURITY;      -- no policies: only DEFINER functions read it
INSERT INTO public.work_rule_settings (key, user_id)
SELECT 'campaign_tasks_assignee', u.id FROM public.users u
 WHERE u.role='staff' AND u.is_active AND u.name ILIKE 'safika%'
 ORDER BY u.created_at LIMIT 1
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.work_tasks     ADD COLUMN IF NOT EXISTS source_quote_id uuid REFERENCES public.quotes(id) ON DELETE SET NULL;
ALTER TABLE public.work_tasks     ADD COLUMN IF NOT EXISTS source_kind text;
ALTER TABLE public.work_templates ADD COLUMN IF NOT EXISTS source_quote_id uuid REFERENCES public.quotes(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS work_tasks_quote_kind_uk ON public.work_tasks (source_quote_id, source_kind) WHERE source_quote_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS work_templates_quote_uk  ON public.work_templates (source_quote_id) WHERE source_quote_id IS NOT NULL;

-- ---------- 2. Won needs campaign dates (private LED only) ----------
CREATE OR REPLACE FUNCTION public.quotes_won_needs_campaign_dates() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'won' AND OLD.status IS DISTINCT FROM 'won'
     AND NEW.segment = 'PRIVATE' AND NEW.media_type = 'LED_OTHER'
     AND (NEW.campaign_start_date IS NULL OR NEW.campaign_end_date IS NULL) THEN
    RAISE EXCEPTION 'Add the campaign start and end dates before marking this quote Won.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_quotes_won_needs_dates ON public.quotes;
CREATE TRIGGER trg_quotes_won_needs_dates BEFORE UPDATE OF status ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.quotes_won_needs_campaign_dates();

-- ---------- 3. the rule: create / refresh the 3 tasks for one quote ----------
CREATE OR REPLACE FUNCTION public.work_make_campaign_tasks(p_quote uuid, p_on_won boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  q public.quotes%ROWTYPE; v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_to uuid; v_creator uuid; v_client text; v_proj uuid; v_label text; v_task uuid; v_start date;
BEGIN
  SELECT * INTO q FROM public.quotes WHERE id = p_quote;
  IF NOT FOUND OR q.status <> 'won' OR q.segment <> 'PRIVATE' OR q.media_type <> 'LED_OTHER' THEN RETURN; END IF;
  SELECT s.user_id INTO v_to FROM public.work_rule_settings s
    JOIN public.users u ON u.id = s.user_id AND u.is_active WHERE s.key = 'campaign_tasks_assignee';
  IF v_to IS NULL THEN RETURN; END IF;
  SELECT id INTO v_creator FROM public.users WHERE role='admin' AND is_active ORDER BY created_at LIMIT 1;
  v_client := btrim(COALESCE(NULLIF(btrim(q.client_company),''), q.client_name, 'Client'));
  v_label  := left(v_client, 80) || ' (' || COALESCE(q.quote_number, 'quote') || ')';
  SELECT id INTO v_proj FROM public.work_projects WHERE lower(btrim(name)) = lower(v_client);
  IF v_proj IS NULL THEN
    INSERT INTO public.work_projects (name, kind, created_by) VALUES (left(v_client,120), 'client', v_creator)
      ON CONFLICT DO NOTHING RETURNING id INTO v_proj;
    IF v_proj IS NULL THEN SELECT id INTO v_proj FROM public.work_projects WHERE lower(btrim(name)) = lower(v_client); END IF;
  END IF;
  INSERT INTO public.work_members (user_id, added_by) VALUES (v_to, v_creator) ON CONFLICT (user_id) DO NOTHING;

  -- 1. approve video: only at the moment of Won (clients already running are not asked again)
  IF p_on_won THEN
    v_task := NULL;
    INSERT INTO public.work_tasks (title, project_id, created_by, due_date, source_quote_id, source_kind)
    VALUES (left('Approve video from client - ' || v_label, 200), v_proj, v_creator, v_today, q.id, 'approve_video')
    ON CONFLICT DO NOTHING RETURNING id INTO v_task;
    IF v_task IS NOT NULL THEN
      INSERT INTO public.work_task_parts (task_id, assignee_id, due_date) VALUES (v_task, v_to, v_today);
      INSERT INTO public.work_task_log (task_id, user_id, event, detail) VALUES (v_task, v_creator, 'created', '{"rule":"campaign"}');
      PERFORM public.work_push(v_to, 'Approve video from client', left(v_label, 80), '/my-work', 'work-camp-' || v_task::text);
    END IF;
  END IF;

  -- 3. end-date report
  IF q.campaign_end_date IS NOT NULL THEN
    v_task := NULL;
    INSERT INTO public.work_tasks (title, project_id, created_by, due_date, source_quote_id, source_kind)
    VALUES (left('End-date report and remove campaign - ' || v_label, 200), v_proj, v_creator, q.campaign_end_date, q.id, 'end_report')
    ON CONFLICT DO NOTHING RETURNING id INTO v_task;
    IF v_task IS NOT NULL THEN
      INSERT INTO public.work_task_parts (task_id, assignee_id, due_date) VALUES (v_task, v_to, q.campaign_end_date);
      INSERT INTO public.work_task_log (task_id, user_id, event, detail) VALUES (v_task, v_creator, 'created', '{"rule":"campaign"}');
    ELSE
      -- dates moved: shift the still-open end report (never one that is already finished)
      UPDATE public.work_task_parts p SET due_date = q.campaign_end_date
        FROM public.work_tasks t WHERE t.id = p.task_id AND t.source_quote_id = q.id AND t.source_kind = 'end_report' AND p.status <> 'finished';
      UPDATE public.work_tasks SET due_date = q.campaign_end_date
       WHERE source_quote_id = q.id AND source_kind = 'end_report' AND status <> 'finished';
    END IF;
  END IF;

  -- 2. weekly log report (Monday) from the campaign start to its end
  IF q.campaign_end_date IS NOT NULL AND q.campaign_end_date >= v_today THEN
    v_start := GREATEST(COALESCE(q.campaign_start_date, v_today), v_today);
    INSERT INTO public.work_templates (title, project_id, assignee_id, repeat_kind, weekday, start_date, end_date, created_by, source_quote_id)
    VALUES (left('Share log report - ' || v_label, 120), v_proj, v_to, 'weekly', 1, v_start, q.campaign_end_date, v_creator, q.id)
    ON CONFLICT (source_quote_id) WHERE source_quote_id IS NOT NULL
    DO UPDATE SET start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date, is_active = true;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;   -- a task problem must never block a quote save
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_quote_campaign_tasks() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.work_make_campaign_tasks(NEW.id, TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM 'won');
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_quote_campaign_tasks_won ON public.quotes;
CREATE TRIGGER trg_quote_campaign_tasks_won AFTER UPDATE OF status ON public.quotes
  FOR EACH ROW WHEN (NEW.status = 'won' AND OLD.status IS DISTINCT FROM 'won') EXECUTE FUNCTION public.tg_quote_campaign_tasks();
DROP TRIGGER IF EXISTS trg_quote_campaign_tasks_dates ON public.quotes;
CREATE TRIGGER trg_quote_campaign_tasks_dates AFTER UPDATE OF campaign_start_date, campaign_end_date ON public.quotes
  FOR EACH ROW WHEN (NEW.status = 'won' AND (NEW.campaign_start_date IS DISTINCT FROM OLD.campaign_start_date
                                           OR NEW.campaign_end_date  IS DISTINCT FROM OLD.campaign_end_date))
  EXECUTE FUNCTION public.tg_quote_campaign_tasks();

-- ---------- 4. the assignee may reassign their own part ----------
CREATE OR REPLACE FUNCTION public.work_reassign_part(p_part uuid, p_to uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_part public.work_task_parts%ROWTYPE; v_creator uuid;
BEGIN
  SELECT * INTO v_part FROM public.work_task_parts WHERE id = p_part FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'task not found'; END IF;
  SELECT created_by INTO v_creator FROM public.work_tasks WHERE id = v_part.task_id;
  IF v_uid IS NULL OR NOT (public.work_is_head() OR v_creator = v_uid OR v_part.assignee_id = v_uid) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE='42501';
  END IF;
  IF v_part.status = 'finished' THEN RAISE EXCEPTION 'already finished'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_to AND u.is_active) THEN RAISE EXCEPTION 'unknown or inactive person'; END IF;
  IF EXISTS (SELECT 1 FROM public.work_time_entries WHERE user_id = v_part.assignee_id AND ended_at IS NULL AND part_id = p_part) THEN
    PERFORM public.work__stop_running(v_part.assignee_id, false);
  END IF;
  UPDATE public.work_task_parts SET assignee_id = p_to, status = 'assigned', started_at = NULL WHERE id = p_part;
  INSERT INTO public.work_members (user_id, added_by) VALUES (p_to, v_uid) ON CONFLICT (user_id) DO NOTHING;
  PERFORM public.work_refresh_task(v_part.task_id);
  PERFORM public.work_log(v_part.task_id, p_part, 'reassigned', jsonb_build_object('to', p_to));
  PERFORM public.work_push(p_to, 'Task assigned to you', 'You were given a task', '/my-work', 'work-task-' || v_part.task_id::text);
END;
$$;

-- ---------- 5. approved leave -> tell the person which tasks fall on that day ----------
CREATE OR REPLACE FUNCTION public.work_leave_notify() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_list text; v_n int;
BEGIN
  IF NEW.status <> 'approved' OR (TG_OP = 'UPDATE' AND OLD.status = 'approved') THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.work_members WHERE user_id = NEW.user_id) THEN RETURN NEW; END IF;
  SELECT count(*), string_agg(left(x.title, 40), ' | ') INTO v_n, v_list FROM (
    SELECT t.title FROM public.work_task_parts p JOIN public.work_tasks t ON t.id = p.task_id
     WHERE p.assignee_id = NEW.user_id AND p.status <> 'finished' AND COALESCE(p.due_date, t.due_date) = NEW.leave_date
    UNION ALL
    SELECT tp.title || ' (repeating)' FROM public.work_templates tp
     WHERE tp.assignee_id = NEW.user_id AND tp.is_active AND tp.repeat_kind = 'weekly'
       AND tp.weekday = extract(isodow FROM NEW.leave_date)::int
       AND tp.start_date <= NEW.leave_date AND (tp.end_date IS NULL OR tp.end_date >= NEW.leave_date)
  ) x;
  IF v_n > 0 THEN
    PERFORM public.work_push(NEW.user_id,
      'Leave on ' || to_char(NEW.leave_date, 'DD Mon') || ' - ' || v_n || ' task(s) that day',
      left('Please give these to someone: ' || v_list, 180), '/my-work', 'work-leave-' || NEW.id::text);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_work_leave_notify ON public.leaves;
CREATE TRIGGER trg_work_leave_notify AFTER INSERT OR UPDATE OF status ON public.leaves
  FOR EACH ROW EXECUTE FUNCTION public.work_leave_notify();

-- ---------- 6. privileges ----------
REVOKE ALL ON FUNCTION public.work_make_campaign_tasks(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_quote_campaign_tasks()               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.work_leave_notify()                     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.work_reassign_part(uuid, uuid)          FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.work_reassign_part(uuid, uuid)      TO authenticated;

-- ---------- 7. replace yesterday's per-client weekly templates, backfill current campaigns ----------
UPDATE public.work_templates SET is_active = false
 WHERE title LIKE 'Send campaign report - %' AND source_quote_id IS NULL AND is_active;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.quotes
            WHERE status='won' AND segment='PRIVATE' AND media_type='LED_OTHER'
              AND campaign_end_date IS NOT NULL AND campaign_end_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date
  LOOP
    PERFORM public.work_make_campaign_tasks(r.id, false);   -- tasks 2 + 3 only; no "approve video" for running campaigns
  END LOOP;
END $$;

SELECT 'templates_weekly_rule' k, count(*)::text v FROM public.work_templates WHERE source_quote_id IS NOT NULL AND is_active
UNION ALL SELECT 'end_report_tasks', count(*)::text FROM public.work_tasks WHERE source_kind='end_report'
UNION ALL SELECT 'old_templates_still_active', count(*)::text FROM public.work_templates WHERE title LIKE 'Send campaign report - %' AND is_active
UNION ALL SELECT 'assignee_set', (SELECT u.name FROM public.work_rule_settings s JOIN public.users u ON u.id=s.user_id WHERE s.key='campaign_tasks_assignee');
COMMIT;
-- UNDO: DROP TRIGGER trg_quotes_won_needs_dates ON quotes; DROP TRIGGER trg_quote_campaign_tasks_won ON quotes;
--       DROP TRIGGER trg_quote_campaign_tasks_dates ON quotes; DROP TRIGGER trg_work_leave_notify ON leaves;
--       UPDATE work_templates SET is_active=false WHERE source_quote_id IS NOT NULL;
--       UPDATE work_templates SET is_active=true WHERE title LIKE 'Send campaign report - %' AND source_quote_id IS NULL;
