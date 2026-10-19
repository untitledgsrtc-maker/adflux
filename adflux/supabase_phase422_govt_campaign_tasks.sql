-- Phase 422 (owner 2026-10-19): every WON GOVERNMENT quote (Auto Hood + GSRTC LED) creates Dixita Gohel's fixed
-- Work tasks. Separate from the private-LED rule of Phase 367 (that function is NOT touched).
--  AUTO HOOD : design approved with Safika (+1 day) | quantity approved with Vishal sir or Brijesh (+2) |
--              work assigned to vendor (+3) | vendor work follow-up 3 times a day (11 AM, 3 PM, 6 PM, until the campaign
--              start date) | report making (no due date) | prepare invoice (end date +1) | submit hard copy (end +2)
--  GSRTC LED : design approved with Safika (+1) | start-date report (email + WhatsApp) on the start date |
--              play report to the client every Monday (start to end) | end-date report on the end date |
--              prepare invoice (end +1) | submit hard copy (end +2)
-- Dated tasks follow the campaign dates when they are edited. Idempotent. UNDO notes at the bottom.
BEGIN;

-- ---------- 1. who + link columns ----------
INSERT INTO public.work_rule_settings (key, user_id)
SELECT 'govt_tasks_assignee', u.id FROM public.users u
 WHERE u.email = 'dixitagohel02@gmail.com' AND u.role = 'office_admin' AND u.is_active
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.work_templates ADD COLUMN IF NOT EXISTS due_time time;          -- time of day the repeating task is due (alert fires then)
ALTER TABLE public.work_templates ADD COLUMN IF NOT EXISTS govt_quote_id uuid REFERENCES public.quotes(id) ON DELETE SET NULL;
ALTER TABLE public.work_templates ADD COLUMN IF NOT EXISTS govt_kind text;
CREATE UNIQUE INDEX IF NOT EXISTS work_templates_govt_uk ON public.work_templates (govt_quote_id, govt_kind) WHERE govt_quote_id IS NOT NULL;

-- ---------- 2. repeating tasks carry their due time to the part (everything else byte-identical to the live function) ----------
CREATE OR REPLACE FUNCTION public.work_run_recurring()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date; v_n int := 0; t public.work_templates%ROWTYPE;
        v_task uuid; v_due boolean;
BEGIN
  IF public.is_off_day(v_today) THEN RETURN 0; END IF;       -- Sundays and holidays: nothing fires
  FOR t IN SELECT * FROM public.work_templates
            WHERE is_active AND start_date <= v_today AND (end_date IS NULL OR end_date >= v_today)
              AND (last_run_date IS NULL OR last_run_date < v_today) LOOP
    v_due := CASE t.repeat_kind
               WHEN 'daily'   THEN true
               WHEN 'weekly'  THEN extract(isodow FROM v_today)::int = COALESCE(t.weekday, 1)
               ELSE extract(day FROM v_today)::int = COALESCE(t.month_day, 1) END;
    IF NOT v_due THEN CONTINUE; END IF;
    BEGIN
      v_task := NULL;
      INSERT INTO public.work_tasks (title, project_id, created_by, due_date, template_id)
      VALUES (t.title, t.project_id, t.created_by, v_today, t.id)
      ON CONFLICT DO NOTHING
      RETURNING id INTO v_task;
      IF v_task IS NOT NULL THEN
        INSERT INTO public.work_task_parts (task_id, assignee_id, due_date, due_time) VALUES (v_task, t.assignee_id, v_today, t.due_time);
        INSERT INTO public.work_task_log (task_id, user_id, event, detail) VALUES (v_task, t.created_by, 'created', '{"recurring":true}');
        PERFORM public.work_push(t.assignee_id, 'Repeating task', left(t.title, 80), '/my-work', 'work-rec-' || t.id::text);
        v_n := v_n + 1;
      END IF;
      UPDATE public.work_templates SET last_run_date = v_today WHERE id = t.id;
    EXCEPTION WHEN OTHERS THEN
      NULL;  -- one bad template never stops the rest
    END;
  END LOOP;
  RETURN v_n;
END;
$function$;

-- ---------- 3. helpers (internal) ----------
CREATE OR REPLACE FUNCTION public.work__govt_task(p_quote uuid, p_kind text, p_title text, p_due date, p_to uuid, p_creator uuid, p_proj uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date; v_task uuid;
BEGIN
  IF p_due IS NOT NULL AND p_due < v_today THEN
    -- a date already gone: never create an overdue task out of thin air; just keep an existing open one in step
    UPDATE public.work_task_parts p SET due_date = p_due FROM public.work_tasks t
     WHERE t.id = p.task_id AND t.source_quote_id = p_quote AND t.source_kind = p_kind AND p.status <> 'finished';
    UPDATE public.work_tasks SET due_date = p_due WHERE source_quote_id = p_quote AND source_kind = p_kind AND status <> 'finished';
    RETURN;
  END IF;
  INSERT INTO public.work_tasks (title, project_id, created_by, due_date, source_quote_id, source_kind)
  VALUES (left(p_title, 200), p_proj, p_creator, p_due, p_quote, p_kind)
  ON CONFLICT DO NOTHING RETURNING id INTO v_task;
  IF v_task IS NOT NULL THEN
    INSERT INTO public.work_task_parts (task_id, assignee_id, due_date) VALUES (v_task, p_to, p_due);
    INSERT INTO public.work_task_log (task_id, user_id, event, detail) VALUES (v_task, p_creator, 'created', '{"rule":"govt_campaign"}');
  ELSIF p_due IS NOT NULL THEN
    UPDATE public.work_task_parts p SET due_date = p_due FROM public.work_tasks t
     WHERE t.id = p.task_id AND t.source_quote_id = p_quote AND t.source_kind = p_kind AND p.status <> 'finished';
    UPDATE public.work_tasks SET due_date = p_due WHERE source_quote_id = p_quote AND source_kind = p_kind AND status <> 'finished';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.work__govt_tpl(p_quote uuid, p_kind text, p_title text, p_repeat text, p_weekday int, p_time time,
                                                 p_start date, p_end date, p_to uuid, p_creator uuid, p_proj uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  IF p_end IS NULL OR p_end < v_today OR p_end < p_start THEN
    UPDATE public.work_templates SET is_active = false WHERE govt_quote_id = p_quote AND govt_kind = p_kind;
    RETURN;
  END IF;
  INSERT INTO public.work_templates (title, project_id, assignee_id, repeat_kind, weekday, due_time, start_date, end_date, created_by, govt_quote_id, govt_kind)
  VALUES (left(p_title, 120), p_proj, p_to, p_repeat, p_weekday, p_time, p_start, p_end, p_creator, p_quote, p_kind)
  ON CONFLICT (govt_quote_id, govt_kind) WHERE govt_quote_id IS NOT NULL
  DO UPDATE SET start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date, is_active = true;
END $$;

-- ---------- 4. the rule ----------
CREATE OR REPLACE FUNCTION public.work_make_govt_tasks(p_quote uuid, p_on_won boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  q public.quotes%ROWTYPE; v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_to uuid; v_creator uuid; v_client text; v_proj uuid; v_label text; v_start date; v_auto boolean;
BEGIN
  SELECT * INTO q FROM public.quotes WHERE id = p_quote;
  IF NOT FOUND OR q.status <> 'won' OR q.segment <> 'GOVERNMENT' OR q.media_type NOT IN ('AUTO_HOOD', 'GSRTC_LED') THEN RETURN; END IF;
  v_auto := (q.media_type = 'AUTO_HOOD');
  SELECT s.user_id INTO v_to FROM public.work_rule_settings s
    JOIN public.users u ON u.id = s.user_id AND u.is_active WHERE s.key = 'govt_tasks_assignee';
  IF v_to IS NULL THEN RETURN; END IF;
  SELECT id INTO v_creator FROM public.users WHERE role = 'admin' AND is_active ORDER BY created_at LIMIT 1;
  v_client := btrim(COALESCE(NULLIF(btrim(q.client_company), ''), q.client_name, 'Department'));
  v_label  := left(v_client, 80) || ' (' || COALESCE(q.quote_number, 'quote') || ')';
  SELECT id INTO v_proj FROM public.work_projects WHERE lower(btrim(name)) = lower(v_client);
  IF v_proj IS NULL THEN
    INSERT INTO public.work_projects (name, kind, created_by) VALUES (left(v_client, 120), 'client', v_creator)
      ON CONFLICT DO NOTHING RETURNING id INTO v_proj;
    IF v_proj IS NULL THEN SELECT id INTO v_proj FROM public.work_projects WHERE lower(btrim(name)) = lower(v_client); END IF;
  END IF;
  INSERT INTO public.work_members (user_id, added_by) VALUES (v_to, v_creator) ON CONFLICT (user_id) DO NOTHING;

  -- at the moment of Won only (running campaigns already past these steps are not asked again)
  IF p_on_won THEN
    PERFORM public.work__govt_task(q.id, 'design', 'Design approved with Safika - ' || v_label, v_today + 1, v_to, v_creator, v_proj);
    IF v_auto THEN
      PERFORM public.work__govt_task(q.id, 'qty',    'Quantity approved with Vishal sir or Brijesh - ' || v_label, v_today + 2, v_to, v_creator, v_proj);
      PERFORM public.work__govt_task(q.id, 'vendor', 'Work assigned to vendor - ' || v_label, v_today + 3, v_to, v_creator, v_proj);
      PERFORM public.work__govt_task(q.id, 'report', 'Report making - ' || v_label, NULL, v_to, v_creator, v_proj);   -- long task: no due date
    END IF;
    PERFORM public.work_push(v_to, 'New government campaign', left(v_label, 80), '/my-work', 'work-govt-' || q.id::text);
  END IF;

  IF v_auto THEN
    -- vendor follow-up, 3 times a day, from now until the campaign start date
    IF q.campaign_start_date IS NOT NULL THEN
      v_start := GREATEST(v_today, COALESCE(q.won_at::date, v_today));
      PERFORM public.work__govt_tpl(q.id, 'vendor_1', 'Vendor work follow-up (11 AM) - ' || v_label, 'daily', NULL, TIME '11:00', v_start, q.campaign_start_date, v_to, v_creator, v_proj);
      PERFORM public.work__govt_tpl(q.id, 'vendor_2', 'Vendor work follow-up (3 PM) - '  || v_label, 'daily', NULL, TIME '15:00', v_start, q.campaign_start_date, v_to, v_creator, v_proj);
      PERFORM public.work__govt_tpl(q.id, 'vendor_3', 'Vendor work follow-up (6 PM) - '  || v_label, 'daily', NULL, TIME '18:00', v_start, q.campaign_start_date, v_to, v_creator, v_proj);
    END IF;
  ELSE
    IF q.campaign_start_date IS NOT NULL THEN
      PERFORM public.work__govt_task(q.id, 'start_report', 'Start-date report: send by email and WhatsApp - ' || v_label, q.campaign_start_date, v_to, v_creator, v_proj);
    END IF;
    IF q.campaign_end_date IS NOT NULL THEN
      v_start := GREATEST(COALESCE(q.campaign_start_date, v_today), v_today);
      PERFORM public.work__govt_tpl(q.id, 'play_report', 'Play report to the client - ' || v_label, 'weekly', 1, NULL, v_start, q.campaign_end_date, v_to, v_creator, v_proj);
      PERFORM public.work__govt_task(q.id, 'end_report', 'End-date report - ' || v_label, q.campaign_end_date, v_to, v_creator, v_proj);
    END IF;
  END IF;

  IF q.campaign_end_date IS NOT NULL THEN
    PERFORM public.work__govt_task(q.id, 'invoice',  'Prepare invoice - ' || v_label, q.campaign_end_date + 1, v_to, v_creator, v_proj);
    PERFORM public.work__govt_task(q.id, 'hardcopy', 'Submit invoice hard copy to the department - ' || v_label, q.campaign_end_date + 2, v_to, v_creator, v_proj);
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;   -- a task problem must never block a quote save
END $$;

CREATE OR REPLACE FUNCTION public.tg_quote_govt_tasks() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.work_make_govt_tasks(NEW.id, TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM 'won');
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_quote_govt_tasks_won ON public.quotes;
CREATE TRIGGER trg_quote_govt_tasks_won AFTER UPDATE OF status ON public.quotes
  FOR EACH ROW WHEN (NEW.status = 'won' AND OLD.status IS DISTINCT FROM 'won' AND NEW.segment = 'GOVERNMENT') EXECUTE FUNCTION public.tg_quote_govt_tasks();
DROP TRIGGER IF EXISTS trg_quote_govt_tasks_dates ON public.quotes;
CREATE TRIGGER trg_quote_govt_tasks_dates AFTER UPDATE OF campaign_start_date, campaign_end_date ON public.quotes
  FOR EACH ROW WHEN (NEW.status = 'won' AND NEW.segment = 'GOVERNMENT' AND (NEW.campaign_start_date IS DISTINCT FROM OLD.campaign_start_date
                                          OR NEW.campaign_end_date IS DISTINCT FROM OLD.campaign_end_date))
  EXECUTE FUNCTION public.tg_quote_govt_tasks();

REVOKE EXECUTE ON FUNCTION public.work__govt_task(uuid,text,text,date,uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.work__govt_tpl(uuid,text,text,text,int,time,date,date,uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.work_make_govt_tasks(uuid,boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_quote_govt_tasks() FROM PUBLIC, anon, authenticated;

-- ---------- 5. campaigns already running today: the tasks still ahead (not the won-moment ones) ----------
SELECT public.work_make_govt_tasks(id, false) FROM public.quotes
 WHERE status = 'won' AND segment = 'GOVERNMENT' AND media_type IN ('AUTO_HOOD','GSRTC_LED') AND campaign_end_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date;

NOTIFY pgrst, 'reload schema';
COMMIT;
-- UNDO: DROP TRIGGER trg_quote_govt_tasks_won/_dates ON quotes; UPDATE work_templates SET is_active=false WHERE govt_quote_id IS NOT NULL;
--       DELETE FROM work_tasks WHERE source_kind IN ('design','qty','vendor','report','start_report','end_report','invoice','hardcopy') AND source_quote_id IN (SELECT id FROM quotes WHERE segment='GOVERNMENT') AND status<>'finished';
