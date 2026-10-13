-- =====================================================================
-- employee_profitability(p_from, p_to)   [CANONICAL - section 71/72, Phase 364]
-- Per-employee profitability for the People module (admin + accounts only).
--   income_ex_gst = approved payments received in the period on quotes the person
--                   CREATED, with output GST stripped (x subtotal/total_amount, the
--                   same ratio the finance P&L uses, section 218). TDS stays in.
--   cost          = what the salary engine says the company owes for each month in the
--                   period: base + variable + incentive + TA/DA - leave deduction
--                   (= net_payable of compute_monthly_salaries, the ONE pay definition).
--   profit        = income_ex_gst - net_cost.
-- The range is rounded OUT to whole months (pay is monthly). Max 36 months.
-- Agency partners are not employees and are not listed.
-- NOTE: incentive is "paid so far" before Sept 2026 and "earned" from Sept 2026
-- (section 290 gate) - the engine's own rule, not changed here.
-- SECURITY DEFINER because RLS shows a user only their own quotes / pay. Read-only;
-- changes no pay. Fail-closed: no login / NULL role / not admin or accounts -> no rows.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.employee_profitability(p_from date, p_to date)
RETURNS TABLE(
  user_id uuid, name text, role text, designation text,
  income_ex_gst numeric,
  base numeric, variable numeric, incentive numeric, ta_da numeric, leave_cut numeric,
  net_cost numeric, profit numeric, months integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_role text;
  v_from date;
  v_to   date;
BEGIN
  SELECT u.role INTO v_role FROM public.users u WHERE u.id = auth.uid() AND u.is_active = true;
  IF v_role IS NULL OR v_role NOT IN ('admin','accounts') THEN RETURN; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from THEN RETURN; END IF;

  v_from := date_trunc('month', p_from)::date;
  v_to   := (date_trunc('month', p_to - 1)::date + interval '1 month')::date;
  IF v_to > (v_from + interval '36 months')::date THEN v_to := (v_from + interval '36 months')::date; END IF;

  RETURN QUERY
  WITH inc AS (
    SELECT q.created_by AS uid,
           round(sum(p.amount_received * COALESCE(NULLIF(q.subtotal,0)/NULLIF(q.total_amount,0), 1)))::numeric AS ex_gst
      FROM public.payments p
      JOIN public.quotes q ON q.id = p.quote_id
     WHERE p.approval_status = 'approved'
       AND p.payment_date >= v_from AND p.payment_date < v_to
     GROUP BY q.created_by
  ),
  cost AS (
    SELECT (r.result->>'user_id')::uuid AS uid,
           sum(COALESCE((r.result->>'base')::numeric,0))             AS b,
           sum(COALESCE((r.result->>'variable')::numeric,0))         AS v,
           sum(COALESCE((r.result->>'incentive')::numeric,0))        AS i,
           sum(COALESCE((r.result->>'ta_da')::numeric,0))            AS t,
           sum(COALESCE((r.result->>'unpaid_deduction')::numeric,0)) AS l,
           sum(COALESCE((r.result->>'net_payable')::numeric,0))      AS n,
           sum(CASE WHEN COALESCE((r.result->>'monthly_salary')::numeric,0) > 0 THEN 1 ELSE 0 END)::int AS mo
      FROM generate_series(v_from::timestamp, (v_to - 1)::timestamp, interval '1 month') AS gs(m),
           LATERAL public.compute_monthly_salaries(EXTRACT(year FROM gs.m)::int, EXTRACT(month FROM gs.m)::int) AS r
     GROUP BY 1
  )
  SELECT u.id, u.name::text, u.role::text, u.designation::text,
         COALESCE(inc.ex_gst,0),
         COALESCE(cost.b,0), COALESCE(cost.v,0), COALESCE(cost.i,0), COALESCE(cost.t,0),
         COALESCE(cost.l,0), COALESCE(cost.n,0),
         COALESCE(inc.ex_gst,0) - COALESCE(cost.n,0),
         COALESCE(cost.mo,0)
    FROM public.users u
    LEFT JOIN inc  ON inc.uid  = u.id
    LEFT JOIN cost ON cost.uid = u.id
   WHERE u.role <> 'agency'
     AND (COALESCE(inc.ex_gst,0) <> 0 OR COALESCE(cost.n,0) <> 0)
   ORDER BY COALESCE(inc.ex_gst,0) - COALESCE(cost.n,0) DESC;
END
$fn$;

REVOKE ALL ON FUNCTION public.employee_profitability(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_profitability(date, date) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';

-- VERIFY (tripwire - all TRUE):
-- SELECT pg_get_functiondef(p.oid) LIKE '%IN (''admin'',''accounts'')%'       AS admin_accounts_only,
--        pg_get_functiondef(p.oid) LIKE '%compute_monthly_salaries%'           AS uses_salary_engine,
--        pg_get_functiondef(p.oid) LIKE '%approval_status = ''approved''%'     AS counts_only_paid,
--        pg_get_functiondef(p.oid) LIKE '%role <> ''agency''%'                 AS agency_excluded,
--        p.prosecdef AS is_definer, NOT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_locked
--   FROM pg_proc p WHERE p.proname = 'employee_profitability';
