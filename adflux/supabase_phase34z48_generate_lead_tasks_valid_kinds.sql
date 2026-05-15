-- =====================================================================
-- Phase 34Z.48 — generate_lead_tasks kinds must match lead_tasks_kind_chk
-- 15 May 2026
--
-- WHY
--
-- Console 400 on /work:
--   POST /rest/v1/rpc/generate_lead_tasks 400
--   23514 new row for relation "lead_tasks" violates check constraint
--   "lead_tasks_kind_chk"
--
-- Phase 34Z.42 inserted kind='hot' and kind='new_lead', but the
-- schema (Phase 19) constraint only accepts:
--   ('sla_breach','follow_up_due','hot_idle','qualified_no_quote',
--    'nurture_revisit','new_untouched')
--
-- WHAT
--
-- Re-create generate_lead_tasks with valid kinds:
--   Rule 1: 'hot'      → 'hot_idle'
--   Rule 2: 'new_lead' → 'new_untouched'
--   Rule 3: 'follow_up_due' (already valid)
-- Body otherwise identical to Phase 34Z.42.
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

  -- Rule 1: hot_idle — heat='hot' leads not contacted in 24h.
  INSERT INTO public.lead_tasks
    (lead_id, assigned_to, kind, priority, reason, generated_for)
  SELECT
    l.id, l.assigned_to, 'hot_idle', 10,
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

  -- Rule 2: new_untouched — new leads with no contact, > 48h old.
  INSERT INTO public.lead_tasks
    (lead_id, assigned_to, kind, priority, reason, generated_for)
  SELECT
    l.id, l.assigned_to, 'new_untouched', 20,
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

-- VERIFY: expect 0 invalid kind refs.
SELECT
  (SELECT regexp_count(pg_get_functiondef(p.oid), '''hot''[^_]'))
    + (SELECT regexp_count(pg_get_functiondef(p.oid), '''new_lead'''))
  AS bad_kind_refs
  FROM pg_proc p WHERE p.proname = 'generate_lead_tasks';
