-- supabase_phase247_3_team_quotes_rpc.sql
--
-- Phase 247.3 — the sales "team viewer" (Jayna) sees ALL reps' quotes, READ-ONLY
-- (deal amounts included — owner-approved). Same gated-RPC pattern as
-- team_all_followups / team_all_leads (§116) — NO broad table grant.
--
-- team_all_quotes() returns a jsonb ARRAY of every quote, shaped like the
-- useQuotes() SELECT: the full quote row PLUS nested quote_cities / payments /
-- follow_ups. Gated is_team_viewer() OR admin (else '[]'); read-only (SELECT
-- only). Ordered newest-first, LIMIT 20000.

CREATE OR REPLACE FUNCTION public.team_all_quotes()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_out jsonb;
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
    ORDER BY q.created_at DESC
    LIMIT 20000
  ) s;

  RETURN v_out;
END $function$;

GRANT EXECUTE ON FUNCTION public.team_all_quotes() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY:
--   SELECT to_regprocedure('public.team_all_quotes()') IS NOT NULL;   -- t
--   -- plain rep → '[]';  Jayna / admin → array of all quotes with cities/payments/follow_ups.
