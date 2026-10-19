-- Phase 425 (owner 2026-10-19): more reminders for Diya (accounts).
--  Monthly (finance_tasks, 10 AM): station electricity bills on the 5th, 10th, 15th; GSRTC station rent + licence on the 3rd;
--  EMI on the 8th and 9th; agency commission 10th; bank reconciliation 2nd; staff advances 25th; Tally/Excel backup 28th.
--  One-off: ask the CA about professional tax / PF / ESI.
--  Per won PRIVATE deal (Work task, like the government rule of Phase 422): "Raise tax invoice - client (quote)" for Diya, due the day after Won.
-- Idempotent. UNDO at the bottom.
BEGIN;
INSERT INTO public.finance_tasks (title, frequency, weekday, day_of_month, shift_sunday, remind_hour, next_due, reminder_channel, status, is_active)
SELECT * FROM (VALUES
  ('Pay the stations'' electricity bills (5th)','monthly',NULL::int,5,false,10,DATE '2026-11-05','push'),
  ('Pay the stations'' electricity bills (10th)','monthly',NULL,10,false,10,DATE '2026-11-10','push'),
  ('Pay the stations'' electricity bills (15th)','monthly',NULL,15,false,10,DATE '2026-11-15','push'),
  ('Pay GSRTC station rent and the licence','monthly',NULL,3,false,10,DATE '2026-11-03','push'),
  ('Pay EMI (8th)','monthly',NULL,8,false,10,DATE '2026-11-08','push'),
  ('Pay EMI (9th)','monthly',NULL,9,false,10,DATE '2026-11-09','push'),
  ('Pay agency commission','monthly',NULL,10,false,10,DATE '2026-11-10','push'),
  ('Bank reconciliation: bank vs Tally vs the app','monthly',NULL,2,false,10,DATE '2026-11-02','push'),
  ('Staff advances and reimbursements: record and recover','monthly',NULL,25,false,10,DATE '2026-10-25','push'),
  ('Back up the Tally data and Excel sheets','monthly',NULL,28,false,10,DATE '2026-10-28','push'),
  ('Ask the CA: professional tax, PF or ESI - do they apply?','oneoff',NULL,NULL,false,10,DATE '2026-10-26','push')
) v(title,frequency,weekday,day_of_month,shift_sunday,remind_hour,next_due,reminder_channel)
CROSS JOIN LATERAL (SELECT 'open'::text status, true is_active) s
ON CONFLICT (title) DO UPDATE SET frequency=EXCLUDED.frequency, day_of_month=EXCLUDED.day_of_month, next_due=EXCLUDED.next_due, is_active=true;

-- per won private deal: tax invoice task for Diya
INSERT INTO public.work_rule_settings (key, user_id)
SELECT 'private_invoice_assignee', u.id FROM public.users u WHERE u.name='Diya' AND u.role='accounts' AND u.is_active
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.work_make_private_invoice_task(p_quote uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE q public.quotes%ROWTYPE; v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
        v_to uuid; v_creator uuid; v_client text; v_proj uuid; v_label text;
BEGIN
  SELECT * INTO q FROM public.quotes WHERE id = p_quote;
  IF NOT FOUND OR q.status <> 'won' OR q.segment <> 'PRIVATE' THEN RETURN; END IF;
  SELECT s.user_id INTO v_to FROM public.work_rule_settings s JOIN public.users u ON u.id = s.user_id AND u.is_active WHERE s.key = 'private_invoice_assignee';
  IF v_to IS NULL THEN RETURN; END IF;
  SELECT id INTO v_creator FROM public.users WHERE role='admin' AND is_active ORDER BY created_at LIMIT 1;
  v_client := btrim(COALESCE(NULLIF(btrim(q.client_company),''), q.client_name, 'Client'));
  v_label  := left(v_client, 80) || ' (' || COALESCE(q.quote_number,'quote') || ')';
  SELECT id INTO v_proj FROM public.work_projects WHERE lower(btrim(name)) = lower(v_client);
  IF v_proj IS NULL THEN
    INSERT INTO public.work_projects (name, kind, created_by) VALUES (left(v_client,120), 'client', v_creator) ON CONFLICT DO NOTHING RETURNING id INTO v_proj;
    IF v_proj IS NULL THEN SELECT id INTO v_proj FROM public.work_projects WHERE lower(btrim(name)) = lower(v_client); END IF;
  END IF;
  INSERT INTO public.work_members (user_id, added_by) VALUES (v_to, v_creator) ON CONFLICT (user_id) DO NOTHING;
  PERFORM public.work__govt_task(q.id, 'tax_invoice', 'Raise tax invoice - ' || v_label, v_today + 1, v_to, v_creator, v_proj);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.tg_quote_private_invoice() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN PERFORM public.work_make_private_invoice_task(NEW.id); RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_quote_private_invoice ON public.quotes;
CREATE TRIGGER trg_quote_private_invoice AFTER UPDATE OF status ON public.quotes
  FOR EACH ROW WHEN (NEW.status = 'won' AND OLD.status IS DISTINCT FROM 'won' AND NEW.segment = 'PRIVATE') EXECUTE FUNCTION public.tg_quote_private_invoice();
REVOKE EXECUTE ON FUNCTION public.work_make_private_invoice_task(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_quote_private_invoice() FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
-- UNDO: DROP TRIGGER trg_quote_private_invoice ON quotes; DELETE FROM finance_tasks WHERE title IN (the 11 titles above);
--       DELETE FROM work_tasks WHERE source_kind='tax_invoice' AND status<>'finished';
