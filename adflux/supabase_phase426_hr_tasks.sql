-- Phase 426 (owner 2026-10-19): Riya's (HR) task system.
--  A. repeating tasks (daily / Monday / monthly / quarterly / yearly) as Work templates for Riya
--  B. birthday + work-anniversary tasks every morning (dates from the offer letters: hr_offers.dob / joining_date)
--  C. when a candidate is marked HIRED: Riya's 14 hire tasks (+ a bank-details task for Diya)
--  D. when a person is DEACTIVATED: Riya's 6 exit tasks
-- Assumptions (owner did not answer): probation = 90 days; exit tasks start when the person is deactivated.
-- Idempotent. UNDO at the bottom.
BEGIN;

-- ---------- 0. settings ----------
INSERT INTO public.work_rule_settings (key, user_id)
SELECT 'hr_tasks_assignee', u.id FROM public.users u WHERE u.name = 'Riya' AND u.role = 'hr' AND u.is_active
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.work_rule_settings (key, user_id)
SELECT 'hire_bank_assignee', u.id FROM public.users u WHERE u.name = 'Diya' AND u.role = 'accounts' AND u.is_active
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.work_members (user_id, added_by)
SELECT s.user_id, (SELECT id FROM public.users WHERE role='admin' AND is_active ORDER BY created_at LIMIT 1)
  FROM public.work_rule_settings s WHERE s.key IN ('hr_tasks_assignee','hire_bank_assignee') AND s.user_id IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;

-- ---------- 1. repeating tasks can also be quarterly / yearly; a monthly task waits for the first WORKING day on or after its day ----------
ALTER TABLE public.work_templates DROP CONSTRAINT IF EXISTS work_templates_repeat_kind_check;
ALTER TABLE public.work_templates ADD CONSTRAINT work_templates_repeat_kind_check
  CHECK (repeat_kind IN ('daily','weekly','monthly','quarterly','yearly'));

CREATE OR REPLACE FUNCTION public.work_run_recurring()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date; v_n int := 0; t public.work_templates%ROWTYPE;
        v_task uuid; v_due boolean; v_mstart date := date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))::date;
BEGIN
  IF public.is_off_day(v_today) THEN RETURN 0; END IF;       -- Sundays and holidays: nothing fires (caught up on the next working day for monthly / quarterly / yearly)
  FOR t IN SELECT * FROM public.work_templates
            WHERE is_active AND start_date <= v_today AND (end_date IS NULL OR end_date >= v_today)
              AND (last_run_date IS NULL OR last_run_date < v_today) LOOP
    v_due := CASE t.repeat_kind
               WHEN 'daily'     THEN true
               WHEN 'weekly'    THEN extract(isodow FROM v_today)::int = COALESCE(t.weekday, 1)
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

-- ---------- 2. Riya's repeating list ----------
WITH hr AS (SELECT user_id u, (SELECT id FROM public.users WHERE role='admin' AND is_active ORDER BY created_at LIMIT 1) cr FROM public.work_rule_settings WHERE key='hr_tasks_assignee' AND user_id IS NOT NULL),
x(title, kind, wd, md, tm) AS (VALUES
  ('Approve or reject pending leave requests','daily',NULL::int,NULL::int,NULL::time),
  ('Approve or reject pending TA/DA claims','daily',NULL,NULL,NULL),
  ('Check the Daily check-in card; chase anyone who has not said good morning or checked in','daily',NULL,NULL,TIME '10:30'),
  ('Follow up on candidates in the Recruit pipeline: calls, interviews, shortlisting','daily',NULL,NULL,NULL),
  ('Check the evening report card and remind anyone who has not shared theirs','daily',NULL,NULL,TIME '19:00'),
  ('Check that onboarding steps for new joiners are being ticked','daily',NULL,NULL,NULL),
  ('Thank-you meeting with the team','weekly',1,NULL,NULL),
  ('Write the thank-you meeting report','weekly',1,NULL,NULL),
  ('Review last week''s attendance and leaves','weekly',1,NULL,NULL),
  ('Check open offers and chase the ones waiting for acceptance','weekly',1,NULL,NULL),
  ('Chase unsigned offer letters and re-issue any in the wrong role format','weekly',1,NULL,NULL),
  ('Chase anyone who has not opened the app in a week','weekly',1,NULL,NULL),
  ('Check the training test results of people in onboarding','weekly',1,NULL,NULL),
  ('Plan this week''s interviews and joinings','weekly',1,NULL,NULL),
  ('Check people on probation or notice period','weekly',1,NULL,NULL),
  ('Before payroll: confirm all leaves are approved and entered correctly','monthly',NULL,25,NULL),
  ('Check every salary figure and incentive profile with accounts','monthly',NULL,26,NULL),
  ('Check that salary slips have been downloaded or shared','monthly',NULL,2,NULL),
  ('Collect and file documents for new joiners','monthly',NULL,5,NULL),
  ('Review the month''s joiners, leavers and exits','monthly',NULL,1,NULL),
  ('Update the holiday list in Master > Holidays if a date changed','monthly',NULL,3,NULL),
  ('Performance and salary review: who is below target, who deserves a raise','quarterly',NULL,5,NULL),
  ('Check that every person has a signed offer letter in the correct format','quarterly',NULL,10,NULL),
  ('Set up the holiday calendar for the next financial year','yearly',NULL,1,NULL),
  ('Revise offer letters and policy documents if rules changed','yearly',NULL,15,NULL))
INSERT INTO public.work_templates (title, assignee_id, repeat_kind, weekday, month_day, due_time, start_date, created_by, last_run_date)
SELECT x.title, hr.u, x.kind, x.wd, x.md, x.tm, DATE '2026-10-20', hr.cr,
       -- a monthly/quarterly day that has already passed this month waits for next month (no instant fire)
       CASE WHEN x.md IS NOT NULL AND x.md <= 19 AND x.kind IN ('monthly','quarterly') THEN DATE '2026-10-19' ELSE NULL END
  FROM x CROSS JOIN hr
 WHERE NOT EXISTS (SELECT 1 FROM public.work_templates t WHERE t.title = x.title AND t.assignee_id = hr.u);

-- ---------- 3. helper: one plain task (deduped by title + due date) ----------
CREATE OR REPLACE FUNCTION public.work__plain_task(p_title text, p_due date, p_to uuid, p_creator uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_task uuid;
BEGIN
  IF p_to IS NULL OR EXISTS (SELECT 1 FROM public.work_tasks WHERE title = left(p_title,200) AND due_date IS NOT DISTINCT FROM p_due) THEN RETURN; END IF;
  INSERT INTO public.work_tasks (title, created_by, due_date) VALUES (left(p_title,200), p_creator, p_due) RETURNING id INTO v_task;
  INSERT INTO public.work_task_parts (task_id, assignee_id, due_date) VALUES (v_task, p_to, p_due);
  INSERT INTO public.work_task_log (task_id, user_id, event, detail) VALUES (v_task, p_creator, 'created', '{"rule":"hr"}');
END $$;

-- ---------- 4. birthdays + work anniversaries (every morning 07:10 IST) ----------
CREATE OR REPLACE FUNCTION public.hr_special_day_tasks() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date; v_to uuid; v_cr uuid; r record; v_n int := 0; v_y int;
BEGIN
  SELECT user_id INTO v_to FROM public.work_rule_settings WHERE key='hr_tasks_assignee';
  SELECT id INTO v_cr FROM public.users WHERE role='admin' AND is_active ORDER BY created_at LIMIT 1;
  IF v_to IS NULL THEN RETURN 0; END IF;
  FOR r IN SELECT DISTINCT ON (u.id) u.id, u.name, o.dob, o.joining_date
             FROM public.users u JOIN public.hr_offers o ON o.converted_user_id = u.id
            WHERE u.is_active AND u.role <> 'agency' ORDER BY u.id, o.created_at DESC LOOP
    IF r.dob IS NOT NULL AND extract(month FROM r.dob) = extract(month FROM v_today) AND extract(day FROM r.dob) = extract(day FROM v_today) THEN
      PERFORM public.work__plain_task('Wish ' || r.name || ' a happy birthday', v_today, v_to, v_cr); v_n := v_n + 1;
    END IF;
    IF r.joining_date IS NOT NULL AND extract(month FROM r.joining_date) = extract(month FROM v_today) AND extract(day FROM r.joining_date) = extract(day FROM v_today)
       AND extract(year FROM r.joining_date) < extract(year FROM v_today) THEN
      v_y := (extract(year FROM v_today) - extract(year FROM r.joining_date))::int;
      PERFORM public.work__plain_task('Wish ' || r.name || ' a happy work anniversary (' || v_y || CASE WHEN v_y = 1 THEN ' year)' ELSE ' years)' END, v_today, v_to, v_cr); v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN v_n;
END $$;
DO $$ BEGIN PERFORM cron.unschedule('hr-special-days'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('hr-special-days', '40 1 * * *', $$ SELECT public.hr_special_day_tasks(); $$);

-- ---------- 5. candidate marked HIRED ----------
CREATE OR REPLACE FUNCTION public.hr_hire_tasks() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date; v_hr uuid; v_bank uuid; v_cr uuid; v_join date; v_j date; p text;
BEGIN
  SELECT user_id INTO v_hr FROM public.work_rule_settings WHERE key='hr_tasks_assignee';
  SELECT user_id INTO v_bank FROM public.work_rule_settings WHERE key='hire_bank_assignee';
  SELECT id INTO v_cr FROM public.users WHERE role='admin' AND is_active ORDER BY created_at LIMIT 1;
  IF v_hr IS NULL THEN RETURN NEW; END IF;
  SELECT o.joining_date INTO v_join FROM public.hr_offers o
   WHERE (NEW.email IS NOT NULL AND lower(o.candidate_email) = lower(NEW.email)) OR lower(btrim(o.candidate_name)) = lower(btrim(NEW.name))
   ORDER BY o.created_at DESC LIMIT 1;
  v_j := GREATEST(COALESCE(v_join, v_today), v_today);
  p := 'Hire: ' || left(NEW.name, 60) || ' - ';
  PERFORM public.work__plain_task(p || 'send the offer letter in the right role format', v_today, v_hr, v_cr);
  PERFORM public.work__plain_task(p || 'collect documents: PAN, Aadhaar, bank details, photo', v_today, v_hr, v_cr);
  PERFORM public.work__plain_task(p || 'create the login (Add Member) with the correct role and a typed salary', v_today, v_hr, v_cr);
  PERFORM public.work__plain_task(p || 'map the WhatsApp number', v_today, v_hr, v_cr);
  PERFORM public.work__plain_task(p || 'email signature banner, real contact email and profile picture', v_today, v_hr, v_cr);
  PERFORM public.work__plain_task(p || 'introduction to the team and their head', v_j, v_hr, v_cr);
  PERFORM public.work__plain_task(p || 'welcome message and joining-day arrangements: seat, system, access', v_j, v_hr, v_cr);
  PERFORM public.work__plain_task(p || 'install the Android or Windows app and grant the phone permissions', v_j, v_hr, v_cr);
  PERFORM public.work__plain_task(p || 'check that they checked in on day 1', v_j, v_hr, v_cr);
  PERFORM public.work__plain_task(p || 'ID card or visiting card', v_j + 2, v_hr, v_cr);
  PERFORM public.work__plain_task(p || 'start role training (onboarding checklist and tests)', v_j + 1, v_hr, v_cr);
  PERFORM public.work__plain_task(p || '1-week check-in', v_j + 7, v_hr, v_cr);
  PERFORM public.work__plain_task(p || '30-day review', v_j + 30, v_hr, v_cr);
  PERFORM public.work__plain_task(p || 'probation confirmation', v_j + 90, v_hr, v_cr);
  PERFORM public.work__plain_task(p || 'add the new joiner''s bank details for salary payment', v_today + 2, v_bank, v_cr);
  PERFORM public.work_push(v_hr, 'New hire: ' || left(NEW.name, 50), '14 tasks added to your list', '/my-work', 'work-hire-' || NEW.id::text);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_hr_hire_tasks ON public.hr_candidates;
CREATE TRIGGER trg_hr_hire_tasks AFTER UPDATE OF stage ON public.hr_candidates
  FOR EACH ROW WHEN (NEW.stage = 'hired' AND OLD.stage IS DISTINCT FROM 'hired') EXECUTE FUNCTION public.hr_hire_tasks();

-- ---------- 6. person DEACTIVATED -> exit tasks ----------
CREATE OR REPLACE FUNCTION public.hr_exit_tasks() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date; v_hr uuid; v_cr uuid; p text;
BEGIN
  SELECT user_id INTO v_hr FROM public.work_rule_settings WHERE key='hr_tasks_assignee';
  SELECT id INTO v_cr FROM public.users WHERE role='admin' AND is_active ORDER BY created_at LIMIT 1;
  IF v_hr IS NULL OR NEW.role = 'agency' THEN RETURN NEW; END IF;
  p := 'Exit: ' || left(NEW.name, 60) || ' - ';
  PERFORM public.work__plain_task(p || 'handover of work and tasks', v_today, v_hr, v_cr);
  PERFORM public.work__plain_task(p || 'collect assets: phone, laptop, ID card, SIM', v_today, v_hr, v_cr);
  PERFORM public.work__plain_task(p || 'final settlement: salary, leaves and any advances', v_today + 1, v_hr, v_cr);
  PERFORM public.work__plain_task(p || 'exit interview', v_today, v_hr, v_cr);
  PERFORM public.work__plain_task(p || 'check the login is really blocked (deactivating does not stop sign-in)', v_today, v_hr, v_cr);
  PERFORM public.work__plain_task(p || 'remove the WhatsApp number mapping', v_today, v_hr, v_cr);
  PERFORM public.work_push(v_hr, 'Exit: ' || left(NEW.name, 50), '6 exit tasks added to your list', '/my-work', 'work-exit-' || NEW.id::text);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_hr_exit_tasks ON public.users;
CREATE TRIGGER trg_hr_exit_tasks AFTER UPDATE OF is_active ON public.users
  FOR EACH ROW WHEN (OLD.is_active IS TRUE AND NEW.is_active IS FALSE) EXECUTE FUNCTION public.hr_exit_tasks();

REVOKE EXECUTE ON FUNCTION public.work__plain_task(text,date,uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.hr_special_day_tasks() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.hr_hire_tasks() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.hr_exit_tasks() FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
-- UNDO: DROP TRIGGER trg_hr_hire_tasks ON hr_candidates; DROP TRIGGER trg_hr_exit_tasks ON users; SELECT cron.unschedule('hr-special-days');
--       UPDATE work_templates SET is_active=false WHERE assignee_id=(SELECT user_id FROM work_rule_settings WHERE key='hr_tasks_assignee') AND created_at::date='2026-10-19';
--       (work_run_recurring keeps the extra kinds - harmless; the previous body is in supabase_phase422_govt_campaign_tasks.sql)
