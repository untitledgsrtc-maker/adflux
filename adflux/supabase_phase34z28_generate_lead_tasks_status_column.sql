-- =====================================================================
-- Phase 34Z.28 — fix generate_lead_tasks body: use status text, not bool
-- 15 May 2026
--
-- WHY
--
-- Phase 34Z.19 reinstated the (p_user_id uuid) signature using the
-- Phase 33T body. That body's DELETE step reads `AND NOT done AND NOT
-- skipped`, but the actual lead_tasks schema (Phase 19) has:
--   status text CHECK (status IN ('open','done','snoozed','skipped'))
-- and no boolean `done` column. PostgREST surfaces:
--   42703 column "done" does not exist
-- on every /work mount.
--
-- WHAT
--
-- Re-create generate_lead_tasks with the correct WHERE — `status NOT
-- IN ('done','skipped')` — and idempotent ON CONFLICT inserts.
-- Body otherwise identical to Phase 34Z.19.
--
-- Idempotent. Re-runnable.
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
  -- Wipe today's prior generations for this user. Phase 34Z.28 —
  -- column is `status` (text), not `done` (bool). Open + snoozed
  -- regenerate; done + skipped survive so the rep's earlier actions
  -- are remembered for the day.
  DELETE FROM public.lead_tasks
   WHERE assigned_to = p_user_id
     AND generated_for = d
     AND status NOT IN ('done', 'skipped');

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

-- ─── VERIFY ──────────────────────────────────────────────────────────
-- Expect:
--   • uses_status      = 1   (new function checks `status NOT IN`)
--   • legacy_NOT_done  = 0   (old boolean reference gone)
SELECT
  (SELECT regexp_count(pg_get_functiondef(p.oid), 'status NOT IN')
     FROM pg_proc p WHERE p.proname = 'generate_lead_tasks')   AS uses_status,
  (SELECT regexp_count(pg_get_functiondef(p.oid), 'NOT done')
     FROM pg_proc p WHERE p.proname = 'generate_lead_tasks')   AS legacy_NOT_done;
