-- ============================================================================
-- db/functions/team_all_quotes.sql - CANONICAL HOME (section 71: one definition)
-- ============================================================================
-- Team viewer / admin read of every quote, same shape as useQuotes' SELECT
-- (quote row + quote_cities / payments / follow_ups nested).
-- History: phase 247.3 (created), 563 (non-admin = PRIVATE only).
-- Phase 628 (19-11-2026): follow_ups embed gains done_at (Quotes list shows the
--   date the last follow-up was done). quotes.lost_at rides in via to_jsonb(q).
-- ============================================================================
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
                'follow_up_date', f.follow_up_date, 'is_done', f.is_done, 'done_at', f.done_at))
                FROM public.follow_ups f WHERE f.quote_id = q.id), '[]'::jsonb)
           ) AS row_json
    FROM public.quotes q
    WHERE (NOT v_priv OR q.segment = 'PRIVATE')
    ORDER BY q.created_at DESC
    LIMIT 20000
  ) s;

  RETURN v_out;
END $function$;

NOTIFY pgrst, 'reload schema';

-- VERIFY: SELECT pg_get_functiondef('public.team_all_quotes()'::regprocedure) LIKE '%done_at%';  -- t
