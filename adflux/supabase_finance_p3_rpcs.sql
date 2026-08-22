-- =====================================================================
-- FINANCE MODULE — Phase 3 RPCs (P&L + Accounts Home). Server-side (§66).
-- 2026-08-03 · spec docs/FINANCE_MODULE_SPEC.md · needs P1 + P2 run first.
-- Edit-in-place canonical (§71). Re-run after any change (CREATE OR REPLACE).
--
-- P3.3 (owner 2026-08-22: "income = won/collected CRM deals, not bank credits";
-- refined: EX-GST) — INCOME now = the CRM won deals: SUM(approved payments,
-- EX-GST = amount_received × subtotal/total) on WON quotes, split by the quote's
-- segment + media_type, dated by payment_date. GST is a govt pass-through (not
-- revenue) so it is stripped on the same ratio commission uses (§273); TDS stays
-- IN (your PAN tax credit).
-- via finance_crm_income_rows() (defined below; birthplace =
-- supabase_finance_crm_income_shadow.sql). Same won-deal population the
-- commission uses (§171) → revenue and its commission cost finally reconcile
-- (the −₹34.66L "loss" with ₹0 income was: commission was CRM, income was bank).
-- Bank income credits are no longer the P&L income source; they become a
-- reconciliation check (finance_reconcile, §162: a bank credit with no CRM
-- payment → "receipt not in CRM"). COSTS stay bank-based (media/vendor + common
-- are paid from the bank). SUPERSEDES P3.2 bank-income everywhere below.
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

-- Govt-team commission (owner 2026-08-07). ENTERED AT PAYMENT TIME (owner revised):
-- when recording a payment on a WON GOVERNMENT deal created by OUR TEAM, the user types
-- a commission % → the modal computes + stores the ₹ on THAT payment. finance_pnl_summary
-- SUMS payments.commission_amount (below). quotes.govt_commission_percent is now UNUSED
-- (kept, harmless — the quote-time field was removed). Agency deals ride
-- agency_commission_payouts → excluded here (created_by role), XOR no double-count.
ALTER TABLE public.quotes   ADD COLUMN IF NOT EXISTS govt_commission_percent numeric(5,2);
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS commission_pct    numeric(5,2);
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS commission_amount numeric;

-- CRM income source (P3.3, canonical home here; also in the shadow file). One row
-- per APPROVED payment on a WON quote, shaped like the P&L income reads:
-- (segment, media_type, company, amount, txn_date). Same population the commission
-- uses → revenue + commission reconcile. Govt amount_received = gross incl. TDS
-- (§274) = the deal's true collected worth.
CREATE OR REPLACE FUNCTION public.finance_crm_income_rows(
  p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_seg text DEFAULT NULL
) RETURNS TABLE(segment text, media_type text, company text, amount numeric, txn_date date)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $crm$
  SELECT
    q.segment,
    q.media_type,
    CASE q.segment WHEN 'GOVERNMENT' THEN 'Untitled Advertising'
                   WHEN 'PRIVATE'    THEN 'Untitled Adflux Pvt Ltd'
                   ELSE NULL END,
    -- EX-GST revenue: strip output GST via subtotal/total (same ratio commission
    -- uses, §273) so income sits on the same base as commission. GST is a govt
    -- pass-through, not revenue. TDS stays IN (it's your PAN tax credit). Fall back
    -- to gross when a deal has no subtotal/total on file.
    round(p.amount_received * COALESCE(NULLIF(q.subtotal,0) / NULLIF(q.total_amount,0), 1)),
    p.payment_date
  FROM public.payments p
  JOIN public.quotes   q ON q.id = p.quote_id
  WHERE p.approval_status = 'approved'
    AND q.status = 'won'
    AND COALESCE(p.amount_received, 0) > 0
    AND (p_from IS NULL OR p.payment_date >= p_from)
    AND (p_to   IS NULL OR p.payment_date <= p_to)
    AND (p_seg  IS NULL OR q.segment = p_seg);
$crm$;
-- SECURITY DEFINER + role-blind → do NOT expose to clients. finance_pnl_summary
-- (SECURITY DEFINER, same owner) calls it internally with the owner's privilege,
-- so no client GRANT is needed. REVOKE closes the §8/§152 all-segment revenue leak
-- (a rep could otherwise rpc() it directly). §211/§72 posture.
REVOKE EXECUTE ON FUNCTION public.finance_crm_income_rows(date,date,text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.finance_crm_income_rows(date,date,text) TO service_role;

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
  v_govt_comm numeric; v_agency_comm numeric;
  v_tin numeric; v_tout numeric; v_bprofit numeric;
  v_out jsonb;
BEGIN
  IF COALESCE(v_role,'') NOT IN ('admin','accounts') THEN
    IF v_gp THEN v_seg := 'GOVERNMENT'; ELSE RETURN '{}'::jsonb; END IF;
  END IF;

  -- INCOME from the CRM won/collected deals (approved payments on WON quotes),
  -- split by the quote's segment (P3.3). Bank income credits → reconciliation only.
  SELECT
    COALESCE(SUM(amount) FILTER (WHERE segment = 'GOVERNMENT'),0),
    COALESCE(SUM(amount) FILTER (WHERE segment = 'PRIVATE'),0)
    INTO ig, ip
    FROM public.finance_crm_income_rows(p_from, p_to, NULL);
  IF v_seg='GOVERNMENT' THEN ip:=0; ELSIF v_seg='PRIVATE' THEN ig:=0; END IF;
  -- itot = FULL CRM income in range (same row set money_in scans, so Σ money_in
  -- still ties to total_in); ig/ip stay the Govt/Pvt split.
  SELECT COALESCE(SUM(amount),0) INTO itot FROM public.finance_crm_income_rows(p_from, p_to, v_seg);

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

  -- commission = common_expense rows tagged head 'Commission' (real running cost, from the bank)
  SELECT COALESCE(SUM(ft.amount),0) INTO v_comm
    FROM public.finance_transactions ft
    JOIN public.finance_expense_heads h ON h.id=ft.expense_head_id
   WHERE ft.bucket='common_expense' AND h.name='Commission'
     AND (p_from IS NULL OR ft.txn_date>=p_from) AND (p_to IS NULL OR ft.txn_date<=p_to);

  -- GOVT-TEAM commission (owner 2026-08-07, payment-entry) — the REAL commission COST,
  -- entered per payment: SUM payments.commission_amount over APPROVED payments on WON
  -- GOVERNMENT deals created by OUR TEAM (created_by NOT agency — agency deals use
  -- agency_commission_payouts → XOR, no double-count). Govt-only → 0 in a PRIVATE view.
  -- Bank-tagged/narration Commission (v_comm) is a SETTLEMENT of this, netted below (§169.1).
  SELECT COALESCE(SUM(p.commission_amount),0)
    INTO v_govt_comm
    FROM public.payments p
    JOIN public.quotes q  ON q.id = p.quote_id
    LEFT JOIN public.users u ON u.id = q.created_by
   WHERE q.segment = 'GOVERNMENT' AND q.status = 'won'
     AND COALESCE(p.commission_amount,0) > 0
     AND COALESCE(u.role,'') <> 'agency'
     AND p.approval_status = 'approved'
     AND (p_from IS NULL OR p.payment_date>=p_from) AND (p_to IS NULL OR p.payment_date<=p_to);
  IF v_seg = 'PRIVATE' THEN v_govt_comm := 0; END IF;

  -- AGENCY commission (owner 2026-08-07, chose "as the client pays" — accrued
  -- proportional to collection, like govt). On WON AGENCY-CREATED quotes:
  -- (payment ÷ deal total) × (subtotal × the agency user's %). XOR with
  -- v_govt_comm (that requires created_by NOT agency; this requires = agency)
  -- → a quote is counted in exactly one. Segment-scoped (an agency deal can be
  -- PRIVATE or GOVERNMENT), so a filtered view only counts that segment. Default
  -- 5% when the agency user has no rate set (AgencyEarningsView precedent).
  SELECT COALESCE(SUM(
           (p.amount_received / NULLIF(q.total_amount,0))
           * (q.subtotal * COALESCE(u.agency_commission_percent, 5) / 100.0)
         ),0)
    INTO v_agency_comm
    FROM public.payments p
    JOIN public.quotes q ON q.id = p.quote_id
    JOIN public.users  u ON u.id = q.created_by
   WHERE q.status = 'won'
     AND COALESCE(u.role,'') = 'agency'
     AND p.approval_status = 'approved'
     AND (v_seg IS NULL OR q.segment = v_seg)
     AND (p_from IS NULL OR p.payment_date>=p_from) AND (p_to IS NULL OR p.payment_date<=p_to);

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

  -- COMMISSION MODEL (owner 2026-08-07): the commission COST = the two accruals
  -- (v_govt_comm + v_agency_comm). A bank "Commission" debit (v_comm, tagged OR
  -- narration-matched) is a SETTLEMENT of an already-booked accrual, NOT a second
  -- cost — netted out of Business Profit (add v_comm back) and out of cash-out
  -- (drop it from v_tout), leaving the accruals as the commission figure
  -- everywhere. No double-count, no manual guard.
  v_bprofit := itot - dtot - ctot + v_comm - v_govt_comm - v_agency_comm;  -- revenue − running costs (bank commission = settlement, added back; both accruals are the cost)
  v_tin     := itot + v_loan_in + v_review_in;                       -- cash IN  (revenue + borrowed + unsorted credits)
  v_tout    := dtot + (ctot - v_comm) + v_govt_comm + v_agency_comm + v_asset + v_loan_out + v_draw + v_tax + v_review_out;  -- cash OUT (bank commission netted; accruals stand in; SWEEP excluded)

  v_out := jsonb_build_object(
    'income', itot, 'income_gov', ig, 'income_pvt', ip,
    'direct_cost', dtot, 'common_expense', ctot,
    'operating_profit', v_bprofit,
    'business_profit', v_bprofit,
    'margin_pct', CASE WHEN itot>0 THEN round(v_bprofit/itot*100,1) ELSE 0 END,
    -- ---- CASH VIEW (owner spec §168): money in / out / net cash + commission + sweep ----
    'total_in', v_tin, 'total_out', v_tout, 'net_cash', v_tin - v_tout,
    'commission', v_govt_comm + v_agency_comm, 'commission_govt', v_govt_comm, 'commission_agency', v_agency_comm, 'sweep', v_sweep,
    'money_in', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', lbl, 'amount', amt) ORDER BY amt DESC)
      FROM (
        SELECT lbl, SUM(amt) amt FROM (
          SELECT CASE WHEN media_type IS NOT NULL
                      THEN (CASE WHEN segment='GOVERNMENT' THEN 'Govt' ELSE 'Pvt' END)||' · '||media_type
                      ELSE COALESCE(company,'Other income') END AS lbl,
                 amount AS amt
            FROM public.finance_crm_income_rows(p_from, p_to, v_seg)
          UNION ALL SELECT 'Loan from friend', v_loan_in
          UNION ALL SELECT 'Unsorted credits (review)', v_review_in
        ) mi GROUP BY lbl
      ) z WHERE amt > 0), '[]'::jsonb),
    -- P3.4 — each line carries `pnl` (true = a real running COST that reduces
    -- Business Profit; false = a cash movement that is NOT a P&L cost). The Profit
    -- Statement (§286) reads `pnl` directly instead of a fragile JS label denylist,
    -- so a renamed label can never leak a cash line into "Less expenses".
    'money_out', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', lbl, 'amount', amt, 'pnl', pnl) ORDER BY amt DESC)
      FROM (
        SELECT lbl, SUM(amt) amt, bool_or(pnl) pnl FROM (
          SELECT CASE media_type WHEN 'GSRTC_LED' THEN 'GSRTC' WHEN 'AUTO_HOOD' THEN 'Auto Hood'
                                 WHEN 'OTHER_MEDIA' THEN 'Other Media' WHEN 'LED_OTHER' THEN 'Pvt LED'
                                 ELSE COALESCE(media_type,'Other direct cost') END AS lbl,
                 amount AS amt, true AS pnl
            FROM public.finance_transactions
           WHERE bucket='direct_cost' AND (p_from IS NULL OR txn_date>=p_from) AND (p_to IS NULL OR txn_date<=p_to)
             AND (v_seg IS NULL OR segment=v_seg)
          UNION ALL SELECT 'Common expense',          ctot - v_comm, true
          UNION ALL SELECT 'Commission — govt team',  v_govt_comm,   true
          UNION ALL SELECT 'Commission — agency',     v_agency_comm, true
          UNION ALL SELECT 'Assets / equipment',      v_asset,       false
          UNION ALL SELECT 'Loan repaid',             v_loan_out,    false
          UNION ALL SELECT 'Personal',                v_draw,        false
          UNION ALL SELECT 'Tax',                     v_tax,         false
          UNION ALL SELECT 'Review (to sort)',        v_review_out,  false
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
      -- P3.4 — total-preserving: UNION income + direct cost (was a LEFT JOIN from
      -- income, which DROPPED a direct cost whose (segment,media) had no won-deal
      -- income that period — e.g. a GSRTC vendor payment in a month with no GSRTC
      -- receipt, or a NULL-segment cost). Now every cost surfaces; Σ direct == dtot.
      -- A cost-only line shows inc=0 → net = −cost (an honest loss line, not hidden).
      FROM (
        SELECT seg,
               (CASE WHEN seg='GOVERNMENT' THEN 'Govt' WHEN seg='PRIVATE' THEN 'Pvt' ELSE 'Unassigned' END)
                 ||' · '||COALESCE(med,'Other') AS lbl,
               SUM(inc) AS inc, SUM(dcost) AS dcost
        FROM (
          SELECT segment AS seg, media_type AS med, amount AS inc, 0::numeric AS dcost   -- CRM income
            FROM public.finance_crm_income_rows(p_from, p_to, v_seg)
          UNION ALL
          SELECT segment AS seg, media_type AS med, 0::numeric AS inc, amount AS dcost   -- bank direct cost
            FROM public.finance_transactions
           WHERE bucket='direct_cost'
             AND (p_from IS NULL OR txn_date>=p_from) AND (p_to IS NULL OR txn_date<=p_to)
             AND (v_seg IS NULL OR segment=v_seg)
        ) u
        GROUP BY seg, med
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
        SELECT COALESCE(comp,'Unassigned') AS comp,
               COALESCE(SUM(inc),0) AS inc, COALESCE(SUM(dcost),0) AS dcost
          FROM (
            SELECT company AS comp, amount AS inc, 0::numeric AS dcost   -- CRM income
              FROM public.finance_crm_income_rows(p_from, p_to, v_seg)
            UNION ALL
            SELECT company AS comp, 0::numeric AS inc, amount AS dcost   -- bank direct cost
              FROM public.finance_transactions
             WHERE bucket='direct_cost'
               AND (p_from IS NULL OR txn_date>=p_from) AND (p_to IS NULL OR txn_date<=p_to)
               AND (v_seg IS NULL OR segment=v_seg)
          ) u GROUP BY 1
      ) pc), '[]'::jsonb),
    'revenue_mix', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', lbl, 'amount', amt,
               'pct', CASE WHEN itot>0 THEN round(amt/itot*100) ELSE 0 END) ORDER BY amt DESC)
      FROM (SELECT
              CASE WHEN media_type IS NOT NULL
                   THEN (CASE WHEN segment='GOVERNMENT' THEN 'Govt' ELSE 'Pvt' END)||' · '||media_type
                   ELSE COALESCE(company,'Other') END AS lbl,
              SUM(amount) amt
              FROM public.finance_crm_income_rows(p_from, p_to, v_seg)
             GROUP BY 1) m), '[]'::jsonb),
    'monthly', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('month', mth, 'income', COALESCE(inc,0), 'cost', COALESCE(cst,0)) ORDER BY mth)
      FROM (SELECT to_char(m,'YYYY-MM') mth, SUM(inc) inc, SUM(cst) cst
              FROM (
                SELECT txn_date AS m, amount AS inc, 0::numeric AS cst   -- CRM income
                  FROM public.finance_crm_income_rows(p_from, p_to, v_seg)
                UNION ALL
                SELECT txn_date AS m, 0::numeric AS inc, amount AS cst   -- bank costs
                  FROM public.finance_transactions
                 WHERE bucket IN ('direct_cost','common_expense')
                   AND (p_from IS NULL OR txn_date>=p_from) AND (p_to IS NULL OR txn_date<=p_to)
                   AND (v_seg IS NULL OR segment=v_seg OR segment IS NULL)
              ) x GROUP BY 1) mm), '[]'::jsonb),
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
      FROM (SELECT cat,
              COALESCE(SUM(inflow),0) inflow, COALESCE(SUM(outflow),0) outflow, SUM(n) n
              FROM (
                -- CRM income → inflow, categorized by media/company (same label as its direct_cost)
                SELECT CASE WHEN media_type='GSRTC_LED' THEN 'GSRTC'
                            WHEN media_type='AUTO_HOOD' THEN 'Auto Hood'
                            WHEN company='Untitled Adflux Pvt Ltd' THEN 'Untitled Adflux Pvt Ltd'
                            ELSE 'Untitled Advertising' END AS cat,
                       amount AS inflow, 0::numeric AS outflow, 1 AS n
                  FROM public.finance_crm_income_rows(p_from, p_to, v_seg)   -- §152: scope to the caller's segment
                UNION ALL
                -- everything EXCEPT income, from the bank ledger
                SELECT CASE
                         WHEN bucket='direct_cost' THEN
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
                       CASE WHEN direction='in'  THEN amount ELSE 0 END AS inflow,
                       CASE WHEN direction='out' THEN amount ELSE 0 END AS outflow,
                       1 AS n
                  FROM public.finance_transactions
                 WHERE bucket <> 'income'
                   AND (p_from IS NULL OR txn_date>=p_from) AND (p_to IS NULL OR txn_date<=p_to)
                   AND (v_seg IS NULL OR segment=v_seg OR segment IS NULL)   -- §152: keep org-wide (null-seg) rows, drop other-segment
              ) u GROUP BY 1) t), '[]'::jsonb),
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

-- VERIFY — your real P&L (plain query, matches what the app now shows):
--   income  = CRM won/collected deals (P3.3)   ·  cost = bank media + common
--   Business Profit below = income − cost − the commission accruals (VERIFY 2).
SELECT
  (SELECT COALESCE(SUM(amount),0) FROM public.finance_crm_income_rows())                                   AS crm_income_ex_gst,
  (SELECT COALESCE(SUM(amount),0) FROM public.finance_transactions WHERE bucket IN ('direct_cost','common_expense')) AS bank_cost,
  (SELECT COALESCE(SUM(amount),0) FROM public.finance_crm_income_rows())
    - (SELECT COALESCE(SUM(amount),0) FROM public.finance_transactions WHERE bucket IN ('direct_cost','common_expense')) AS before_commission,
  (SELECT COALESCE(SUM(amount),0) FROM public.finance_transactions WHERE bucket='income')                  AS bank_income_credits_reconcile_only,
  (SELECT count(*) FROM public.finance_transactions WHERE bucket='review')                                 AS review_rows;
-- (The RPCs are already installed from the CREATE OR REPLACE above — no re-run needed.)

-- VERIFY 2 — the commission the RPC now books (accruals from the CRM, not the bank):
--   govt_team  = SUM payments.commission_amount on won GOVERNMENT non-agency deals
--   agency     = SUM (payment ÷ total) × (subtotal × agency %) on won AGENCY-created deals
-- These reduce the app's Business Profit (below the bank-only operating_profit above).
SELECT
  (SELECT COALESCE(SUM(p.commission_amount),0)
     FROM public.payments p JOIN public.quotes q ON q.id=p.quote_id
     LEFT JOIN public.users u ON u.id=q.created_by
    WHERE q.segment='GOVERNMENT' AND q.status='won' AND COALESCE(p.commission_amount,0)>0
      AND COALESCE(u.role,'')<>'agency' AND p.approval_status='approved')                    AS commission_govt_team,
  (SELECT COALESCE(SUM((p.amount_received/NULLIF(q.total_amount,0))*(q.subtotal*COALESCE(u.agency_commission_percent,5)/100.0)),0)
     FROM public.payments p JOIN public.quotes q ON q.id=p.quote_id
     JOIN public.users u ON u.id=q.created_by
    WHERE q.status='won' AND COALESCE(u.role,'')='agency' AND p.approval_status='approved')  AS commission_agency;
