-- supabase_phase31s_smart_task_nurture.sql
--
-- Phase 31S (10 May 2026) — wire the Phase 31N `revisit_date` column
-- into the smart-task generator.
--
-- Background:
-- Phase 19 (smart tasks) had a `nurture_revisit` rule that read
-- `leads.nurture_revisit_date`. Phase 30A killed the Nurture stage
-- and repurposed `nurture_revisit_date` as a "long-tail revisit" hint
-- on Lost rows. Phase 31N restored Nurture as its own stage and added
-- a NEW column `leads.revisit_date` for it. The Phase 19 rule still
-- reads the legacy column, so new Nurture leads NEVER surface in
-- TodayTasksPanel. The owner's audit caught this.
--
-- Fix: rewrite Rule 5 to read `revisit_date` for stage='Nurture'.
-- Also keep firing for Lost-with-`nurture_revisit_date` so the legacy
-- "revisit this dead deal" hint survives.
--
-- The generator function is dropped + recreated; only Rule 5 changed.
-- All other rules (sla_breach, hot_idle, follow_up_due, sales_ready,
-- new_untouched, quote_stale) untouched.
--
-- Owner needs to paste this into Supabase Studio after pulling the
-- code change. Idempotent — safe to re-run.

CREATE OR REPLACE FUNCTION public.generate_lead_tasks(p_date date DEFAULT CURRENT_DATE)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  d         date := COALESCE(p_date, CURRENT_DATE);
  inserted  int  := 0;
  rowcount  int;
BEGIN
  -- Rule 1: sla_breach — SalesReady past 24h handoff_sla_due_at
  -- (kept exactly as Phase 19 — copy-pasted from existing function)
  INSERT INTO public.lead_tasks
    (lead_id, assigned_to, kind, priority, due_at, reason, generated_for)
  SELECT
    l.id, l.assigned_to, 'sla_breach', 10,
    l.handoff_sla_due_at,
    'Sales-ready handoff overdue',
    d
  FROM public.leads l
  WHERE l.assigned_to IS NOT NULL
    AND l.stage = 'SalesReady'
    AND l.handoff_sla_due_at IS NOT NULL
    AND l.handoff_sla_due_at < now()
    AND NOT EXISTS (
      SELECT 1 FROM public.lead_activities a
       WHERE a.lead_id = l.id
         AND a.created_at >= l.handoff_sla_due_at
    )
  ON CONFLICT (lead_id, kind, generated_for) DO NOTHING;
  GET DIAGNOSTICS rowcount = ROW_COUNT;
  inserted := inserted + rowcount;

  -- Rule 2: hot_idle — Hot lead, no activity in last 48h, not Won/Lost
  INSERT INTO public.lead_tasks
    (lead_id, assigned_to, kind, priority, reason, generated_for)
  SELECT
    l.id, l.assigned_to, 'hot_idle', 20,
    'Hot lead — no touch in last 48h',
    d
  FROM public.leads l
  WHERE l.assigned_to IS NOT NULL
    AND l.heat = 'hot'
    AND l.stage NOT IN ('Won', 'Lost')
    AND COALESCE(l.last_contact_at, l.created_at) < (now() - INTERVAL '48 hours')
  ON CONFLICT (lead_id, kind, generated_for) DO NOTHING;
  GET DIAGNOSTICS rowcount = ROW_COUNT;
  inserted := inserted + rowcount;

  -- Rule 3: follow_up_due — has a follow_up_date that's <= today
  INSERT INTO public.lead_tasks
    (lead_id, assigned_to, kind, priority, due_at, reason, generated_for)
  SELECT
    l.id, l.assigned_to, 'follow_up_due', 30,
    (l.next_follow_up_at::timestamp),
    'Follow-up scheduled',
    d
  FROM public.leads l
  WHERE l.assigned_to IS NOT NULL
    AND l.stage NOT IN ('Won', 'Lost')
    AND l.next_follow_up_at IS NOT NULL
    AND l.next_follow_up_at <= d
  ON CONFLICT (lead_id, kind, generated_for) DO NOTHING;
  GET DIAGNOSTICS rowcount = ROW_COUNT;
  inserted := inserted + rowcount;

  -- Rule 4: sales_ready — newly minted SalesReady leads (last 6h)
  INSERT INTO public.lead_tasks
    (lead_id, assigned_to, kind, priority, reason, generated_for)
  SELECT
    l.id, l.assigned_to, 'sales_ready', 40,
    'Sales-ready handoff',
    d
  FROM public.leads l
  WHERE l.assigned_to IS NOT NULL
    AND l.stage = 'SalesReady'
    AND l.handoff_sla_due_at IS NOT NULL
    AND l.handoff_sla_due_at >= (now() - INTERVAL '6 hours')
  ON CONFLICT (lead_id, kind, generated_for) DO NOTHING;
  GET DIAGNOSTICS rowcount = ROW_COUNT;
  inserted := inserted + rowcount;

  -- Rule 5: nurture_revisit — Phase 31S rewrite.
  --   (a) New Phase 31N Nurture stage with `revisit_date` due
  --   (b) Legacy Lost rows with `nurture_revisit_date` due
  -- Both fire as the same task kind so reps see one row regardless
  -- of which column the date came from. Owner audit caught Rule 5
  -- never firing for new Nurture leads because it only read column (b).
  INSERT INTO public.lead_tasks
    (lead_id, assigned_to, kind, priority, due_at, reason, generated_for)
  SELECT
    l.id, l.assigned_to, 'nurture_revisit', 50,
    (l.revisit_date::timestamp AT TIME ZONE 'Asia/Kolkata'),
    'Nurture revisit due',
    d
  FROM public.leads l
  WHERE l.assigned_to IS NOT NULL
    AND l.stage = 'Nurture'
    AND l.revisit_date IS NOT NULL
    AND l.revisit_date <= d
  ON CONFLICT (lead_id, kind, generated_for) DO NOTHING;
  GET DIAGNOSTICS rowcount = ROW_COUNT;
  inserted := inserted + rowcount;

  -- Legacy 5b: Lost rows that carry an optional revisit hint.
  INSERT INTO public.lead_tasks
    (lead_id, assigned_to, kind, priority, due_at, reason, generated_for)
  SELECT
    l.id, l.assigned_to, 'nurture_revisit', 50,
    (l.nurture_revisit_date::timestamp AT TIME ZONE 'Asia/Kolkata'),
    'Lost lead — revisit window open',
    d
  FROM public.leads l
  WHERE l.assigned_to IS NOT NULL
    AND l.stage = 'Lost'
    AND l.nurture_revisit_date IS NOT NULL
    AND l.nurture_revisit_date <= d
  ON CONFLICT (lead_id, kind, generated_for) DO NOTHING;
  GET DIAGNOSTICS rowcount = ROW_COUNT;
  inserted := inserted + rowcount;

  -- Rule 6: new_untouched — created in last 24h, no activities, not Won/Lost
  INSERT INTO public.lead_tasks
    (lead_id, assigned_to, kind, priority, reason, generated_for)
  SELECT
    l.id, l.assigned_to, 'new_untouched', 60,
    'New lead — not yet contacted',
    d
  FROM public.leads l
  WHERE l.assigned_to IS NOT NULL
    AND l.stage = 'New'
    AND l.created_at >= (now() - INTERVAL '24 hours')
    AND NOT EXISTS (
      SELECT 1 FROM public.lead_activities a
       WHERE a.lead_id = l.id
    )
  ON CONFLICT (lead_id, kind, generated_for) DO NOTHING;
  GET DIAGNOSTICS rowcount = ROW_COUNT;
  inserted := inserted + rowcount;

  -- Rule 7: quote_stale — sent quote, no decision in 14d
  INSERT INTO public.lead_tasks
    (lead_id, assigned_to, kind, priority, reason, generated_for)
  SELECT
    l.id, l.assigned_to, 'quote_stale', 70,
    'Quote sent 14d+, no decision',
    d
  FROM public.leads l
  JOIN public.quotes q ON q.id = l.quote_id
  WHERE l.assigned_to IS NOT NULL
    AND l.stage = 'QuoteSent'
    AND q.status = 'sent'
    AND q.updated_at < (now() - INTERVAL '14 days')
  ON CONFLICT (lead_id, kind, generated_for) DO NOTHING;
  GET DIAGNOSTICS rowcount = ROW_COUNT;
  inserted := inserted + rowcount;

  RETURN inserted;
END;
$$;

NOTIFY pgrst, 'reload schema';

-- VERIFY:
-- SELECT public.generate_lead_tasks(CURRENT_DATE);
--   should return an integer count of rows inserted.
-- SELECT count(*) FROM public.lead_tasks
--  WHERE kind='nurture_revisit' AND status='open';
--   should be > 0 if any Nurture lead's revisit_date has hit today.
