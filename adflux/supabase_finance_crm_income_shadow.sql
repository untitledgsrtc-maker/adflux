-- =====================================================================
-- FINANCE — CRM INCOME · SHADOW-COMPARE (owner-verify gate, §71 rule 3)
-- 2026-08-22 · Owner directive: P&L income = CRM won/collected deals, NOT
-- bank credits. Today income reads finance_transactions bucket='income'
-- (the bank ledger). Deleting the bank Excel zeroed income, but commission
-- (already CRM-derived) stayed → the misleading −₹34.66L "loss" with ₹0
-- income. This makes income read the SAME CRM won deals the commission
-- reads, so revenue and its commission cost come from one place.
--
-- THIS FILE IS SAFE TO RUN. It does TWO things:
--   1. Creates finance_crm_income_rows() — a helper that returns CRM
--      collected revenue shaped exactly like the P&L income reads.
--      NOTHING live uses it yet, so the P&L is UNCHANGED after you run this.
--   2. Runs read-only SHADOW queries so you SEE the CRM income number and
--      confirm it matches your real won revenue BEFORE we swap the live P&L.
--
-- INCOME BASIS (matches the commission model, §171 "as the client pays"):
--   collected revenue = SUM(payments.amount_received) over APPROVED payments
--   on WON quotes, dated by payment_date, split by the quote's segment +
--   media_type. Govt amount_received is the GROSS (net + TDS, Phase 274) =
--   the deal's true collected worth. Same population the commission uses →
--   revenue and commission finally reconcile.
-- =====================================================================

-- ══════════════ PART 1 · the CRM-income helper (additive, harmless) ══════════════
-- Returns one row per approved payment on a won deal, shaped like the P&L's
-- income reads: (segment, media_type, company, amount, txn_date). The Step-2
-- swap will point every income block at this function.
CREATE OR REPLACE FUNCTION public.finance_crm_income_rows(
  p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_seg text DEFAULT NULL
) RETURNS TABLE(segment text, media_type text, company text, amount numeric, txn_date date)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
  SELECT
    q.segment,
    q.media_type,
    CASE q.segment WHEN 'GOVERNMENT' THEN 'Untitled Advertising'
                   WHEN 'PRIVATE'    THEN 'Untitled Adflux Pvt Ltd'
                   ELSE NULL END,
    -- EX-GST revenue (strip output GST via subtotal/total, §273); TDS stays in.
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
$fn$;
-- SECURITY DEFINER + role-blind → NOT client-callable. finance_pnl_summary calls
-- it internally (same owner). REVOKE closes the §8/§152 all-segment revenue leak.
REVOKE EXECUTE ON FUNCTION public.finance_crm_income_rows(date,date,text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.finance_crm_income_rows(date,date,text) TO service_role;

NOTIFY pgrst, 'reload schema';

-- ══════════════ PART 2 · SHADOW — run these, read the numbers ══════════════

-- 2a · TOTAL: what the P&L shows NOW (bank) vs what it WOULD show (CRM).
--      Bank is ~₹0 (you deleted the Excel); CRM is your real collected won revenue.
SELECT
  (SELECT COALESCE(SUM(amount),0) FROM public.finance_transactions WHERE bucket='income')  AS bank_income_now,
  (SELECT COALESCE(SUM(amount),0) FROM public.finance_crm_income_rows())                   AS crm_income_new,
  (SELECT COALESCE(SUM(amount),0) FROM public.finance_crm_income_rows())
    - (SELECT COALESCE(SUM(amount),0) FROM public.finance_transactions WHERE bucket='income') AS difference;

-- 2b · CRM income by SEGMENT × MEDIA (the lines that will show on the P&L).
--      Eyeball each line against your known won deals.
SELECT
  segment,
  COALESCE(media_type,'(none)')                       AS media_type,
  count(*)                                             AS payments,
  round(SUM(amount))                                  AS crm_income
FROM public.finance_crm_income_rows()
GROUP BY 1,2
ORDER BY SUM(amount) DESC;

-- 2c · CRM income by MONTH (the trend line).
SELECT
  to_char(txn_date,'YYYY-MM')   AS month,
  count(*)                      AS payments,
  round(SUM(amount))            AS crm_income
FROM public.finance_crm_income_rows()
GROUP BY 1
ORDER BY 1;

-- 2d · RECONCILE against the commission you already see. Commission is CRM
--      (won deals); with CRM income the P&L will show BOTH the revenue AND
--      its commission from the same deals. This proves they line up.
SELECT
  round((SELECT COALESCE(SUM(amount),0) FROM public.finance_crm_income_rows()))         AS crm_income,
  round((SELECT COALESCE(SUM(commission_amount),0)                                       -- govt-team commission (§273)
           FROM public.payments p JOIN public.quotes q ON q.id=p.quote_id
          WHERE q.segment='GOVERNMENT' AND q.status='won' AND p.approval_status='approved'
            AND COALESCE(p.commission_amount,0)>0))                                       AS commission_govt_team,
  round((SELECT COALESCE(SUM(
             (p.amount_received / NULLIF(q.total_amount,0)) * (q.subtotal * COALESCE(u.agency_commission_percent,5)/100.0)
           ),0)                                                                           -- agency commission (§171)
           FROM public.payments p JOIN public.quotes q ON q.id=p.quote_id
           JOIN public.users u ON u.id=q.created_by
          WHERE q.status='won' AND COALESCE(u.role,'')='agency' AND p.approval_status='approved')) AS commission_agency;

-- ── VERIFY the helper exists ──
-- SELECT to_regprocedure('public.finance_crm_income_rows(date,date,text)') IS NOT NULL AS helper_ready;
