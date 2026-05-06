-- supabase_phase19_smart_tasks.sql
--
-- Phase 19 — Smart Task Engine
--
-- Generates today's call list per rep from real lead state. No mocks.
-- Six rules, priority order (lower = more important):
--
--   10  sla_breach           SalesReady past 24h handoff_sla_due_at
--   20  follow_up_due        lead_activities.next_action_date <= today
--   30  hot_idle             heat=hot, last_contact > 24h ago, not Won/Lost
--   40  qualified_no_quote   Qualified > 3 days, no quote_id
--   50  nurture_revisit      nurture_revisit_date <= today
--   60  new_untouched        created today, no lead_activities, not Won/Lost
--
-- Tasks are deduplicated per (lead_id, kind, generated_for) so running
-- the generator twice in the same day is safe. Status flow:
--
--   open → done       rep marked complete
--   open → snoozed    rep pushed to tomorrow
--   open → skipped    rep dismissed
--
-- RLS: rep sees own; sales_manager sees direct reports; admin/co_owner
-- see all. Telecaller is excluded for now — they live on /telecaller
-- which has its own queue logic.
--
-- Generation is invoked manually from the UI in this phase. Phase 1
-- follow-up: schedule via pg_cron at 06:00 IST so the list is ready
-- when reps open /work.

------------------------------------------------------------------
-- Table
------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lead_tasks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  assigned_to     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  kind            text NOT NULL,
  priority        smallint NOT NULL DEFAULT 50,
  due_at          timestamptz,
  status          text NOT NULL DEFAULT 'open',
  reason          text,
  generated_at    timestamptz NOT NULL DEFAULT now(),
  generated_for   date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date,
  completed_at    timestamptz,
  snoozed_until   date,
  CONSTRAINT lead_tasks_kind_chk CHECK (kind IN (
    'sla_breach',
    'follow_up_due',
    'hot_idle',
    'qualified_no_quote',
    'nurture_revisit',
    'new_untouched'
  )),
  CONSTRAINT lead_tasks_status_chk CHECK (status IN (
    'open', 'done', 'snoozed', 'skipped'
  )),
  CONSTRAINT lead_tasks_unique_per_day UNIQUE (lead_id, kind, generated_for)
);

CREATE INDEX IF NOT EXISTS idx_lead_tasks_assigned_status_date
  ON public.lead_tasks (assigned_to, status, generated_for DESC);

CREATE INDEX IF NOT EXISTS idx_lead_tasks_lead
  ON public.lead_tasks (lead_id);

------------------------------------------------------------------
-- Generator function
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_lead_tasks(p_date date DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d         date := COALESCE(p_date, (now() AT TIME ZONE 'Asia/Kolkata')::date);
  inserted  integer := 0;
  rowcount  integer;
BEGIN
  -- Rule 1: sla_breach — SalesReady past handoff_sla_due_at
  INSERT INTO public.lead_tasks
    (lead_id, assigned_to, kind, priority, due_at, reason, generated_for)
  SELECT
    l.id,
    l.assigned_to,
    'sla_breach',
    10,
    l.handoff_sla_due_at,
    'SalesReady past 24h SLA',
    d
  FROM public.leads l
  WHERE l.assigned_to IS NOT NULL
    AND l.stage = 'SalesReady'
    AND l.handoff_sla_due_at IS NOT NULL
    AND l.handoff_sla_due_at < now()
  ON CONFLICT (lead_id, kind, generated_for) DO NOTHING;
  GET DIAGNOSTICS rowcount = ROW_COUNT;
  inserted := inserted + rowcount;

  -- Rule 2: follow_up_due — lead_activities.next_action_date <= today,
  -- only the most recent activity per lead with an unresolved next-action.
  -- DISTINCT ON + ORDER BY are wrapped in a subquery so the outer
  -- INSERT's ON CONFLICT clause parses unambiguously.
  INSERT INTO public.lead_tasks
    (lead_id, assigned_to, kind, priority, due_at, reason, generated_for)
  SELECT lead_id, assigned_to, kind, priority, due_at, reason, generated_for
  FROM (
    SELECT DISTINCT ON (la.lead_id)
      la.lead_id                                                            AS lead_id,
      l.assigned_to                                                         AS assigned_to,
      'follow_up_due'::text                                                 AS kind,
      20::smallint                                                          AS priority,
      (la.next_action_date::timestamp AT TIME ZONE 'Asia/Kolkata')          AS due_at,
      COALESCE('Follow-up: ' || NULLIF(la.next_action, ''),
               'Scheduled follow-up')                                       AS reason,
      d                                                                     AS generated_for
    FROM public.lead_activities la
    JOIN public.leads l ON l.id = la.lead_id
    WHERE la.next_action_date IS NOT NULL
      AND la.next_action_date <= d
      AND l.assigned_to IS NOT NULL
      AND l.stage NOT IN ('Won', 'Lost')
    ORDER BY la.lead_id, la.created_at DESC
  ) sub
  ON CONFLICT (lead_id, kind, generated_for) DO NOTHING;
  GET DIAGNOSTICS rowcount = ROW_COUNT;
  inserted := inserted + rowcount;

  -- Rule 3: hot_idle — heat=hot, last_contact > 24h ago, not Won/Lost
  INSERT INTO public.lead_tasks
    (lead_id, assigned_to, kind, priority, reason, generated_for)
  SELECT
    l.id,
    l.assigned_to,
    'hot_idle',
    30,
    CASE
      WHEN l.last_contact_at IS NULL
        THEN 'Hot lead — never contacted'
      ELSE 'Hot lead — idle ' ||
           EXTRACT(day FROM (now() - l.last_contact_at))::text || 'd'
    END,
    d
  FROM public.leads l
  WHERE l.assigned_to IS NOT NULL
    AND l.heat = 'hot'
    AND l.stage NOT IN ('Won', 'Lost')
    AND (l.last_contact_at IS NULL OR l.last_contact_at < now() - interval '24 hours')
  ON CONFLICT (lead_id, kind, generated_for) DO NOTHING;
  GET DIAGNOSTICS rowcount = ROW_COUNT;
  inserted := inserted + rowcount;

  -- Rule 4: qualified_no_quote — Qualified for > 3 days, no quote_id
  INSERT INTO public.lead_tasks
    (lead_id, assigned_to, kind, priority, reason, generated_for)
  SELECT
    l.id,
    l.assigned_to,
    'qualified_no_quote',
    40,
    'Qualified ' ||
      EXTRACT(day FROM (now() - COALESCE(l.qualified_at, l.created_at)))::text ||
      'd ago — no quote yet',
    d
  FROM public.leads l
  WHERE l.assigned_to IS NOT NULL
    AND l.stage IN ('Qualified', 'SalesReady')
    AND l.quote_id IS NULL
    AND COALESCE(l.qualified_at, l.created_at) < now() - interval '3 days'
  ON CONFLICT (lead_id, kind, generated_for) DO NOTHING;
  GET DIAGNOSTICS rowcount = ROW_COUNT;
  inserted := inserted + rowcount;

  -- Rule 5: nurture_revisit — Nurture stage with revisit date <= today
  INSERT INTO public.lead_tasks
    (lead_id, assigned_to, kind, priority, due_at, reason, generated_for)
  SELECT
    l.id,
    l.assigned_to,
    'nurture_revisit',
    50,
    (l.nurture_revisit_date::timestamp AT TIME ZONE 'Asia/Kolkata'),
    'Nurture revisit due',
    d
  FROM public.leads l
  WHERE l.assigned_to IS NOT NULL
    AND l.stage = 'Nurture'
    AND l.nurture_revisit_date IS NOT NULL
    AND l.nurture_revisit_date <= d
  ON CONFLICT (lead_id, kind, generated_for) DO NOTHING;
  GET DIAGNOSTICS rowcount = ROW_COUNT;
  inserted := inserted + rowcount;

  -- Rule 6: new_untouched — created in last 24h, no activities, not Won/Lost
  INSERT INTO public.lead_tasks
    (lead_id, assigned_to, kind, priority, reason, generated_for)
  SELECT
    l.id,
    l.assigned_to,
    'new_untouched',
    60,
    'New lead — no contact yet',
    d
  FROM public.leads l
  WHERE l.assigned_to IS NOT NULL
    AND l.created_at >= now() - interval '24 hours'
    AND l.stage NOT IN ('Won', 'Lost')
    AND NOT EXISTS (
      SELECT 1 FROM public.lead_activities la WHERE la.lead_id = l.id
    )
  ON CONFLICT (lead_id, kind, generated_for) DO NOTHING;
  GET DIAGNOSTICS rowcount = ROW_COUNT;
  inserted := inserted + rowcount;

  RETURN inserted;
END;
$$;

COMMENT ON FUNCTION public.generate_lead_tasks IS
  'Phase 19 — generates today''s ranked task list per rep from real lead state. Idempotent.';

------------------------------------------------------------------
-- Mark done helper — closes a task and logs an activity
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_lead_task(p_task_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  t public.lead_tasks%ROWTYPE;
BEGIN
  SELECT * INTO t FROM public.lead_tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task % not found or RLS denied', p_task_id;
  END IF;
  IF t.status <> 'open' THEN
    RAISE EXCEPTION 'Task already %', t.status;
  END IF;

  UPDATE public.lead_tasks
     SET status = 'done', completed_at = now()
   WHERE id = p_task_id;

  INSERT INTO public.lead_activities
    (lead_id, activity_type, notes, created_by)
  VALUES
    (t.lead_id, 'note', 'Smart task closed: ' || COALESCE(t.reason, t.kind), auth.uid());
END;
$$;

------------------------------------------------------------------
-- RLS
------------------------------------------------------------------
ALTER TABLE public.lead_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_tasks_select_self_or_chain ON public.lead_tasks;
CREATE POLICY lead_tasks_select_self_or_chain
ON public.lead_tasks
FOR SELECT
USING (
  -- rep sees own tasks
  assigned_to = auth.uid()
  OR
  -- admin / co_owner see all
  public.get_my_role() IN ('admin', 'co_owner')
  OR
  -- sales_manager sees direct reports
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = lead_tasks.assigned_to
      AND u.manager_id = auth.uid()
  )
);

DROP POLICY IF EXISTS lead_tasks_update_self_or_chain ON public.lead_tasks;
CREATE POLICY lead_tasks_update_self_or_chain
ON public.lead_tasks
FOR UPDATE
USING (
  assigned_to = auth.uid()
  OR public.get_my_role() IN ('admin', 'co_owner')
  OR EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = lead_tasks.assigned_to AND u.manager_id = auth.uid()
  )
);

-- Inserts go through the SECURITY DEFINER generator function only.
-- We deliberately don't expose direct INSERT to the API.
DROP POLICY IF EXISTS lead_tasks_insert_admin ON public.lead_tasks;
CREATE POLICY lead_tasks_insert_admin
ON public.lead_tasks
FOR INSERT
WITH CHECK (public.get_my_role() IN ('admin', 'co_owner'));

------------------------------------------------------------------
-- Realtime publication
------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_tasks;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

------------------------------------------------------------------
-- PostgREST schema reload
------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

------------------------------------------------------------------
-- VERIFY: paste these in Supabase SQL editor after running the file
------------------------------------------------------------------
-- 1. Table exists with 13 columns:
--    SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'lead_tasks' ORDER BY ordinal_position;
--
-- 2. Function exists:
--    SELECT proname FROM pg_proc WHERE proname IN
--      ('generate_lead_tasks', 'complete_lead_task');
--
-- 3. Generate today's tasks (should return integer count):
--    SELECT generate_lead_tasks();
--
-- 4. Inspect what was created:
--    SELECT kind, count(*) FROM lead_tasks
--    WHERE generated_for = current_date
--    GROUP BY kind ORDER BY 1;
--
-- 5. RLS on:
--    SELECT relrowsecurity FROM pg_class WHERE relname = 'lead_tasks';  -- t
