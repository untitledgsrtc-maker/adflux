-- Phase 421 (owner 2026-10-19): Diya's finance routine as real reminder tasks.
-- Adds: every-2-days / quarterly / yearly repeats, weekday + day-of-month + "next day if Sunday" +
-- a reminder hour (10 or 18). Reminders now go to the ACCOUNTS user only (Diya) - see
-- push_finance_task_reminders() in supabase_finance_p5_p6.sql (canonical, section 71).
-- Idempotent. Backup of the 9 old rows: _bak_finance_tasks_p421 (KEEP 30 days, then DROP TABLE).
-- ==== part 1 . backup + columns + frequency list ====
CREATE TABLE IF NOT EXISTS public._bak_finance_tasks_p421 AS SELECT t.*, now() AS bak_at FROM public.finance_tasks t WHERE false;
ALTER TABLE public._bak_finance_tasks_p421 ENABLE ROW LEVEL SECURITY;
INSERT INTO public._bak_finance_tasks_p421 SELECT t.*, now() FROM public.finance_tasks t
 WHERE NOT EXISTS (SELECT 1 FROM public._bak_finance_tasks_p421 b WHERE b.id = t.id);

ALTER TABLE public.finance_tasks ADD COLUMN IF NOT EXISTS weekday      int CHECK (weekday BETWEEN 1 AND 7);     -- 1 Monday .. 7 Sunday
ALTER TABLE public.finance_tasks ADD COLUMN IF NOT EXISTS day_of_month int CHECK (day_of_month BETWEEN 0 AND 31); -- 0 = last day of the month
ALTER TABLE public.finance_tasks ADD COLUMN IF NOT EXISTS shift_sunday boolean NOT NULL DEFAULT false;          -- fall on a Sunday -> next day
ALTER TABLE public.finance_tasks ADD COLUMN IF NOT EXISTS remind_hour  int NOT NULL DEFAULT 10 CHECK (remind_hour IN (10, 18));

ALTER TABLE public.finance_tasks DROP CONSTRAINT IF EXISTS finance_tasks_frequency_check;
ALTER TABLE public.finance_tasks ADD CONSTRAINT finance_tasks_frequency_check
  CHECK (frequency IN ('daily','every2days','weekly','monthly','quarterly','yearly','oneoff'));

-- ==== part 2 . next-date helper (pure) ====
CREATE OR REPLACE FUNCTION public.finance_task_next(p_freq text, p_weekday int, p_dom int, p_shift boolean, p_from date)
RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE v_step int; v_m date; v_last date; v_d int; v_r date;
BEGIN
  IF p_freq = 'daily' THEN RETURN p_from + 1; END IF;
  IF p_freq = 'every2days' THEN RETURN p_from + 2; END IF;
  IF p_freq = 'weekly' THEN RETURN p_from + 7; END IF;
  v_step := CASE p_freq WHEN 'monthly' THEN 1 WHEN 'quarterly' THEN 3 WHEN 'yearly' THEN 12 ELSE NULL END;
  IF v_step IS NULL THEN RETURN NULL; END IF;
  v_m    := (date_trunc('month', p_from)::date + make_interval(months => v_step))::date;
  v_last := (v_m + interval '1 month' - interval '1 day')::date;
  v_d := CASE WHEN p_dom IS NULL THEN LEAST(extract(day FROM p_from)::int, extract(day FROM v_last)::int)
              WHEN p_dom = 0     THEN extract(day FROM v_last)::int
              ELSE LEAST(p_dom, extract(day FROM v_last)::int) END;
  v_r := v_m + (v_d - 1);
  IF COALESCE(p_shift, false) AND extract(dow FROM v_r) = 0 THEN v_r := v_r + 1; END IF;
  RETURN v_r;
END $$;
REVOKE EXECUTE ON FUNCTION public.finance_task_next(text,int,int,boolean,date) FROM PUBLIC, anon, authenticated;

-- ==== part 3 . the task list (renames the 9 old rows, adds the rest) ====
-- columns: old title -> new title is handled first so nothing is duplicated.
UPDATE public.finance_tasks SET title = 'Approve pending payments from the reps and TA/DA claims' WHERE title = 'Approve pending payments';
UPDATE public.finance_tasks SET title = 'Import the bank statement into the app'                 WHERE title = 'Import bank statement';
UPDATE public.finance_tasks SET title = 'Send outstanding-payment reminders to clients'          WHERE title = 'Send outstanding reminders';
UPDATE public.finance_tasks SET title = 'Pay the vendors'                                        WHERE title = 'Pay vendor dues';
UPDATE public.finance_tasks SET title = 'File GSTR-3B and pay the tax'                           WHERE title = 'File GSTR-3B';

WITH x(title, freq, wd, dom, shift, hr, due, chan) AS (VALUES
  ('Approve pending payments from the reps and TA/DA claims','daily',NULL::int,NULL::int,false,10,DATE '2026-10-20','push'),
  ('Update the Untitled all-bank sheet with the day''s expenses','daily',NULL,NULL,false,10,DATE '2026-10-20','push'),
  ('Record purchases and sales, with the inward hard copy','daily',NULL,NULL,false,10,DATE '2026-10-20','push'),
  ('Follow up on any payment promised for today','daily',NULL,NULL,false,10,DATE '2026-10-20','push'),
  ('Send the daily expenses screenshot to Brijesh on WhatsApp','daily',NULL,NULL,false,18,DATE '2026-10-20','push'),
  ('Update the bank statement in Tally','every2days',NULL,NULL,false,10,DATE '2026-10-20','push'),
  ('Update GoGSTBill and the Excel sheet','every2days',NULL,NULL,false,10,DATE '2026-10-20','push'),
  ('Check all payments, invoices, sales, purchases and entries from the past week, then verify with Brijesh','weekly',1,NULL,false,10,DATE '2026-10-26','push'),
  ('Import the bank statement into the app','weekly',1,NULL,false,10,DATE '2026-10-26','push'),
  ('Tag REVIEW entries','weekly',1,NULL,false,10,DATE '2026-10-26','push'),
  ('Match client payments in the app with the bank (Reconcile tab)','weekly',1,NULL,false,10,DATE '2026-10-26','push'),
  ('Send outstanding-payment reminders to clients','weekly',1,NULL,false,10,DATE '2026-10-26','push'),
  ('List the vendor and media bills due this week','weekly',1,NULL,false,10,DATE '2026-10-26','push'),
  ('Pay the vendors','weekly',5,NULL,false,10,DATE '2026-10-23','push'),
  ('Run payroll','monthly',NULL,0,false,10,DATE '2026-10-31','push_wa'),
  ('Pay the salaries (on the 1st; if Sunday, next day)','monthly',NULL,1,true,10,DATE '2026-11-02','push'),
  ('Pay TDS','monthly',NULL,7,false,10,DATE '2026-11-07','push_wa'),
  ('File GSTR-1','monthly',NULL,11,false,10,DATE '2026-11-11','push'),
  ('Give the CA the hard copy of the month''s bills','monthly',NULL,15,false,10,DATE '2026-11-15','push'),
  ('File GSTR-3B and pay the tax','monthly',NULL,20,false,10,DATE '2026-10-20','push'),
  ('Collect TDS certificates and check TDS on government payments','monthly',NULL,25,false,10,DATE '2026-10-25','push'),
  ('Check the monthly profit report and the commission figures','monthly',NULL,5,false,10,DATE '2026-11-05','push'),
  ('Month-end close: check who is still unpaid and clear the REVIEW entries','monthly',NULL,0,false,10,DATE '2026-10-31','push'),
  ('File the TDS return and pay advance tax (check the dates with the CA)','quarterly',NULL,15,false,10,DATE '2026-12-15','push'),
  ('Hand over the books for audit and income tax return; set up the new financial year','yearly',NULL,1,false,10,DATE '2027-04-01','push')
)
INSERT INTO public.finance_tasks (title, frequency, weekday, day_of_month, shift_sunday, remind_hour, next_due, reminder_channel, status, is_active)
SELECT title, freq, wd, dom, shift, hr, due, chan, 'open', true FROM x
ON CONFLICT (title) DO UPDATE SET
  frequency = EXCLUDED.frequency, weekday = EXCLUDED.weekday, day_of_month = EXCLUDED.day_of_month,
  shift_sunday = EXCLUDED.shift_sunday, remind_hour = EXCLUDED.remind_hour, next_due = EXCLUDED.next_due,
  reminder_channel = EXCLUDED.reminder_channel, status = 'open', is_active = true;

NOTIFY pgrst, 'reload schema';

-- VERIFY (expect: tasks_total 25, active_armed 25, helper false-grant, cron 04:30+12:30 after p5_p6 part 2 re-run)
-- SELECT count(*) tasks_total, count(*) FILTER (WHERE next_due IS NOT NULL AND is_active) active_armed FROM public.finance_tasks;
-- UNDO: restore old rows from _bak_finance_tasks_p421 and DELETE the 16 new titles.
