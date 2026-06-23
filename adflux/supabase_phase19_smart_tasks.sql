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
-- -------------------------------------------------------------------------
-- generate_lead_tasks REMOVED from this file (Phase 178 consolidation).
-- The ONE canonical version now lives in: db/functions/generate_lead_tasks.sql
-- Do NOT re-add it here. To change it, edit the canonical file only (§71).
-- -------------------------------------------------------------------------

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
