-- Phase 423b (owner 2026-10-19): vendor follow-ups for running Auto Hood campaigns + the rule no longer touches them.
BEGIN;
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
    IF q.campaign_start_date IS NOT NULL AND q.campaign_start_date >= v_today THEN   -- (running campaigns: Phase 423b adds theirs by hand, never touched here)
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

-- Phase 423b: the 2 already-running Auto Hood campaigns: vendor follow-up 3x a day until the campaign END date
CREATE TEMP TABLE run_auto AS SELECT id, campaign_end_date, COALESCE(NULLIF(btrim(client_company),''), client_name, 'Department') client, quote_number FROM public.quotes
 WHERE status='won' AND segment='GOVERNMENT' AND media_type='AUTO_HOOD' AND campaign_end_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date;
SELECT public.work__govt_tpl(r.id, k.kind, 'Vendor work follow-up (' || k.lbl || ') - ' || left(btrim(r.client),80) || ' (' || COALESCE(r.quote_number,'quote') || ')', 'daily', NULL, k.t,
       (now() AT TIME ZONE 'Asia/Kolkata')::date, r.campaign_end_date,
       (SELECT user_id FROM public.work_rule_settings WHERE key='govt_tasks_assignee'),
       (SELECT id FROM public.users WHERE role='admin' AND is_active ORDER BY created_at LIMIT 1),
       (SELECT id FROM public.work_projects WHERE lower(btrim(name)) = lower(btrim(r.client))))
  FROM run_auto r CROSS JOIN (VALUES ('vendor_1','11 AM',TIME '11:00'),('vendor_2','3 PM',TIME '15:00'),('vendor_3','6 PM',TIME '18:00')) k(kind,lbl,t);
SELECT govt_kind, due_time::text t, count(*) n, min(end_date)::text ends FROM public.work_templates WHERE govt_kind LIKE 'vendor_%' AND is_active GROUP BY 1,2 ORDER BY 1;
COMMIT;
