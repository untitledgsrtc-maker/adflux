-- =====================================================================
-- team_leaderboard_month(p_from, p_to)   [CANONICAL - section 71/72, Phase 363]
-- ONE definition of the team leaderboard for the admin dashboard AND both
-- sales dashboards. Owner rule (13 Oct 2026): rank on quotes SENT vs quotes
-- WON AND PAID in the period. No forecast / proposed incentive.
--   sent      = quotes created in [p_from,p_to), status <> 'draft'
--   won_paid  = status='won', won_at in [p_from,p_to), >=1 APPROVED payment
--   won_unpaid= status='won', won_at in the period, NO approved payment (info only)
-- Only ACTIVE sales + telecaller reps (agency partners and leavers are not on the board).
-- SECURITY DEFINER (RLS would otherwise show a rep only their own quotes); returns
-- per-rep AGGREGATES only. A govt partner (co_owner) sees GOVERNMENT-segment quotes only.
-- Fail-closed: no login / inactive caller -> no rows. Read-only; changes no pay.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.team_leaderboard_month(p_from timestamptz, p_to timestamptz)
RETURNS TABLE(
  user_id uuid, name text, role text,
  sent_count bigint, sent_amount numeric,
  won_paid_count bigint, won_paid_amount numeric,
  won_unpaid_count bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid  uuid := auth.uid();
  v_role text;
  v_team text;
  v_act  boolean;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  SELECT u.role, u.team_role, u.is_active INTO v_role, v_team, v_act
    FROM public.users u WHERE u.id = v_uid;
  IF v_role IS NULL OR COALESCE(v_act,false) = false THEN RETURN; END IF;
  -- agency partners do not see the team board
  IF v_role = 'agency' THEN RETURN; END IF;

  RETURN QUERY
  SELECT u.id, u.name::text, u.role::text,
    COALESCE((SELECT count(*) FROM public.quotes q
               WHERE q.created_by = u.id AND q.status <> 'draft'
                 AND q.created_at >= p_from AND q.created_at < p_to
                 AND (v_team IS DISTINCT FROM 'government_partner' OR q.segment = 'GOVERNMENT')),0)::bigint,
    COALESCE((SELECT sum(q.total_amount) FROM public.quotes q
               WHERE q.created_by = u.id AND q.status <> 'draft'
                 AND q.created_at >= p_from AND q.created_at < p_to
                 AND (v_team IS DISTINCT FROM 'government_partner' OR q.segment = 'GOVERNMENT')),0)::numeric,
    COALESCE((SELECT count(*) FROM public.quotes q
               WHERE q.created_by = u.id AND q.status = 'won'
                 AND q.won_at >= p_from AND q.won_at < p_to
                 AND EXISTS (SELECT 1 FROM public.payments p WHERE p.quote_id = q.id
                               AND p.approval_status = 'approved' AND COALESCE(p.amount_received,0) > 0)
                 AND (v_team IS DISTINCT FROM 'government_partner' OR q.segment = 'GOVERNMENT')),0)::bigint,
    COALESCE((SELECT sum(q.total_amount) FROM public.quotes q
               WHERE q.created_by = u.id AND q.status = 'won'
                 AND q.won_at >= p_from AND q.won_at < p_to
                 AND EXISTS (SELECT 1 FROM public.payments p WHERE p.quote_id = q.id
                               AND p.approval_status = 'approved' AND COALESCE(p.amount_received,0) > 0)
                 AND (v_team IS DISTINCT FROM 'government_partner' OR q.segment = 'GOVERNMENT')),0)::numeric,
    COALESCE((SELECT count(*) FROM public.quotes q
               WHERE q.created_by = u.id AND q.status = 'won'
                 AND q.won_at >= p_from AND q.won_at < p_to
                 AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.quote_id = q.id
                               AND p.approval_status = 'approved' AND COALESCE(p.amount_received,0) > 0)
                 AND (v_team IS DISTINCT FROM 'government_partner' OR q.segment = 'GOVERNMENT')),0)::bigint
  FROM public.users u
  WHERE u.role IN ('sales','telecaller') AND u.is_active = true;
END
$fn$;

REVOKE ALL ON FUNCTION public.team_leaderboard_month(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_leaderboard_month(timestamptz, timestamptz) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';

-- VERIFY (tripwire - every value must be TRUE; a FALSE means a contract was lost):
-- SELECT pg_get_functiondef(p.oid) LIKE '%approval_status = ''approved''%'  AS counts_only_paid,
--        pg_get_functiondef(p.oid) LIKE '%government_partner%'              AS govt_partner_scoped,
--        pg_get_functiondef(p.oid) LIKE '%is_active = true%'                AS active_only,
--        pg_get_functiondef(p.oid) LIKE '%v_role = ''agency''%'             AS agency_excluded,
--        p.prosecdef                                                        AS is_definer,
--        NOT has_function_privilege('anon', p.oid, 'EXECUTE')               AS anon_locked
--   FROM pg_proc p WHERE p.proname='team_leaderboard_month';
-- SELECT proname, prosecdef FROM pg_proc WHERE proname='team_leaderboard_month';  -- 1 row, t
-- SELECT * FROM team_leaderboard_month('2026-10-01+05:30','2026-11-01+05:30') ORDER BY won_paid_amount DESC;  (as a logged-in user)
