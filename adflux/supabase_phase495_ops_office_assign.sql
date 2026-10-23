-- Phase 495 (24 Oct 2026) - an office person gives a technician a job: fix a screen, or a campaign photo.
-- ("Office work" = a normal Work task, no new SQL: the page calls work_create_task.)
-- ONE new function. Additive: no table / policy / trigger changed. Idempotent.
--   fault  -> ops_tickets type fault, source manual, status in_progress (shows in the technician's In-process tab)
--   photo  -> ops_tickets type photo_request, source sales_request, status open (shows in "Assigned to you")
-- Gate: active admin / co_owner / operation_head / hr / accounts / office_admin. NULL role = refused (section 41).
-- The technician must be an ACTIVE operation_executive. Push to the technician is best-effort (quiet-hours gated).

CREATE OR REPLACE FUNCTION public.ops_office_assign(
  p_kind   text,
  p_tech   uuid,
  p_depot  uuid,
  p_screen uuid DEFAULT NULL,
  p_issue  uuid DEFAULT NULL,
  p_note   text DEFAULT NULL,
  p_quote  uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_name text;
  v_id uuid;
  v_depot_name text;
  v_cause text;
BEGIN
  SELECT role, name INTO v_role, v_name FROM public.users WHERE id = v_uid AND is_active;
  IF v_uid IS NULL OR v_role IS NULL
     OR v_role NOT IN ('admin','co_owner','operation_head','hr','accounts','office_admin') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_kind NOT IN ('fault','photo') THEN RAISE EXCEPTION 'unknown kind'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_tech AND is_active AND role = 'operation_executive') THEN
    RAISE EXCEPTION 'pick an active field technician';
  END IF;
  IF p_depot IS NULL OR NOT EXISTS (SELECT 1 FROM public.ops_depots WHERE id = p_depot AND is_active) THEN
    RAISE EXCEPTION 'pick a station';
  END IF;
  IF p_screen IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.ops_screens WHERE id = p_screen AND depot_id = p_depot) THEN
    RAISE EXCEPTION 'that screen is not at this station';
  END IF;
  SELECT name INTO v_depot_name FROM public.ops_depots WHERE id = p_depot;

  IF p_kind = 'fault' THEN
    SELECT issue_en INTO v_cause FROM public.ops_issue_types WHERE id = p_issue;
    INSERT INTO public.ops_tickets (type, source, status, depot_id, screen_id, issue_type_id, cause, notes, assigned_to, created_by)
    VALUES ('fault', 'manual', 'in_progress', p_depot, p_screen, p_issue, COALESCE(v_cause, 'Given by office'),
            btrim(COALESCE(p_note,'') || ' [Given by ' || COALESCE(v_name,'office') || ']'), p_tech, v_uid)
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.ops_tickets (type, source, status, depot_id, screen_id, quote_id, notes, assigned_to, requested_by, created_by)
    VALUES ('photo_request', 'sales_request', 'open', p_depot, p_screen, p_quote,
            btrim(COALESCE(p_note,'') || ' [Asked by ' || COALESCE(v_name,'office') || ']'), p_tech, v_uid, v_uid)
    RETURNING id INTO v_id;
  END IF;

  BEGIN
    IF public.is_push_allowed_now() THEN
      PERFORM public.enqueue_push(p_tech,
        CASE WHEN p_kind = 'fault' THEN 'New job: fix a screen' ELSE 'New job: campaign photo' END,
        COALESCE(v_depot_name,'Station') || ' - from ' || COALESCE(v_name,'office'),
        '/ops-tickets', 'ops-assign-' || v_id::text);
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.ops_office_assign(text,uuid,uuid,uuid,uuid,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ops_office_assign(text,uuid,uuid,uuid,uuid,text,uuid) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';

-- VERIFY:
-- SELECT proname, prosecdef FROM pg_proc WHERE proname = 'ops_office_assign';   -- expect 1 row, true

-- Read side for the page (office roles cannot read the ops tables under RLS). Same role gate, read-only.
CREATE OR REPLACE FUNCTION public.ops_office_lookup() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role text;
BEGIN
  SELECT role INTO v_role FROM public.users WHERE id = auth.uid() AND is_active;
  IF auth.uid() IS NULL OR v_role IS NULL
     OR v_role NOT IN ('admin','co_owner','operation_head','hr','accounts','office_admin') THEN
    RETURN '{}'::jsonb;
  END IF;
  RETURN jsonb_build_object(
    'techs',  COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name) ORDER BY name)
                        FROM public.users WHERE role = 'operation_executive' AND is_active), '[]'::jsonb),
    'depots', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name) ORDER BY name)
                        FROM public.ops_depots WHERE is_active), '[]'::jsonb),
    'screens',COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'depot_id', depot_id) ORDER BY name)
                        FROM public.ops_screens WHERE is_active AND depot_id IS NOT NULL), '[]'::jsonb),
    'issues', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', issue_en) ORDER BY display_order)
                        FROM public.ops_issue_types WHERE is_active), '[]'::jsonb),
    'recent', COALESCE((SELECT jsonb_agg(r ORDER BY (r->>'created_at') DESC) FROM (
                  SELECT jsonb_build_object('id', t.id, 'type', t.type, 'status', t.status, 'created_at', t.created_at,
                         'depot', d.name, 'tech', u.name) AS r
                    FROM public.ops_tickets t
                    LEFT JOIN public.ops_depots d ON d.id = t.depot_id
                    LEFT JOIN public.users u ON u.id = t.assigned_to
                   WHERE t.created_by = auth.uid() AND (t.notes ILIKE '%[Given by%' OR t.notes ILIKE '%[Asked by%')
                   ORDER BY t.created_at DESC LIMIT 10) x), '[]'::jsonb)
  );
END $$;
REVOKE ALL ON FUNCTION public.ops_office_lookup() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ops_office_lookup() TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
