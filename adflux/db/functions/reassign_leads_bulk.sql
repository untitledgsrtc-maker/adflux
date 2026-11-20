-- ============================================================================
-- db/functions/reassign_leads_bulk.sql - CANONICAL HOME (section 71). Captured from live
-- 20-11-2026 + Phase 636: bulk mode (selection > 20 leads, sent by the app in batches of 50):
-- per-lead pushes off, the new follow-ups spread over working days at the owner's daily call
-- target, ONE summary push on the last batch. The old 3-arg signature is DROPPED below
-- (a 5-arg CREATE OR REPLACE would add an overload, not replace it).
-- ============================================================================
DROP FUNCTION IF EXISTS public.reassign_leads_bulk(uuid[], uuid, text);
CREATE OR REPLACE FUNCTION public.reassign_leads_bulk(p_lead_ids uuid[], p_new_owner uuid, p_reason text DEFAULT NULL::text, p_bulk_total integer DEFAULT NULL::integer, p_last_batch boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_caller       uuid := auth.uid();
  v_caller_role  text;
  v_caller_name  text;
  v_caller_team  text;
  v_today_count  int;
  v_today_ist    date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_total        int;
  v_succeeded    int := 0;
  v_failed       int := 0;
  v_failures     jsonb := '[]'::jsonb;
  v_lead_id      uuid;
  v_result       jsonb;
  v_remaining    int;
  v_can_attempt  int;
  -- Phase 636 — bulk mode (whole selection > 20 leads, sent in batches by the app).
  v_bulk         boolean := COALESCE(p_bulk_total, array_length(p_lead_ids, 1)) > 20;
  v_cap          int;
  v_day          date;
  v_done         uuid[] := '{}';
  r              record;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is NULL — must be signed in'
      USING ERRCODE = '42501';
  END IF;

  IF p_lead_ids IS NULL OR array_length(p_lead_ids, 1) = 0 THEN
    RAISE EXCEPTION 'no leads provided'
      USING ERRCODE = '22023';
  END IF;

  -- Phase 100.A amendment W5 + W11 — fetch team_role too.
  SELECT role, name, team_role
    INTO v_caller_role, v_caller_name, v_caller_team
    FROM public.users
   WHERE id = v_caller;

  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'caller has no role on file'
      USING ERRCODE = '42501';
  END IF;

  v_total := array_length(p_lead_ids, 1);

  -- Q3 — bulk cap 20 for non-admin.
  IF v_caller_role NOT IN ('admin', 'co_owner') AND v_total > 20 THEN
    RAISE EXCEPTION 'bulk cap 20 reached (% requested)', v_total
      USING ERRCODE = '42501';
  END IF;

  -- Q2 — daily reassign cap REMOVED 2026-07-15 (owner directive: any
  -- number of reassigns/day). Attempt every lead in the batch; the
  -- 20-per-call bulk cap (Q3, above) stays as a fat-finger guard.
  -- Every reassign is still audited inside _apply.
  v_can_attempt := v_total;
  -- Phase 636: bulk mode is an admin / co_owner tool only (a rep's call is capped at 20 above).
  IF v_caller_role NOT IN ('admin', 'co_owner') THEN v_bulk := false; END IF;
  IF v_bulk THEN PERFORM set_config('app.bulk_reassign', 'on', true); END IF;   -- Phase 636: per-lead pushes off for this call only

  -- Iterate the leads. The first v_can_attempt entries hit
  -- _apply; the rest (if any) are recorded as over-limit failures.
  FOR i IN 1..v_total LOOP
    v_lead_id := p_lead_ids[i];
    IF i <= v_can_attempt THEN
      v_result := public._reassign_lead_apply(
        v_caller, v_caller_role, v_caller_name, v_caller_team,
        v_lead_id, p_new_owner, p_reason
      );
      IF (v_result->>'ok')::boolean THEN
        v_succeeded := v_succeeded + 1;
      ELSE
        v_failed := v_failed + 1;
        v_failures := v_failures || jsonb_build_object(
          'lead_id', v_lead_id,
          'reason',  v_result->>'reason'
        );
      END IF;
    ELSE
      v_failed := v_failed + 1;
      v_failures := v_failures || jsonb_build_object(
        'lead_id', v_lead_id,
        'reason',  'daily reassign limit reached during this batch'
      );
    END IF;
  END LOOP;

  -- Phase 636 — spread the "due today" follow-ups _reassign_lead_apply just created over
  -- working days, at most v_cap a day for the new owner (counting what they already have),
  -- oldest leads first. Then ONE summary push on the last batch.
  IF v_bulk AND v_succeeded > 0 THEN
    SELECT COALESCE(
             (SELECT NULLIF(t.min_calls, 0) FROM public.daily_targets t
               WHERE t.user_id = p_new_owner AND t.effective_to IS NULL ORDER BY t.effective_from DESC LIMIT 1),
             CASE WHEN (SELECT role FROM public.users WHERE id = p_new_owner) = 'telecaller' THEN 50 ELSE 20 END)
      INTO v_cap;
    FOR r IN
      SELECT f.id FROM public.follow_ups f JOIN public.leads l ON l.id = f.lead_id
       WHERE f.lead_id = ANY (p_lead_ids) AND f.assigned_to = p_new_owner AND f.is_done = false
         AND f.created_at >= now() AND f.follow_up_date <= v_today_ist
       ORDER BY l.created_at
    LOOP
      v_day := v_today_ist;
      FOR k IN 1..366 LOOP
        IF EXTRACT(DOW FROM v_day) <> 0
           AND (SELECT count(*) FROM public.follow_ups x
                 WHERE x.assigned_to = p_new_owner AND x.is_done = false AND x.follow_up_date = v_day
                   AND (x.created_at < now() OR x.id = ANY (v_done))) < v_cap THEN
          EXIT;
        END IF;
        v_day := v_day + 1;
      END LOOP;
      UPDATE public.follow_ups SET follow_up_date = v_day WHERE id = r.id;
      v_done := v_done || r.id;
    END LOOP;
  END IF;
  -- The ONE summary push goes on the last batch even if that batch moved nothing (earlier ones did).
  IF v_bulk AND p_last_batch AND public.is_push_allowed_now() THEN
    PERFORM public.enqueue_push(
      p_new_owner,
      COALESCE(p_bulk_total, v_total) || ' leads assigned to you',
      'Follow-ups are spread over your next working days.',
      '/follow-ups',
      'bulk-reassign-' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYYMMDDHH24MI'));
  END IF;

  RETURN jsonb_build_object(
    'total',     v_total,
    'succeeded', v_succeeded,
    'failed',    v_failed,
    'failures',  v_failures
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.reassign_leads_bulk(uuid[], uuid, text, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reassign_leads_bulk(uuid[], uuid, text, integer, boolean) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
-- VERIFY: SELECT count(*) FROM pg_proc WHERE proname = 'reassign_leads_bulk';  -- 1
