-- =====================================================================
-- Phase 34Z.19 — switch generate_lead_tasks signature to (p_user_id uuid)
-- 14 May 2026
--
-- WHY
--
-- Phase 33T (12 May 2026) rewrote `generate_lead_tasks` from the
-- original Phase 19 `(p_date date)` signature to `(p_user_id uuid)`.
-- Owner reported (14 May 2026) production console still 404'ing on
-- /work load:
--   POST /rest/v1/rpc/generate_lead_tasks 404 (Not Found)
--   "Could not find the function public.generate_lead_tasks(p_user_id)
--    in the schema cache. Perhaps you meant ... (p_date)"
--
-- Diagnosis: Phase 33T was never pasted into Supabase Studio for the
-- staging DB. Only the Phase 19 (p_date) function exists. PostgREST
-- caches the old signature; client now calls with p_user_id; PostgREST
-- has no overload that matches → 404.
--
-- WHAT THIS DOES
--
-- 1. DROP every overload of generate_lead_tasks. Both (p_date date)
--    and any partial/half-applied (p_user_id uuid) variant get
--    cleared. Cascade so dependent triggers (none currently) survive.
-- 2. Re-create the Phase 33T body verbatim with the (p_user_id uuid)
--    signature.
-- 3. Force a PostgREST schema cache reload via NOTIFY pgrst so the
--    new signature is visible to the REST API immediately.
--
-- Idempotent. Re-runnable safely.
-- =====================================================================

-- 1. Drop every overload of the function (date and uuid signatures).
DROP FUNCTION IF EXISTS public.generate_lead_tasks(date)  CASCADE;
DROP FUNCTION IF EXISTS public.generate_lead_tasks(uuid)  CASCADE;

-- 2. Recreate with the (p_user_id uuid) signature from Phase 33T.
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

-- 3. Reload PostgREST schema cache so REST API picks up new signature.
NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────────
-- After running:
--   * has_uuid_signature  = 1   (new function exists)
--   * has_date_signature  = 0   (old overload dropped)
SELECT
  (SELECT count(*) FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'generate_lead_tasks'
      AND pg_get_function_identity_arguments(p.oid) = 'p_user_id uuid') AS has_uuid_signature,
  (SELECT count(*) FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'generate_lead_tasks'
      AND pg_get_function_identity_arguments(p.oid) = 'p_date date') AS has_date_signature;
