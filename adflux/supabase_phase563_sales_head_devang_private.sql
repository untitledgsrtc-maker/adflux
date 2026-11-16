-- =====================================================================
-- Phase 563 — Devang = Sales Head, PRIVATE data only (2026-11-16)
-- =====================================================================
-- Owner: Devang (sales head) must see ALL sales + telecaller reps' leads,
-- quotes, follow-ups and payment status — PRIVATE segment only.
-- Uses the EXISTING Sales Head grant (P1, supabase_sales_head_manager_p1.sql):
--   can_view_team_dashboard + is_sales_head. No manager_id chain needed.
-- ADDITIVE / admin-unchanged:
--   (1) grant the two flags to Devang only
--   (2) team_all_leads / team_all_quotes / team_all_followups: a NON-admin
--       viewer is filtered to segment='PRIVATE'; admin path byte-equivalent
--   (3) quotes_sales_head_read / _edit + qc_sales_head_read: PRIVATE only, so a
--       direct table read cannot leak Government quotes either
-- NOT touched: team_dashboard_bundle (live cockpit; its count/Rs tiles still
-- include Government totals — separate decision), payments table (payment
-- status already arrives inside team_all_quotes; client-payment writes stay
-- admin-only per spec section 1).
-- =====================================================================

UPDATE public.users
   SET can_view_team_dashboard = true, is_sales_head = true
 WHERE team_role = 'sales_manager' AND is_active = true AND name = 'Devang';

CREATE OR REPLACE FUNCTION public.team_all_leads()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_out jsonb;
  -- Phase 563: a non-admin viewer (Sales Head) sees PRIVATE data only. Admin = unchanged.
  v_priv boolean := NOT COALESCE(public.get_my_role() = 'admin', false);
BEGIN
  IF NOT (public.is_team_viewer()
          OR COALESCE(public.get_my_role() = 'admin', false)) THEN   -- admin only, NOT co_owner (Vishal is govt-scoped, §42)
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
    WHERE (NOT v_priv OR l.segment = 'PRIVATE')
    ORDER BY l.created_at DESC
    LIMIT 20000
  ) s;

  RETURN v_out;
END $function$;


CREATE OR REPLACE FUNCTION public.team_all_quotes()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_out jsonb;
  -- Phase 563: a non-admin viewer (Sales Head) sees PRIVATE data only. Admin = unchanged.
  v_priv boolean := NOT COALESCE(public.get_my_role() = 'admin', false);
BEGIN
  IF NOT (public.is_team_viewer()
          OR COALESCE(public.get_my_role() = 'admin', false)) THEN   -- admin only, NOT co_owner (Vishal is govt-scoped, §42)
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(row_json), '[]'::jsonb) INTO v_out
  FROM (
    SELECT to_jsonb(q) || jsonb_build_object(
             'quote_cities', COALESCE((SELECT jsonb_agg(to_jsonb(qc))
                FROM public.quote_cities qc WHERE qc.quote_id = q.id), '[]'::jsonb),
             'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'amount_received', p.amount_received, 'approval_status', p.approval_status))
                FROM public.payments p WHERE p.quote_id = q.id), '[]'::jsonb),
             'follow_ups', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'follow_up_date', f.follow_up_date, 'is_done', f.is_done))
                FROM public.follow_ups f WHERE f.quote_id = q.id), '[]'::jsonb)
           ) AS row_json
    FROM public.quotes q
    WHERE (NOT v_priv OR q.segment = 'PRIVATE')
    ORDER BY q.created_at DESC
    LIMIT 20000
  ) s;

  RETURN v_out;
END $function$;


CREATE OR REPLACE FUNCTION public.team_all_followups()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_out    jsonb;
  -- Phase 563: a non-admin viewer (Sales Head) sees PRIVATE data only. Admin = unchanged.
  v_priv boolean := NOT COALESCE(public.get_my_role() = 'admin', false);
  v_week_end date := ((now() AT TIME ZONE 'Asia/Kolkata')::date + 7);
BEGIN
  IF NOT (public.is_team_viewer()
          OR COALESCE(public.get_my_role() = 'admin', false)) THEN   -- admin only, NOT co_owner (Vishal is govt-scoped, §42)
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
        AND (NOT v_priv OR COALESCE((SELECT l2.segment FROM public.leads l2 WHERE l2.id = fu.lead_id),
                                    (SELECT q2.segment FROM public.quotes q2 WHERE q2.id = fu.quote_id)) = 'PRIVATE')
      ORDER BY fu.follow_up_date ASC, fu.follow_up_time ASC NULLS LAST
      LIMIT 2000
    ) f), '[]'::jsonb),
    'nurture_leads', COALESCE((SELECT jsonb_agg(to_jsonb(n)) FROM (
      SELECT id, name, company, phone, email, stage, revisit_date, segment, assigned_to
      FROM public.leads
      WHERE stage = 'Nurture'
        AND (NOT v_priv OR segment = 'PRIVATE')
        AND revisit_date IS NOT NULL AND revisit_date <= v_week_end
      ORDER BY revisit_date ASC LIMIT 100
    ) n), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END $function$;

DROP POLICY IF EXISTS quotes_sales_head_read ON public.quotes;
CREATE POLICY quotes_sales_head_read ON public.quotes
  FOR SELECT USING (public.is_sales_head() AND segment = 'PRIVATE');

DROP POLICY IF EXISTS quotes_sales_head_edit ON public.quotes;
CREATE POLICY quotes_sales_head_edit ON public.quotes
  FOR UPDATE
  USING (public.is_sales_head() AND segment = 'PRIVATE' AND status <> 'won')
  WITH CHECK (public.is_sales_head() AND segment = 'PRIVATE' AND status <> 'won'
              AND public.sh_quote_unchanged(id, created_by, segment, media_type, lead_id, quote_number));

DROP POLICY IF EXISTS qc_sales_head_read ON public.quote_cities;
CREATE POLICY qc_sales_head_read ON public.quote_cities
  FOR SELECT USING (public.is_sales_head() AND EXISTS (
    SELECT 1 FROM public.quotes q WHERE q.id = quote_cities.quote_id AND q.segment = 'PRIVATE'));

NOTIFY pgrst, 'reload schema';

-- VERIFY: Devang holds both flags; 3 RPCs carry the private filter; 3 policies PRIVATE-gated.
SELECT
  (SELECT is_sales_head AND can_view_team_dashboard FROM public.users WHERE name='Devang' AND team_role='sales_manager' AND is_active) AS devang_granted,
  (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('team_all_leads','team_all_quotes','team_all_followups') AND prosrc LIKE '%v_priv%') AS rpcs_filtered,
  (SELECT count(*) FROM pg_policies WHERE policyname IN ('quotes_sales_head_read','quotes_sales_head_edit','qc_sales_head_read') AND (qual LIKE '%PRIVATE%')) AS policies_private;
