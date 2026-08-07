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

-- Commission head (§168) — a real running cost; classifier tags 'Commission' rows
-- as common_expense + this head, so it reduces Business Profit yet shows as its
-- own Money-Out line. Additive seed (no bucket CHECK change).
INSERT INTO public.finance_expense_heads (name, kind, display_order) VALUES
  ('Commission','operating',35)
ON CONFLICT (name) DO NOTHING;

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
  -- cash-view scalars (money in/out + net cash + business profit; commission = a
  -- common_expense with head 'Commission' so it reduces Business Profit yet shows
  -- as its own Money-Out line). Owner spec 2026-08-07 (§168).
  v_loan_in numeric; v_loan_out numeric; v_draw numeric; v_tax numeric;
  v_sweep numeric; v_asset numeric; v_comm numeric; v_review_out numeric; v_review_in numeric;
  v_tin numeric; v_tout numeric; v_bprofit numeric;
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
  -- itot = FULL income in range (same row set money_in scans, so Σ money_in ties to
  -- total_in even for a NULL-derived-segment credit); ig/ip stay the Govt/Pvt split.
  SELECT COALESCE(SUM(amount),0) INTO itot FROM public.finance_transactions
   WHERE bucket='income' AND (p_from IS NULL OR txn_date>=p_from) AND (p_to IS NULL OR txn_date<=p_to)
     AND (v_seg IS NULL OR COALESCE(segment, CASE company WHEN 'Untitled Advertising' THEN 'GOVERNMENT'
                                                          WHEN 'Untitled Adflux Pvt Ltd' THEN 'PRIVATE' END)=v_seg);

  SELECT COALESCE(SUM(amount) FILTER (WHERE segment='GOVERNMENT'),0),
         COALESCE(SUM(amount) FILTER (WHERE segment='PRIVATE'),0)
    INTO dg, dp
    FROM public.finance_transactions
   WHERE bucket='direct_cost' AND (p_from IS NULL OR txn_date>=p_from) AND (p_to IS NULL OR txn_date<=p_to)
     AND (v_seg IS NULL OR segment=v_seg);
  -- dtot = FULL direct cost in range (same row set money_out groups, so a NULL-segment
  -- direct_cost row can't overstate business_profit or break Σ money_out=total_out);
  -- dg/dp stay the Govt/Pvt split for by_segment/per_company.
  SELECT COALESCE(SUM(amount),0) INTO dtot FROM public.finance_transactions
   WHERE bucket='direct_cost' AND (p_from IS NULL OR txn_date>=p_from) AND (p_to IS NULL OR txn_date<=p_to)
     AND (v_seg IS NULL OR segment=v_seg);

  SELECT COALESCE(SUM(amount),0) INTO ctot FROM public.finance_transactions
   WHERE bucket='common_expense' AND (p_from IS NULL OR txn_date>=p_from) AND (p_to IS NULL OR txn_date<=p_to);

  -- commission = common_expense rows tagged head 'Commission' (real running cost)
  SELECT COALESCE(SUM(ft.amount),0) INTO v_comm
    FROM public.finance_transactions ft
    JOIN public.finance_expense_heads h ON h.id=ft.expense_head_id
   WHERE ft.bucket='common_expense' AND h.name='Commission'
     AND (p_from IS NULL OR ft.txn_date>=p_from) AND (p_to IS NULL OR ft.txn_date<=p_to);

  -- excluded-from-profit scalars for the cash view
  SELECT
    COALESCE(SUM(amount) FILTER (WHERE bucket='loan_in'),0),
    COALESCE(SUM(amount) FILTER (WHERE bucket='loan_out'),0),
    COALESCE(SUM(amount) FILTER (WHERE bucket='owner_drawings'),0),
    COALESCE(SUM(amount) FILTER (WHERE bucket='tax'),0),
    COALESCE(SUM(amount) FILTER (WHERE bucket='internal_transfer'),0),
    COALESCE(SUM(amount) FILTER (WHERE bucket IN ('investment','asset') AND direction='out'),0),
    COALESCE(SUM(amount) FILTER (WHERE bucket='review' AND direction='out'),0),
    COALESCE(SUM(amount) FILTER (WHERE bucket='review' AND direction='in'),0)
    INTO v_loan_in, v_loan_out, v_draw, v_tax, v_sweep, v_asset, v_review_out, v_review_in
    FROM public.finance_transactions
   WHERE (p_from IS NULL OR txn_date>=p_from) AND (p_to IS NULL OR txn_date<=p_to);

  v_bprofit := itot - dtot - ctot;                                   -- revenue − running costs (commission ⊂ ctot)
  v_tin     := itot + v_loan_in + v_review_in;                       -- cash IN  (revenue + borrowed + unsorted credits)
  v_tout    := dtot + ctot + v_asset + v_loan_out + v_draw + v_tax + v_review_out;  -- cash OUT (SWEEP excluded → net-zero)

  v_out := jsonb_build_object(
    'income', itot, 'income_gov', ig, 'income_pvt', ip,
    'direct_cost', dtot, 'common_expense', ctot,
    'operating_profit', itot-dtot-ctot,
    'business_profit', v_bprofit,
    'margin_pct', CASE WHEN itot>0 THEN round((itot-dtot-ctot)/itot*100,1) ELSE 0 END,
    -- ---- CASH VIEW (owner spec §168): money in / out / net cash + commission + sweep ----
    'total_in', v_tin, 'total_out', v_tout, 'net_cash', v_tin - v_tout,
    'commission', v_comm, 'sweep', v_sweep,
    'money_in', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', lbl, 'amount', amt) ORDER BY amt DESC)
      FROM (
        SELECT lbl, SUM(amt) amt FROM (
          SELECT CASE WHEN media_type IS NOT NULL
                      THEN (CASE WHEN COALESCE(segment, CASE company WHEN 'Untitled Advertising' THEN 'GOVERNMENT'
                                                                    WHEN 'Untitled Adflux Pvt Ltd' THEN 'PRIVATE' END)='GOVERNMENT' THEN 'Govt' ELSE 'Pvt' END)||' · '||media_type
                      ELSE COALESCE(company,'Other income') END AS lbl,
                 amount AS amt
            FROM public.finance_transactions
           WHERE bucket='income' AND (p_from IS NULL OR txn_date>=p_from) AND (p_to IS NULL OR txn_date<=p_to)
             AND (v_seg IS NULL OR COALESCE(segment, CASE company WHEN 'Untitled Advertising' THEN 'GOVERNMENT'
                                                                  WHEN 'Untitled Adflux Pvt Ltd' THEN 'PRIVATE' END)=v_seg)
          UNION ALL SELECT 'Loan from friend', v_loan_in
          UNION ALL SELECT 'Unsorted credits (review)', v_review_in
        ) mi GROUP BY lbl
      ) z WHERE amt > 0), '[]'::jsonb),
    'money_out', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', lbl, 'amount', amt) ORDER BY amt DESC)
      FROM (
        SELECT lbl, SUM(amt) amt FROM (
          SELECT CASE media_type WHEN 'GSRTC_LED' THEN 'GSRTC' WHEN 'AUTO_HOOD' THEN 'Auto Hood'
                                 WHEN 'OTHER_MEDIA' THEN 'Other Media' WHEN 'LED_OTHER' THEN 'Pvt LED'
                                 ELSE COALESCE(media_type,'Other direct cost') END AS lbl,
                 amount AS amt
            FROM public.finance_transactions
           WHERE bucket='direct_cost' AND (p_from IS NULL OR txn_date>=p_from) AND (p_to IS NULL OR txn_date<=p_to)
             AND (v_seg IS NULL OR segment=v_seg)
          UNION ALL SELECT 'Common expense', ctot - v_comm
          UNION ALL SELECT 'Commission', v_comm
          UNION ALL SELECT 'Assets / equipment', v_asset
          UNION ALL SELECT 'Loan repaid', v_loan_out
          UNION ALL SELECT 'Personal', v_draw
          UNION ALL SELECT 'Tax', v_tax
          UNION ALL SELECT 'Review (to sort)', v_review_out
        ) mo GROUP BY lbl
      ) z WHERE amt > 0), '[]'::jsonb),
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
    -- Per company = grouped by the REAL company column (owner 2026-08-07): GSRTC/Auto
    -- are pinned to Untitled Advertising; Other Media / Pvt LED carry the bank account's
    -- company. Common expense allocated by that company's income share. (by_segment above
    -- stays segment-based, so Pvt·Other Media can sit under the Untitled Advertising company.)
    'per_company', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'company', comp, 'income', inc,
        'op_pnl', inc - dcost - CASE WHEN itot>0 THEN round(ctot*inc/itot) ELSE 0 END,
        'margin', CASE WHEN inc>0 THEN round((inc - dcost - CASE WHEN itot>0 THEN ctot*inc/itot ELSE 0 END)/inc*100,1) ELSE NULL END
      ) ORDER BY inc DESC)
      FROM (
        SELECT COALESCE(company,'Unassigned') AS comp,
               COALESCE(SUM(amount) FILTER (WHERE bucket='income'),0) AS inc,
               COALESCE(SUM(amount) FILTER (WHERE bucket='direct_cost'),0) AS dcost
          FROM public.finance_transactions
         WHERE bucket IN ('income','direct_cost')
           AND (p_from IS NULL OR txn_date>=p_from) AND (p_to IS NULL OR txn_date<=p_to)
           AND (v_seg IS NULL OR COALESCE(segment, CASE company WHEN 'Untitled Advertising' THEN 'GOVERNMENT'
                                                                WHEN 'Untitled Adflux Pvt Ltd' THEN 'PRIVATE' END)=v_seg)
         GROUP BY 1
      ) pc), '[]'::jsonb),
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
    -- SIMPLE view: money in/out grouped by CATEGORY (matches the Register dropdown +
    -- currentCat() in FinanceV2.jsx — derived from bucket so re-tagging moves it).
    'by_tag', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('tag', cat, 'inflow', inflow, 'outflow', outflow, 'rows', n) ORDER BY (inflow+outflow) DESC)
      FROM (SELECT
              CASE
                WHEN bucket IN ('income','direct_cost') THEN
                  CASE WHEN media_type='GSRTC_LED' THEN 'GSRTC'
                       WHEN media_type='AUTO_HOOD' THEN 'Auto Hood'
                       WHEN company='Untitled Adflux Pvt Ltd' THEN 'Untitled Adflux Pvt Ltd'
                       ELSE 'Untitled Advertising' END
                WHEN bucket='common_expense' THEN 'Common Expense'
                WHEN bucket='owner_drawings' THEN 'Personal / Drawings'
                WHEN bucket IN ('loan_in','loan_out') THEN 'Loan'
                WHEN bucket='tax' THEN 'Tax'
                WHEN bucket='internal_transfer' THEN 'Transfer (Sweep)'
                ELSE 'To sort'
              END AS cat,
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
         -- §168.2: TRUE receivables = WON deals with money still outstanding
         -- (was sent/negotiating/won → that counted un-won quotes = overstated).
         WHERE q.status = 'won' AND (NOT v_gov_only OR q.segment='GOVERNMENT')
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
