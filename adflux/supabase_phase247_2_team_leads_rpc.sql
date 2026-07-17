-- supabase_phase247_2_team_leads_rpc.sql
--
-- Phase 247.2 — the sales "team viewer" (Jayna) sees ALL reps' leads, READ-ONLY.
-- Same gated-RPC pattern as team_all_followups (§116) — NO broad table grant, so
-- her base RLS stays own-only (/work + /telecaller untouched) and there is no
-- lead_activities write-escalation.
--
-- team_all_leads() returns a jsonb ARRAY of every lead, shaped to match what
-- useLeads() SELECTs: the full lead row PLUS the `assigned` + `telecaller` nested
-- user objects (id/name/team_role[/city]) LeadsV2 renders. Gated
-- is_team_viewer() OR admin (else '[]'); read-only (SELECT only). Ordered
-- newest-first, hard-capped at 20000 (matches the LeadsV2 client backstop).

CREATE OR REPLACE FUNCTION public.team_all_leads()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_out jsonb;
BEGIN
  IF NOT (public.is_team_viewer()
          OR COALESCE(public.get_my_role() IN ('admin', 'co_owner'), false)) THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(row_json), '[]'::jsonb) INTO v_out
  FROM (
    SELECT to_jsonb(l) || jsonb_build_object(
             'assigned', (SELECT jsonb_build_object('id', u.id, 'name', u.name,
                            'team_role', u.team_role, 'city', u.city)
                          FROM public.users u WHERE u.id = l.assigned_to),
             'telecaller', (SELECT jsonb_build_object('id', u.id, 'name', u.name,
                              'team_role', u.team_role)
                            FROM public.users u WHERE u.id = l.telecaller_id)
           ) AS row_json
    FROM public.leads l
    ORDER BY l.created_at DESC
    LIMIT 20000
  ) s;

  RETURN v_out;
END $function$;

GRANT EXECUTE ON FUNCTION public.team_all_leads() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY:
--   SELECT to_regprocedure('public.team_all_leads()') IS NOT NULL;   -- t
--   -- plain rep → '[]';  Jayna / admin → array of all leads with assigned/telecaller.
