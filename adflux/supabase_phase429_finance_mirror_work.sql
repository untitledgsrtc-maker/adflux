-- Phase 429 (owner yes 2026-10-19): every Finance reminder for Diya also lands in her Work list (so it shows in Team Work / My Work).
-- Silent (no extra push; the Finance push stays). One Work task per title per day; a one-off that is still open is not repeated daily.
-- Idempotent. UNDO: re-run supabase_finance_p5_p6.sql part 2 (canonical, now includes the mirror call is the NEW one - remove the PERFORM line), DROP FUNCTION public.finance_mirror_to_work(text,date,int);
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
  INSERT INTO public.work_tasks (title, created_by, due_date) VALUES (left(p_title,200), v_cr, p_due) RETURNING id INTO v_task;
  INSERT INTO public.work_task_parts (task_id, assignee_id, due_date, due_time) VALUES (v_task, v_to, p_due, make_time(p_hour, 0, 0));
  INSERT INTO public.work_task_log (task_id, user_id, event, detail) VALUES (v_task, v_cr, 'created', '{"rule":"finance"}');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public.finance_mirror_to_work(text,date,int) FROM PUBLIC, anon, authenticated;

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

-- today: put the daily ones in her list now (the rest arrive on their own date)
SELECT public.finance_mirror_to_work(title, (now() AT TIME ZONE 'Asia/Kolkata')::date, COALESCE(remind_hour,10)) FROM public.finance_tasks WHERE frequency='daily' AND COALESCE(is_active,true);
NOTIFY pgrst, 'reload schema';
