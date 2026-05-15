-- =====================================================================
-- Phase 34Z.42 — drop l.last_outcome reference from generate_lead_tasks
-- 15 May 2026
--
-- WHY
--
-- Console 400 on /work:
--   POST /rest/v1/rpc/generate_lead_tasks 400
--   42703 column "l.last_outcome" does not exist
--
-- Phase 33T's body had:
--   'Hot lead — ' || COALESCE(NULLIF(l.last_outcome, ''), 'follow up')
--
-- but leads.last_outcome was never a column. It was probably copy-paste
-- from an earlier draft. Phase 34Z.19 + 34Z.28 carried the bug forward.
--
-- WHAT
--
-- Re-create generate_lead_tasks with the Hot-rule reason simplified to
-- a static string. Everything else identical to Phase 34Z.28.
-- =====================================================================

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
  DELETE FROM public.lead_tasks
   WHERE assigned_to = p_user_id
     AND generated_for = d
     AND status NOT IN ('done', 'skipped');

  -- Rule 1: hot — heat='hot' leads not contacted in 24h.
  -- Phase 34Z.42 — last_outcome reference dropped (column doesn't
  -- exist on leads). Reason is a static string.
  INSERT INTO public.lead_tasks
    (lead_id, assigned_to, kind, priority, reason, generated_for)
  SELECT
    l.id, l.assigned_to, 'hot', 10,
    'Hot lead — follow up',
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

  -- Rule 3: follow_up_due — earliest pending follow_up on/before today.
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

  RETURN inserted;
END;
$$;

NOTIFY pgrst, 'reload schema';

-- VERIFY (expect 0)
SELECT regexp_count(pg_get_functiondef(p.oid), 'last_outcome') AS bad_refs
  FROM pg_proc p WHERE p.proname = 'generate_lead_tasks';
