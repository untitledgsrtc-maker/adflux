-- READ-ONLY diagnostic — what drives the ₹20.29 lakh agency commission?
-- Per agency user: their commission %, how many won quotes they created, how
-- much has been collected, and the commission that produces. Sanity-check for
-- a bad rate (someone on 20/50% instead of 5) or a few huge legacy deals.

-- ============ 1) Per-agency-user breakdown (the main check) ============
SELECT u.name,
       u.agency_commission_percent                              AS pct,
       count(DISTINCT q.id)                                     AS won_quotes,
       COALESCE(SUM(p.amount_received),0)                       AS collected,
       COALESCE(SUM(q_sub.subtotal_once),0)                     AS subtotal_won,   -- deal base (per quote, not per payment)
       COALESCE(SUM(
         (p.amount_received / NULLIF(q.total_amount,0))
         * (q.subtotal * COALESCE(u.agency_commission_percent,5) / 100.0)
       ),0)                                                     AS commission
  FROM public.users u
  JOIN public.quotes q  ON q.created_by = u.id AND q.status = 'won'
  JOIN public.payments p ON p.quote_id = q.id AND p.approval_status = 'approved'
  LEFT JOIN LATERAL (SELECT q.subtotal AS subtotal_once) q_sub ON true
 WHERE COALESCE(u.role,'') = 'agency'
 GROUP BY u.name, u.agency_commission_percent
 ORDER BY commission DESC;

-- ============ 2) Any agency user with a suspicious (non-5%) rate? ============
SELECT name, agency_commission_percent
  FROM public.users
 WHERE COALESCE(role,'') = 'agency'
 ORDER BY agency_commission_percent DESC;

-- ============ 3) Top 10 individual agency won-quotes by commission ============
SELECT q.quote_number, u.name AS agency, u.agency_commission_percent AS pct,
       q.segment, q.subtotal, q.total_amount,
       COALESCE((SELECT SUM(p.amount_received) FROM public.payments p
                  WHERE p.quote_id=q.id AND p.approval_status='approved'),0) AS collected,
       COALESCE((SELECT SUM((p.amount_received/NULLIF(q.total_amount,0))
                           *(q.subtotal*COALESCE(u.agency_commission_percent,5)/100.0))
                   FROM public.payments p
                  WHERE p.quote_id=q.id AND p.approval_status='approved'),0) AS commission
  FROM public.quotes q
  JOIN public.users u ON u.id = q.created_by AND COALESCE(u.role,'')='agency'
 WHERE q.status='won'
 ORDER BY commission DESC
 LIMIT 10;
