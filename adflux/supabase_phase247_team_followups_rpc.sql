-- supabase_phase247_team_followups_rpc.sql
--
-- Phase 247 — the sales "team viewer" (Jayna, can_view_team_dashboard=true) sees
-- the WHOLE team's open follow-ups, READ-ONLY. Owner request 16 Jul.
--
-- WHY AN RPC, NOT A BROAD RLS GRANT: a broad `FOR SELECT` on the tables would
-- (a) silently change the FROZEN LeadsV2/QuotesV2 pages for her with dangling
-- edit buttons (§45/§84), and (b) transitively hand her WRITE access to any
-- rep's lead_activities via the visibility-gated `lead_activities_via_lead`
-- FOR ALL policy — touching the score/incentive path. So team visibility goes
-- through a gated SECURITY DEFINER RPC (the §193/§194 pattern), leaving her base
-- RLS own-only. Her /work + /telecaller queues stay hers untouched.
--
-- team_all_followups() = a clone of team_rep_followups(§194) WITHOUT the per-rep
-- filter (all reps) + the owner name so she can see whose follow-up it is. Gated
-- on is_team_viewer() OR admin; a plain rep gets '{}'. Read-only (SELECT only).
-- (Leads + quotes team views follow in the same pattern — Phase 247.2/.3.)

CREATE OR REPLACE FUNCTION public.team_all_followups()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_out    jsonb;
  v_week_end date := ((now() AT TIME ZONE 'Asia/Kolkata')::date + 7);
BEGIN
  IF NOT (public.is_team_viewer()
          OR COALESCE(public.get_my_role() IN ('admin', 'co_owner'), false)) THEN
    RETURN '{}'::jsonb;
  END IF;

  SELECT jsonb_build_object(
    'follow_ups', COALESCE((SELECT jsonb_agg(to_jsonb(f)) FROM (
      SELECT fu.id, fu.follow_up_date, fu.follow_up_time, fu.note, fu.is_done,
             fu.auto_generated, fu.cadence_type, fu.sequence, fu.quote_id, fu.lead_id,
             fu.assigned_to,
             (SELECT name FROM public.users WHERE id = fu.assigned_to) AS owner_name,
             (SELECT jsonb_build_object(
                'id', q.id, 'client_name', q.client_name, 'client_company', q.client_company,
                'client_phone', q.client_phone, 'segment', q.segment,
                'total_amount', q.total_amount, 'status', q.status,
                'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                    'amount_received', p.amount_received, 'approval_status', p.approval_status))
                  FROM public.payments p WHERE p.quote_id = q.id), '[]'::jsonb))
              FROM public.quotes q WHERE q.id = fu.quote_id) AS quote,
             (SELECT jsonb_build_object('id', l.id, 'name', l.name, 'company', l.company,
                'phone', l.phone, 'segment', l.segment, 'stage', l.stage)
              FROM public.leads l WHERE l.id = fu.lead_id) AS lead
      FROM public.follow_ups fu
      WHERE fu.is_done = false
      ORDER BY fu.follow_up_date ASC, fu.follow_up_time ASC NULLS LAST
      LIMIT 2000
    ) f), '[]'::jsonb),
    'nurture_leads', COALESCE((SELECT jsonb_agg(to_jsonb(n)) FROM (
      SELECT id, name, company, phone, email, stage, revisit_date, segment, assigned_to
      FROM public.leads
      WHERE stage = 'Nurture'
        AND revisit_date IS NOT NULL AND revisit_date <= v_week_end
      ORDER BY revisit_date ASC LIMIT 100
    ) n), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END $function$;

GRANT EXECUTE ON FUNCTION public.team_all_followups() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY:
--   SELECT to_regprocedure('public.team_all_followups()') IS NOT NULL;   -- t
--   -- As a plain rep (no flag): SELECT public.team_all_followups();  → '{}'
--   -- As Jayna (can_view_team_dashboard=true) / admin: real {follow_ups, nurture_leads}
