-- Phase 366 - "Send campaign report" every Monday until the campaign ends, for every
-- ACTIVE won PRIVATE client, assigned to Safika (owner request 2026-10-14).
-- Uses the Work module's own repeating-task table (work_templates, weekly, Monday):
-- the 07:00 IST cron (work_run_recurring) creates the task each Monday and stops by itself
-- after the campaign end date. One template per CLIENT (two quotes for one client = one task,
-- ending on the later date). Clients whose campaign has no Monday left are skipped.
-- Idempotent: a client that already has an active "Send campaign report - <client>" template is skipped.
-- UNDO: UPDATE work_templates SET is_active=false WHERE title LIKE 'Send campaign report - %' AND created_by = <admin>;
BEGIN;
DO $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_safika uuid;
  v_admin uuid;
  v_n_proj int := 0; v_n_tpl int := 0;
  c record; v_proj uuid;
BEGIN
  SELECT id INTO v_safika FROM public.users WHERE role='staff' AND is_active AND name ILIKE 'safika%' LIMIT 2;
  IF v_safika IS NULL THEN RAISE EXCEPTION 'Safika not found / not unique'; END IF;
  SELECT id INTO v_admin FROM public.users WHERE role='admin' AND is_active ORDER BY created_at LIMIT 1;
  INSERT INTO public.work_members (user_id, added_by) VALUES (v_safika, v_admin) ON CONFLICT (user_id) DO NOTHING;

  FOR c IN
    SELECT btrim(COALESCE(NULLIF(btrim(q.client_company),''), q.client_name)) AS client,
           max(q.campaign_end_date) AS end_date,
           array_agg(DISTINCT q.quote_number ORDER BY q.quote_number) AS quotes
      FROM public.quotes q
     WHERE q.status = 'won' AND q.segment = 'PRIVATE'
       AND q.campaign_end_date IS NOT NULL AND q.campaign_end_date >= v_today
       AND COALESCE(NULLIF(btrim(q.client_company),''), NULLIF(btrim(q.client_name),'')) IS NOT NULL
     GROUP BY lower(btrim(COALESCE(NULLIF(btrim(q.client_company),''), q.client_name))),
              btrim(COALESCE(NULLIF(btrim(q.client_company),''), q.client_name))
  LOOP
    -- skip when no Monday is left before the campaign ends
    IF NOT EXISTS (SELECT 1 FROM generate_series(v_today, c.end_date, interval '1 day') g
                    WHERE extract(isodow FROM g) = 1) THEN CONTINUE; END IF;

    SELECT id INTO v_proj FROM public.work_projects WHERE lower(btrim(name)) = lower(c.client);
    IF v_proj IS NULL THEN
      INSERT INTO public.work_projects (name, kind, created_by) VALUES (left(c.client, 120), 'client', v_admin)
      ON CONFLICT DO NOTHING RETURNING id INTO v_proj;
      IF v_proj IS NULL THEN SELECT id INTO v_proj FROM public.work_projects WHERE lower(btrim(name)) = lower(c.client); END IF;
      v_n_proj := v_n_proj + 1;
    END IF;

    IF EXISTS (SELECT 1 FROM public.work_templates
                WHERE is_active AND assignee_id = v_safika AND project_id = v_proj
                  AND title LIKE 'Send campaign report - %') THEN CONTINUE; END IF;

    INSERT INTO public.work_templates (title, project_id, assignee_id, repeat_kind, weekday, start_date, end_date, created_by)
    VALUES (left('Send campaign report - ' || c.client, 120), v_proj, v_safika, 'weekly', 1, v_today, c.end_date, v_admin);
    v_n_tpl := v_n_tpl + 1;
  END LOOP;
  RAISE NOTICE 'projects created %, templates created %', v_n_proj, v_n_tpl;
END $$;

SELECT t.title, t.weekday, t.start_date, t.end_date, u.name AS assignee, p.name AS client
  FROM public.work_templates t JOIN public.users u ON u.id = t.assignee_id LEFT JOIN public.work_projects p ON p.id = t.project_id
 WHERE t.title LIKE 'Send campaign report - %' ORDER BY t.end_date, t.title;
COMMIT;
