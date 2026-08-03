-- =====================================================================
-- FINANCE MODULE — Phase 3: P&L aggregation RPC (server-side, §66)
-- 2026-08-03 · spec docs/FINANCE_MODULE_SPEC.md · needs P1 + P2 run first.
--
-- finance_pnl_summary(from, to, segment) → jsonb dashboard bundle.
-- Income = CRM approved payments (owner decision) per quote segment.
-- Cost   = finance_transactions bucket ∈ (direct_cost, common_expense).
-- Excluded (shown separate): internal_transfer/loan/drawings/investment/asset/tax.
-- SECURITY DEFINER + role gate (§193 pattern): admin/accounts = full both segments;
-- co_owner + government_partner (Vishal) = FORCED to GOVERNMENT only; else '{}'.
-- Fails closed on NULL role (COALESCE). Aggregates server-side so a >1000-row
-- ledger never caps.  Idempotent (CREATE OR REPLACE).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.finance_pnl_summary(
  p_from    date DEFAULT NULL,
  p_to      date DEFAULT NULL,
  p_segment text DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_role text := public.get_my_role();
  v_gp   boolean := EXISTS (SELECT 1 FROM public.users u
                             WHERE u.id = auth.uid() AND u.team_role = 'government_partner');
  v_seg  text := p_segment;
  ig numeric; ip numeric; itot numeric;
  dg numeric; dp numeric; dtot numeric;
  ctot numeric;
  v_out jsonb;
BEGIN
  -- access gate (fail closed on NULL role)
  IF COALESCE(v_role,'') NOT IN ('admin','accounts') THEN
    IF v_gp THEN v_seg := 'GOVERNMENT';         -- Vishal: GOVERNMENT-only P&L (§42/§152)
    ELSE RETURN '{}'::jsonb; END IF;
  END IF;

  -- CRM income = approved payments, split by quote segment
  SELECT COALESCE(SUM(p.amount_received) FILTER (WHERE q.segment='GOVERNMENT'),0),
         COALESCE(SUM(p.amount_received) FILTER (WHERE q.segment='PRIVATE'),0)
    INTO ig, ip
    FROM public.payments p JOIN public.quotes q ON q.id = p.quote_id
   WHERE p.approval_status = 'approved'
     AND (p_from IS NULL OR p.payment_date >= p_from)
     AND (p_to   IS NULL OR p.payment_date <= p_to);
  IF v_seg = 'GOVERNMENT' THEN ip := 0; ELSIF v_seg = 'PRIVATE' THEN ig := 0; END IF;
  itot := ig + ip;

  -- direct cost by segment
  SELECT COALESCE(SUM(amount) FILTER (WHERE segment='GOVERNMENT'),0),
         COALESCE(SUM(amount) FILTER (WHERE segment='PRIVATE'),0)
    INTO dg, dp
    FROM public.finance_transactions
   WHERE bucket = 'direct_cost'
     AND (p_from IS NULL OR txn_date >= p_from) AND (p_to IS NULL OR txn_date <= p_to)
     AND (v_seg IS NULL OR segment = v_seg);
  dtot := dg + dp;

  -- common expense pool
  SELECT COALESCE(SUM(amount),0) INTO ctot
    FROM public.finance_transactions
   WHERE bucket = 'common_expense'
     AND (p_from IS NULL OR txn_date >= p_from) AND (p_to IS NULL OR txn_date <= p_to);

  v_out := jsonb_build_object(
    'income', itot, 'income_gov', ig, 'income_pvt', ip,
    'direct_cost', dtot, 'common_expense', ctot,
    'operating_profit', itot - dtot - ctot,
    'margin_pct', CASE WHEN itot > 0 THEN round((itot - dtot - ctot) / itot * 100, 1) ELSE 0 END,
    'by_segment', jsonb_build_array(
      jsonb_build_object('segment','GOVERNMENT','company','Untitled Advertising',
        'income', ig, 'direct', dg,
        'common', CASE WHEN itot > 0 THEN round(ctot * ig / itot) ELSE 0 END,
        'net', ig - dg - CASE WHEN itot > 0 THEN round(ctot * ig / itot) ELSE 0 END),
      jsonb_build_object('segment','PRIVATE','company','Untitled Adflux Pvt Ltd',
        'income', ip, 'direct', dp,
        'common', CASE WHEN itot > 0 THEN round(ctot * ip / itot) ELSE 0 END,
        'net', ip - dp - CASE WHEN itot > 0 THEN round(ctot * ip / itot) ELSE 0 END)
    ),
    'by_head', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('head', COALESCE(h.name,'Unclassified'), 'amount', s.amt) ORDER BY s.amt DESC)
        FROM (SELECT expense_head_id, SUM(amount) amt
                FROM public.finance_transactions
               WHERE bucket IN ('direct_cost','common_expense')
                 AND (p_from IS NULL OR txn_date >= p_from) AND (p_to IS NULL OR txn_date <= p_to)
                 AND (v_seg IS NULL OR segment = v_seg OR (segment IS NULL AND bucket='common_expense'))
               GROUP BY expense_head_id) s
        LEFT JOIN public.finance_expense_heads h ON h.id = s.expense_head_id), '[]'::jsonb),
    'excluded', COALESCE((
      SELECT jsonb_object_agg(bucket, amt) FROM (
        SELECT bucket, SUM(amount) amt FROM public.finance_transactions
         WHERE bucket IN ('internal_transfer','loan_in','loan_out','owner_drawings','investment','asset','tax')
           AND (p_from IS NULL OR txn_date >= p_from) AND (p_to IS NULL OR txn_date <= p_to)
         GROUP BY bucket) e), '{}'::jsonb),
    'review', (SELECT jsonb_build_object('count', count(*), 'amount', COALESCE(SUM(amount),0))
        FROM public.finance_transactions
       WHERE bucket = 'review'
         AND (p_from IS NULL OR txn_date >= p_from) AND (p_to IS NULL OR txn_date <= p_to)
         AND (v_seg IS NULL OR segment = v_seg OR segment IS NULL))
  );
  RETURN v_out;
END $fn$;

GRANT EXECUTE ON FUNCTION public.finance_pnl_summary(date,date,text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY: as admin should return a populated object; as a plain rep '{}'.
-- SELECT public.finance_pnl_summary(NULL,NULL,NULL);
SELECT (public.finance_pnl_summary(NULL,NULL,NULL) -> 'operating_profit') AS op_profit,
       (public.finance_pnl_summary(NULL,NULL,NULL) -> 'income')           AS income,
       (public.finance_pnl_summary(NULL,NULL,NULL) -> 'review' ->> 'count') AS review_rows;
