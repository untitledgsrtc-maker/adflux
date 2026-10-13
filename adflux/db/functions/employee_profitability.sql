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
-- p_segment = NULL (all) | 'PRIVATE' | 'GOVERNMENT'. For a segment, income = that segment's
-- income, and the person's pay is ATTRIBUTED to the segment in proportion to the income they
-- brought from it (if no income in the period: by the share of quotes they created, not drafts;
-- if neither: not attributed). So Private + Government cost add up to All for the earning team.
-- Support staff (no income, no quotes) appear only under All - their pay is overhead.
-- Agency partners are not employees and are not listed.
-- NOTE: incentive is "paid so far" before Sept 2026 and "earned" from Sept 2026
-- (section 290 gate) - the engine's own rule, not changed here.
-- SECURITY DEFINER because RLS shows a user only their own quotes / pay. Read-only;
-- changes no pay. Fail-closed: no login / NULL role / not admin or accounts -> no rows.
-- =====================================================================
DROP FUNCTION IF EXISTS public.employee_profitability(date, date);
CREATE OR REPLACE FUNCTION public.employee_profitability(p_from date, p_to date, p_segment text DEFAULT NULL)
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
  v_seg  text := CASE WHEN upper(coalesce(p_segment,'')) IN ('PRIVATE','GOVERNMENT') THEN upper(p_segment) ELSE NULL END;
BEGIN
  SELECT u.role INTO v_role FROM public.users u WHERE u.id = auth.uid() AND u.is_active = true;
  IF v_role IS NULL OR v_role NOT IN ('admin','accounts') THEN RETURN; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from THEN RETURN; END IF;

  v_from := date_trunc('month', p_from)::date;
  v_to   := (date_trunc('month', p_to - 1)::date + interval '1 month')::date;
  IF v_to > (v_from + interval '36 months')::date THEN v_to := (v_from + interval '36 months')::date; END IF;

  RETURN QUERY
  WITH inc AS (
    SELECT q.created_by AS uid, q.segment AS seg,
           round(sum(p.amount_received * COALESCE(NULLIF(q.subtotal,0)/NULLIF(q.total_amount,0), 1)))::numeric AS ex_gst
      FROM public.payments p
      JOIN public.quotes q ON q.id = p.quote_id
     WHERE p.approval_status = 'approved'
       AND p.payment_date >= v_from AND p.payment_date < v_to
     GROUP BY q.created_by, q.segment
  ),
  inc_t AS (SELECT uid, sum(ex_gst) AS tot FROM inc GROUP BY uid),
  qs AS (
    SELECT q.created_by AS uid, q.segment AS seg, count(*)::numeric AS n
      FROM public.quotes q
     WHERE q.status <> 'draft' AND q.created_at >= v_from AND q.created_at < v_to
     GROUP BY q.created_by, q.segment
  ),
  qs_t AS (SELECT uid, sum(n) AS tot FROM qs GROUP BY uid),
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
  ),
  j AS (
    SELECT u.id, u.name, u.role, u.designation,
           COALESCE(it.tot,0) AS inc_all,
           COALESCE((SELECT i2.ex_gst FROM inc i2 WHERE i2.uid = u.id AND i2.seg = v_seg),0) AS inc_seg,
           -- share of this person's pay that belongs to the chosen segment
           CASE WHEN v_seg IS NULL THEN 1::numeric
                WHEN COALESCE(it.tot,0) > 0
                  THEN COALESCE((SELECT i2.ex_gst FROM inc i2 WHERE i2.uid = u.id AND i2.seg = v_seg),0) / it.tot
                WHEN COALESCE(qt.tot,0) > 0
                  THEN COALESCE((SELECT q2.n FROM qs q2 WHERE q2.uid = u.id AND q2.seg = v_seg),0) / qt.tot
                ELSE 0 END AS w,
           COALESCE(c.b,0) b, COALESCE(c.v,0) v, COALESCE(c.i,0) i, COALESCE(c.t,0) t,
           COALESCE(c.l,0) l, COALESCE(c.n,0) n, COALESCE(c.mo,0) mo
      FROM public.users u
      LEFT JOIN inc_t it ON it.uid = u.id
      LEFT JOIN qs_t  qt ON qt.uid = u.id
      LEFT JOIN cost  c  ON c.uid  = u.id
     WHERE u.role <> 'agency'
  )
  SELECT j.id, j.name::text, j.role::text, j.designation::text,
         CASE WHEN v_seg IS NULL THEN j.inc_all ELSE j.inc_seg END,
         round(j.b * j.w, 2), round(j.v * j.w, 2), round(j.i * j.w, 2), round(j.t * j.w, 2),
         round(j.l * j.w, 2), round(j.n * j.w, 2),
         (CASE WHEN v_seg IS NULL THEN j.inc_all ELSE j.inc_seg END) - round(j.n * j.w, 2),
         j.mo
    FROM j
   WHERE (CASE WHEN v_seg IS NULL THEN j.inc_all ELSE j.inc_seg END) <> 0 OR round(j.n * j.w, 2) <> 0
   ORDER BY (CASE WHEN v_seg IS NULL THEN j.inc_all ELSE j.inc_seg END) - round(j.n * j.w, 2) DESC;
END
$fn$;

REVOKE ALL ON FUNCTION public.employee_profitability(date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_profitability(date, date, text) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';

-- VERIFY (tripwire - all TRUE):
-- SELECT pg_get_functiondef(p.oid) LIKE '%IN (''admin'',''accounts'')%'       AS admin_accounts_only,
--        pg_get_functiondef(p.oid) LIKE '%compute_monthly_salaries%'           AS uses_salary_engine,
--        pg_get_functiondef(p.oid) LIKE '%approval_status = ''approved''%'     AS counts_only_paid,
--        pg_get_functiondef(p.oid) LIKE '%role <> ''agency''%'                 AS agency_excluded,
--        p.prosecdef AS is_definer, NOT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_locked
--   FROM pg_proc p WHERE p.proname = 'employee_profitability';
