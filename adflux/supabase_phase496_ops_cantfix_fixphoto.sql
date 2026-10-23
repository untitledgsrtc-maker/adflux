-- Phase 496 (24 Oct 2026) - "Can't fix, tell the office" + after-fix photo + quote list for the office page.
-- Additive: 3 nullable columns on ops_tickets, 1 new function, ops_office_lookup extended (it lives in
-- supabase_phase495; this file holds its latest body - re-run THIS file, not 495, to keep the quotes list).
ALTER TABLE public.ops_tickets ADD COLUMN IF NOT EXISTS cant_fix_reason text;
ALTER TABLE public.ops_tickets ADD COLUMN IF NOT EXISTS cant_fix_at     timestamptz;
ALTER TABLE public.ops_tickets ADD COLUMN IF NOT EXISTS fix_photo_path  text;

-- The technician (or a head / admin) says the job cannot be done; the office and the heads are told.
CREATE OR REPLACE FUNCTION public.ops_ticket_cant_fix(p_ticket uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid(); v_role text; v_name text;
  t public.ops_tickets%ROWTYPE; v_depot text; r record;
BEGIN
  SELECT role, name INTO v_role, v_name FROM public.users WHERE id = v_uid AND is_active;
  IF v_uid IS NULL OR v_role IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF length(btrim(COALESCE(p_reason,''))) < 3 THEN RAISE EXCEPTION 'write the reason'; END IF;
  SELECT * INTO t FROM public.ops_tickets WHERE id = p_ticket;
  IF NOT FOUND THEN RAISE EXCEPTION 'ticket not found'; END IF;
  IF NOT ( v_role IN ('admin','co_owner','operation_head')
           OR (v_role = 'operation_executive' AND t.assigned_to IS NOT NULL AND t.assigned_to = v_uid) ) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF t.status NOT IN ('open','in_progress') THEN RAISE EXCEPTION 'ticket is already closed'; END IF;

  UPDATE public.ops_tickets
     SET cant_fix_reason = left(btrim(p_reason), 300), cant_fix_at = now(), priority = 'high', updated_at = now()
   WHERE id = p_ticket;

  BEGIN
    SELECT name INTO v_depot FROM public.ops_depots WHERE id = t.depot_id;
    IF public.is_push_allowed_now() THEN
      FOR r IN
        SELECT DISTINCT u.id FROM public.users u
         WHERE u.is_active AND u.id <> v_uid
           AND ( u.role IN ('admin','operation_head') OR u.id = t.created_by )
      LOOP
        PERFORM public.enqueue_push(r.id, 'Cannot fix: ' || COALESCE(v_depot,'station'),
          COALESCE(v_name,'Technician') || ': ' || left(btrim(p_reason), 120), '/ops-command',
          'ops-cantfix-' || p_ticket::text);
      END LOOP;
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;
REVOKE ALL ON FUNCTION public.ops_ticket_cant_fix(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ops_ticket_cant_fix(uuid, text) TO authenticated, service_role;

-- Office page read side: now also running private LED campaigns (for the photo request) and the cant-fix reason.
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
    'quotes', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', q.id, 'no', q.quote_number,
                          'client', COALESCE(NULLIF(q.client_company,''), q.client_name)) ORDER BY q.created_at DESC)
                        FROM (SELECT * FROM public.quotes
                               WHERE status = 'won' AND segment = 'PRIVATE' AND media_type = 'LED_OTHER'
                                 AND (campaign_end_date IS NULL OR campaign_end_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date - 7)
                               ORDER BY created_at DESC LIMIT 80) q), '[]'::jsonb),
    'recent', COALESCE((SELECT jsonb_agg(r ORDER BY (r->>'created_at') DESC) FROM (
                  SELECT jsonb_build_object('id', t.id, 'type', t.type, 'status', t.status, 'created_at', t.created_at,
                         'depot', d.name, 'tech', u.name, 'cant_fix', t.cant_fix_reason) AS r
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

-- VERIFY: SELECT count(*) FROM information_schema.columns WHERE table_name='ops_tickets' AND column_name IN ('cant_fix_reason','cant_fix_at','fix_photo_path');  -- 3
