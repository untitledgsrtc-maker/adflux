-- supabase_phase33t_smart_task_fix.sql
--
-- Phase 33T — fix generate_lead_tasks RPC that's been broken since
-- Phase 31S shipped. Owner caught it in Chrome console:
--   POST /rest/v1/rpc/generate_lead_tasks 400 (Bad Request)
--   column l.next_follow_up_at does not exist
--
-- Root cause: Rule 3 ("follow_up_due") joins leads with itself and
-- reads leads.next_follow_up_at — a column that was never added.
-- Leads has next_action_time (TIME, hour-minute only, Phase 31J)
-- but actual follow-up dates live in the separate follow_ups table.
--
-- Effect: every call to generate_lead_tasks raises 42703, useLeadTasks
-- hook catches the error, no tasks ever generate. /work TodayTasksPanel
-- has been silently empty for everyone since 31S.
--
-- Fix: rewrite Rule 3 to read from the follow_ups table (join on
-- lead_id, take the earliest pending follow_up). Phase 33Q's
-- suggested-tasks fallback already covers this surface from the UI
-- side; this fixes the underlying engine.

CREATE OR REPLACE FUNCTION public.generate_lead_tasks(p_user_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d         date := CURRENT_DATE;
  inserted  int  := 0;
  rowcount  int;
BEGIN
  -- Wipe today's prior generations for this user so we don't double-up.
  DELETE FROM public.lead_tasks
   WHERE assigned_to = p_user_id
     AND generated_for = d
     AND NOT done
     AND NOT skipped;

  -- Rule 1: hot — heat='hot' leads not contacted in 24h.
  INSERT INTO public.lead_tasks
    (lead_id, assigned_to, kind, priority, reason, generated_for)
  SELECT
    l.id, l.assigned_to, 'hot', 10,
    'Hot lead — ' || COALESCE(NULLIF(l.last_outcome, ''), 'follow up'),
    d
  FROM public.leads l
  WHERE l.assigned_to = p_user_id
    AND l.heat = 'hot'
    AND l.stage NOT IN ('Won', 'Lost')
    AND COALESCE(l.last_contact_at, l.created_at) < (now() - INTERVAL '24 hours')
  ON CONFLICT (lead_id, kind, generated_for) DO NOTHING;
  GET DIAGNOSTICS rowcount = ROW_COUNT;
  inserted := inserted + rowcount;

  -- Rule 2: new — new leads with no contact, > 48h old.
  INSERT INTO public.lead_tasks
    (lead_id, assigned_to, kind, priority, reason, generated_for)
  SELECT
    l.id, l.assigned_to, 'new_lead', 20,
    'New lead — never contacted',
    d
  FROM public.leads l
  WHERE l.assigned_to = p_user_id
    AND l.stage = 'New'
    AND l.last_contact_at IS NULL
    AND l.stage NOT IN ('Won', 'Lost')
    AND COALESCE(l.last_contact_at, l.created_at) < (now() - INTERVAL '48 hours')
  ON CONFLICT (lead_id, kind, generated_for) DO NOTHING;
  GET DIAGNOSTICS rowcount = ROW_COUNT;
  inserted := inserted + rowcount;

  -- Rule 3 FIXED: follow_up_due — earliest pending follow_up on or
  -- before today. Joined from follow_ups (the actual storage) instead
  -- of the non-existent leads.next_follow_up_at column.
  INSERT INTO public.lead_tasks
    (lead_id, assigned_to, kind, priority, due_at, reason, generated_for)
  SELECT
    l.id, l.assigned_to, 'follow_up_due', 30,
    (fu.follow_up_date::timestamp),
    'Follow-up: ' || COALESCE(NULLIF(fu.note, ''), 'scheduled touch'),
    d
  FROM public.leads l
  JOIN LATERAL (
    SELECT f.follow_up_date, f.note
      FROM public.follow_ups f
     WHERE f.lead_id = l.id
       AND f.is_done = false
       AND f.follow_up_date IS NOT NULL
       AND f.follow_up_date <= d
     ORDER BY f.follow_up_date ASC
     LIMIT 1
  ) fu ON true
  WHERE l.assigned_to = p_user_id
    AND l.stage NOT IN ('Won', 'Lost')
  ON CONFLICT (lead_id, kind, generated_for) DO NOTHING;
  GET DIAGNOSTICS rowcount = ROW_COUNT;
  inserted := inserted + rowcount;

  -- Rule 4: sales_ready — SalesReady leads handed off in last 6h.
  INSERT INTO public.lead_tasks
    (lead_id, assigned_to, kind, priority, reason, generated_for)
  SELECT
    l.id, l.assigned_to, 'sales_ready', 40,
    'Sales-ready handoff',
    d
  FROM public.leads l
  WHERE l.assigned_to = p_user_id
    AND l.stage = 'SalesReady'
    AND l.handoff_sla_due_at IS NOT NULL
    AND l.handoff_sla_due_at >= (now() - INTERVAL '6 hours')
  ON CONFLICT (lead_id, kind, generated_for) DO NOTHING;
  GET DIAGNOSTICS rowcount = ROW_COUNT;
  inserted := inserted + rowcount;

  -- Rule 5: nurture revisit — Phase 31N revisit_date or legacy
  -- Lost.nurture_revisit_date due today.
  INSERT INTO public.lead_tasks
    (lead_id, assigned_to, kind, priority, due_at, reason, generated_for)
  SELECT
    l.id, l.assigned_to, 'nurture_revisit', 50,
    (l.revisit_date::timestamp AT TIME ZONE 'Asia/Kolkata'),
    'Nurture revisit due',
    d
  FROM public.leads l
  WHERE l.assigned_to = p_user_id
    AND l.stage = 'Nurture'
    AND l.revisit_date IS NOT NULL
    AND l.revisit_date <= d
  ON CONFLICT (lead_id, kind, generated_for) DO NOTHING;
  GET DIAGNOSTICS rowcount = ROW_COUNT;
  inserted := inserted + rowcount;

  RETURN inserted;
END $$;

GRANT EXECUTE ON FUNCTION public.generate_lead_tasks(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY:
--   SELECT generate_lead_tasks(auth.uid());
--   Should return a non-negative int, no error.
