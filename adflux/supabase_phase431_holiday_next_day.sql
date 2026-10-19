-- Phase 431 (owner 2026-10-19): a fixed task that falls on a Sunday / holiday fires on the NEXT working day.
--  Work: weekly tasks now catch up (monthly/quarterly/yearly already did in Phase 426); daily tasks still just skip the day.
--  Finance reminders: no firing on an off day; the due ones fire next working day (then roll forward as usual).
-- Idempotent. UNDO: re-run the phase 426 work_run_recurring body / remove the is_off_day line in push_finance_task_reminders.
CREATE OR REPLACE FUNCTION public.work_run_recurring()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date; v_n int := 0; t public.work_templates%ROWTYPE;
        v_task uuid; v_due boolean; v_mstart date := date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))::date;
        v_wk date := date_trunc('week', (now() AT TIME ZONE 'Asia/Kolkata'))::date;
BEGIN
  IF public.is_off_day(v_today) THEN RETURN 0; END IF;       -- Sundays and holidays: nothing fires (caught up on the next working day for monthly / quarterly / yearly)
  FOR t IN SELECT * FROM public.work_templates
            WHERE is_active AND start_date <= v_today AND (end_date IS NULL OR end_date >= v_today)
              AND (last_run_date IS NULL OR last_run_date < v_today) LOOP
    v_due := CASE t.repeat_kind
               WHEN 'daily'     THEN true
               WHEN 'weekly'    THEN v_wk + (COALESCE(t.weekday, 1) - 1) <= v_today AND v_wk + (COALESCE(t.weekday, 1) - 1) >= t.start_date AND (t.last_run_date IS NULL OR t.last_run_date < v_wk + (COALESCE(t.weekday, 1) - 1))
               WHEN 'monthly'   THEN extract(day FROM v_today)::int >= COALESCE(t.month_day, 1) AND (t.last_run_date IS NULL OR t.last_run_date < v_mstart)
               WHEN 'quarterly' THEN extract(month FROM v_today)::int IN (1,4,7,10) AND extract(day FROM v_today)::int >= COALESCE(t.month_day, 1) AND (t.last_run_date IS NULL OR t.last_run_date < v_mstart)
               WHEN 'yearly'    THEN extract(month FROM v_today)::int = 4 AND extract(day FROM v_today)::int >= COALESCE(t.month_day, 1) AND (t.last_run_date IS NULL OR t.last_run_date < v_mstart)
               ELSE false END;
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

CREATE OR REPLACE FUNCTION public.push_finance_task_reminders()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_hour  int  := extract(hour FROM (now() AT TIME ZONE 'Asia/Kolkata'))::int;
  v_task  record;
  v_user  record;
  v_next  date;
  v_count int := 0;
BEGIN
  -- Phase 421: runs at 10:00 and 18:00 IST; a task fires in the run that matches its remind_hour.
  -- Reminders go to the ACCOUNTS user only (Diya), not admin. A recurring task is never switched off by
  -- the 'done' tick (only a one-off is); it simply rolls to its next date after firing.
  -- Phase 431: Sunday / holiday -> nothing fires; due tasks (next_due <= today) fire on the next working day.
  IF public.is_off_day(v_today) THEN RETURN 0; END IF;
  FOR v_task IN
    SELECT id, title, frequency, next_due, weekday, day_of_month, shift_sunday, remind_hour
      FROM public.finance_tasks
     WHERE COALESCE(is_active, true) = true
       AND (frequency <> 'oneoff' OR COALESCE(status, 'open') <> 'done')
       AND next_due IS NOT NULL
       AND next_due <= v_today
       AND COALESCE(remind_hour, 10) = v_hour
  LOOP
    FOR v_user IN
      SELECT id FROM public.users
       WHERE role = 'accounts' AND COALESCE(is_active, true) = true
    LOOP
      PERFORM public.enqueue_push(
        v_user.id,
        'Finance reminder: ' || v_task.title,
        'Due today - open Finance > Tasks.',
        '/finance?tab=tasks',
        'fin-task-' || v_task.id::text || '-' || to_char(v_today, 'YYYY-MM-DD')
      );
      v_count := v_count + 1;
    END LOOP;

    -- Phase 429: the same task also appears in Diya's Work list (visible in Team Work), silent - no second push.
    PERFORM public.finance_mirror_to_work(v_task.title, v_today, COALESCE(v_task.remind_hour, 10));

    IF v_task.frequency <> 'oneoff' THEN
      v_next := v_task.next_due;
      WHILE v_next IS NOT NULL AND v_next <= v_today LOOP
        v_next := public.finance_task_next(v_task.frequency, v_task.weekday, v_task.day_of_month, v_task.shift_sunday, v_next);
      END LOOP;
      IF v_next IS NOT NULL THEN
        UPDATE public.finance_tasks SET next_due = v_next WHERE id = v_task.id;
      END IF;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.push_finance_task_reminders() FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';
