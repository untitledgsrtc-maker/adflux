-- =====================================================================
-- FINANCE MODULE — Phase 3 RPCs (P&L + Accounts Home). Server-side (§66).
-- 2026-08-03 · spec docs/FINANCE_MODULE_SPEC.md · needs P1 + P2 run first.
-- Edit-in-place canonical (§71). Re-run after any change (CREATE OR REPLACE).
--
-- P3.2 (owner: "analyse the excel + make accordingly") — INCOME now = the BANK
-- LEDGER (finance_transactions bucket='income', the accountant's tagged credits),
-- NOT CRM payments (the CRM is empty → the CRM-income P&L was blank). The CRM
-- cross-check becomes a later reconciliation feature. Income segment derived:
-- GSRTC/AUTO rows carry segment; generic company credits → Untitled Advertising =
-- GOVERNMENT, Untitled Adflux Pvt Ltd = PRIVATE.
--   Real Apr–Jul: income ₹1.03Cr · cost ₹53L · OPERATING PROFIT ₹49.15L (47.9%).
--
-- finance_accounts_home() → receivables (CRM quotes−payments) + approvals + review
-- + finance_tasks. (Receivables stay CRM-based; empty until quotes/payments exist.)
-- Both SECURITY DEFINER + gate: admin/accounts full; co_owner+government_partner
-- (Vishal) FORCED GOVERNMENT; else '{}'. Fail closed on NULL role.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.finance_pnl_summary(
  p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_segment text DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_role text := public.get_my_role();
  v_gp   boolean := EXISTS (SELECT 1 FROM public.users u WHERE u.id=auth.uid() AND u.team_role='government_partner');
  v_seg  text := p_segment;
  ig numeric; ip numeric; itot numeric;
  dg numeric; dp numeric; dtot numeric; ctot numeric;
  v_out jsonb;
BEGIN
  IF COALESCE(v_role,'') NOT IN ('admin','accounts') THEN
    IF v_gp THEN v_seg := 'GOVERNMENT'; ELSE RETURN '{}'::jsonb; END IF;
  END IF;

  -- INCOME from the bank ledger, segment derived (GSRTC/AUTO carry it; company → segment)
  SELECT
    COALESCE(SUM(amount) FILTER (WHERE COALESCE(segment,
        CASE company WHEN 'Untitled Advertising' THEN 'GOVERNMENT'
                     WHEN 'Untitled Adflux Pvt Ltd' THEN 'PRIVATE' END) = 'GOVERNMENT'),0),
    COALESCE(SUM(amount) FILTER (WHERE COALESCE(segment,
        CASE company WHEN 'Untitled Advertising' THEN 'GOVERNMENT'
                     WHEN 'Untitled Adflux Pvt Ltd' THEN 'PRIVATE' END) = 'PRIVATE'),0)
    INTO ig, ip
    FROM public.finance_transactions
   WHERE bucket = 'income'
     AND (p_from IS NULL OR txn_date>=p_from) AND (p_to IS NULL OR txn_date<=p_to);
  IF v_seg='GOVERNMENT' THEN ip:=0; ELSIF v_seg='PRIVATE' THEN ig:=0; END IF;
  itot := ig+ip;

  SELECT COALESCE(SUM(amount) FILTER (WHERE segment='GOVERNMENT'),0),
         COALESCE(SUM(amount) FILTER (WHERE segment='PRIVATE'),0)
    INTO dg, dp
    FROM public.finance_transactions
   WHERE bucket='direct_cost' AND (p_from IS NULL OR txn_date>=p_from) AND (p_to IS NULL OR txn_date<=p_to)
     AND (v_seg IS NULL OR segment=v_seg);
  dtot := dg+dp;

  SELECT COALESCE(SUM(amount),0) INTO ctot FROM public.finance_transactions
   WHERE bucket='common_expense' AND (p_from IS NULL OR txn_date>=p_from) AND (p_to IS NULL OR txn_date<=p_to);

  v_out := jsonb_build_object(
    'income', itot, 'income_gov', ig, 'income_pvt', ip,
    'direct_cost', dtot, 'common_expense', ctot,
    'operating_profit', itot-dtot-ctot,
    'margin_pct', CASE WHEN itot>0 THEN round((itot-dtot-ctot)/itot*100,1) ELSE 0 END,
    -- by segment × media_type (the 4+ real business lines: Govt·Auto Hood,
    -- Govt·GSRTC LED, Pvt·Other Media, etc.). Untagged income → "· Other" until
    -- the accountant sets media_type in the Register.
    'by_segment', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'label', lbl, 'segment', seg, 'income', inc, 'direct', dcost,
        'common', CASE WHEN itot>0 THEN round(ctot*inc/itot) ELSE 0 END,
        'net', inc - dcost - CASE WHEN itot>0 THEN round(ctot*inc/itot) ELSE 0 END,
        'pct', CASE WHEN itot>0 THEN round(inc/itot*100) ELSE 0 END) ORDER BY inc DESC)
      FROM (
        SELECT i.seg,
               (CASE WHEN i.seg='GOVERNMENT' THEN 'Govt' WHEN i.seg='PRIVATE' THEN 'Pvt' ELSE '—' END)
                 ||' · '||COALESCE(i.med,'Other') AS lbl,
               i.inc, COALESCE(c.dcost,0) AS dcost
        FROM (SELECT COALESCE(segment, CASE company WHEN 'Untitled Advertising' THEN 'GOVERNMENT'
                                                    WHEN 'Untitled Adflux Pvt Ltd' THEN 'PRIVATE' END) AS seg,
                     media_type AS med, SUM(amount) AS inc
                FROM public.finance_transactions
               WHERE bucket='income'
                 AND (p_from IS NULL OR txn_date>=p_from) AND (p_to IS NULL OR txn_date<=p_to)
                 AND (v_seg IS NULL OR COALESCE(segment, CASE company WHEN 'Untitled Advertising' THEN 'GOVERNMENT'
                                                                      WHEN 'Untitled Adflux Pvt Ltd' THEN 'PRIVATE' END)=v_seg)
               GROUP BY 1,2) i
        LEFT JOIN (SELECT segment AS seg, media_type AS med, SUM(amount) AS dcost
                     FROM public.finance_transactions
                    WHERE bucket='direct_cost'
                      AND (p_from IS NULL OR txn_date>=p_from) AND (p_to IS NULL OR txn_date<=p_to)
                    GROUP BY 1,2) c
          ON c.seg=i.seg AND COALESCE(c.med,'~')=COALESCE(i.med,'~')
      ) x), '[]'::jsonb),
    'per_company', jsonb_build_array(
      jsonb_build_object('company','Untitled Advertising','income',ig,
        'op_pnl', ig-dg-CASE WHEN itot>0 THEN round(ctot*ig/itot) ELSE 0 END,
        'margin', CASE WHEN ig>0 THEN round((ig-dg-CASE WHEN itot>0 THEN ctot*ig/itot ELSE 0 END)/ig*100,1) ELSE 0 END),
      jsonb_build_object('company','Untitled Adflux Pvt Ltd','income',ip,
        'op_pnl', ip-dp-CASE WHEN itot>0 THEN round(ctot*ip/itot) ELSE 0 END,
        'margin', CASE WHEN ip>0 THEN round((ip-dp-CASE WHEN itot>0 THEN ctot*ip/itot ELSE 0 END)/ip*100,1) ELSE 0 END)
    ),
    'revenue_mix', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', lbl, 'amount', amt,
               'pct', CASE WHEN itot>0 THEN round(amt/itot*100) ELSE 0 END) ORDER BY amt DESC)
      FROM (SELECT
              CASE WHEN media_type IS NOT NULL
                   THEN (CASE WHEN segment='GOVERNMENT' THEN 'Govt' ELSE 'Pvt' END)||' · '||media_type
                   ELSE COALESCE(company,'Other') END AS lbl,
              SUM(amount) amt
              FROM public.finance_transactions
             WHERE bucket='income'
               AND (p_from IS NULL OR txn_date>=p_from) AND (p_to IS NULL OR txn_date<=p_to)
               AND (v_seg IS NULL OR COALESCE(segment,
                     CASE company WHEN 'Untitled Advertising' THEN 'GOVERNMENT'
                                  WHEN 'Untitled Adflux Pvt Ltd' THEN 'PRIVATE' END)=v_seg)
             GROUP BY 1) m), '[]'::jsonb),
    'monthly', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('month', mth, 'income', COALESCE(inc,0), 'cost', COALESCE(cst,0)) ORDER BY mth)
      FROM (SELECT to_char(txn_date,'YYYY-MM') mth,
                   SUM(amount) FILTER (WHERE bucket='income') inc,
                   SUM(amount) FILTER (WHERE bucket IN ('direct_cost','common_expense')) cst
              FROM public.finance_transactions
             WHERE bucket IN ('income','direct_cost','common_expense')
               AND (p_from IS NULL OR txn_date>=p_from) AND (p_to IS NULL OR txn_date<=p_to)
               AND (v_seg IS NULL OR segment=v_seg OR segment IS NULL)
             GROUP BY 1) mm), '[]'::jsonb),
    'by_head', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('head', COALESCE(h.name,'Unclassified'), 'amount', s.amt) ORDER BY s.amt DESC)
      FROM (SELECT expense_head_id, SUM(amount) amt FROM public.finance_transactions
             WHERE bucket IN ('direct_cost','common_expense')
               AND (p_from IS NULL OR txn_date>=p_from) AND (p_to IS NULL OR txn_date<=p_to)
               AND (v_seg IS NULL OR segment=v_seg OR (segment IS NULL AND bucket='common_expense'))
             GROUP BY expense_head_id) s
      LEFT JOIN public.finance_expense_heads h ON h.id=s.expense_head_id), '[]'::jsonb),
    'assets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('date', txn_date, 'remark', description, 'type', bucket, 'amount', amount) ORDER BY txn_date DESC)
      FROM public.finance_transactions
       WHERE bucket IN ('investment','asset')
         AND (p_from IS NULL OR txn_date>=p_from) AND (p_to IS NULL OR txn_date<=p_to)), '[]'::jsonb),
    'excluded', COALESCE((SELECT jsonb_object_agg(bucket, amt) FROM (
        SELECT bucket, SUM(amount) amt FROM public.finance_transactions
         WHERE bucket IN ('internal_transfer','loan_in','loan_out','owner_drawings','investment','asset','tax')
           AND (p_from IS NULL OR txn_date>=p_from) AND (p_to IS NULL OR txn_date<=p_to)
         GROUP BY bucket) e), '{}'::jsonb),
    -- SIMPLE view: money in/out grouped by the accountant's OWN Excel category (raw_tag)
    'by_tag', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('tag', tg, 'inflow', inflow, 'outflow', outflow, 'rows', n) ORDER BY (inflow+outflow) DESC)
      FROM (SELECT btrim(COALESCE(NULLIF(raw_tag,''),'(untagged)')) tg,
                   COALESCE(SUM(amount) FILTER (WHERE direction='in'),0) inflow,
                   COALESCE(SUM(amount) FILTER (WHERE direction='out'),0) outflow,
                   count(*) n
              FROM public.finance_transactions
             WHERE (p_from IS NULL OR txn_date>=p_from) AND (p_to IS NULL OR txn_date<=p_to)
             GROUP BY 1) t), '[]'::jsonb),
    'review', (SELECT jsonb_build_object('count', count(*), 'amount', COALESCE(SUM(amount),0))
        FROM public.finance_transactions WHERE bucket='review'
          AND (p_from IS NULL OR txn_date>=p_from) AND (p_to IS NULL OR txn_date<=p_to))
  );
  RETURN v_out;
END $fn$;
GRANT EXECUTE ON FUNCTION public.finance_pnl_summary(date,date,text) TO authenticated;

-- ---- Accounts Home (receivables from CRM quotes−payments; empty until CRM has data) --
CREATE OR REPLACE FUNCTION public.finance_accounts_home()
  RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_role text := public.get_my_role();
  v_gp   boolean := EXISTS (SELECT 1 FROM public.users u WHERE u.id=auth.uid() AND u.team_role='government_partner');
  v_gov_only boolean := false;
  v_out jsonb;
BEGIN
  IF COALESCE(v_role,'') NOT IN ('admin','accounts') THEN
    IF v_gp THEN v_gov_only := true; ELSE RETURN '{}'::jsonb; END IF;
  END IF;
  v_out := jsonb_build_object(
    'to_collect', COALESCE((
      SELECT jsonb_build_object('total', COALESCE(SUM(outstanding),0), 'count', count(*),
               'rows', COALESCE(jsonb_agg(jsonb_build_object('client', client_name, 'amount', outstanding,
                        'days', GREATEST(0,(CURRENT_DATE - created_date))) ORDER BY created_date ASC), '[]'::jsonb))
      FROM (SELECT q.id, COALESCE(q.client_company, q.client_name, 'Client') client_name,
               (q.total_amount - COALESCE((SELECT SUM(p.amount_received) FROM public.payments p
                    WHERE p.quote_id=q.id AND p.approval_status='approved'),0)) outstanding,
               q.created_at::date created_date
          FROM public.quotes q
         WHERE q.status IN ('sent','negotiating','won') AND (NOT v_gov_only OR q.segment='GOVERNMENT')
      ) r WHERE outstanding > 0), '{}'::jsonb),
    'approvals_pending', (SELECT count(*) FROM public.payments WHERE approval_status='pending'),
    'review_count', (SELECT count(*) FROM public.finance_transactions WHERE bucket='review'),
    'tasks', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'title',title,'frequency',frequency,
                'next_due',next_due,'channel',reminder_channel,'status',status) ORDER BY frequency, title)
              FROM public.finance_tasks WHERE is_active), '[]'::jsonb)
  );
  RETURN v_out;
END $fn$;
GRANT EXECUTE ON FUNCTION public.finance_accounts_home() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY — your real P&L (plain query, no login needed, works right here):
SELECT
  (SELECT SUM(amount) FROM public.finance_transactions WHERE bucket='income')  AS income,
  (SELECT SUM(amount) FROM public.finance_transactions WHERE bucket IN ('direct_cost','common_expense')) AS cost,
  (SELECT SUM(amount) FROM public.finance_transactions WHERE bucket='income')
    - (SELECT SUM(amount) FROM public.finance_transactions WHERE bucket IN ('direct_cost','common_expense')) AS operating_profit,
  (SELECT count(*) FROM public.finance_transactions WHERE bucket='review')      AS review_rows;
-- (The RPCs are already installed from the CREATE OR REPLACE above — no re-run needed.)
