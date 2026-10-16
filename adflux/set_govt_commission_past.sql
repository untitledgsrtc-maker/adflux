-- Set govt commission % on PAST won govt quotes.
-- Commission = per-deal %, so set it per deal (rates can differ).
-- Reminder: the commission COST only SHOWS once the deal has APPROVED PAYMENTS
-- recorded (the accrual is proportional to collection). No payments yet = % is
-- stored but nothing books until money is recorded against the quote.

-- ============ 1) LIST the past won govt deals (read-only, run first) ============
SELECT q.ref_number,
       q.client_company,
       q.subtotal,
       q.total_amount,
       q.govt_commission_percent            AS current_pct,
       u.role                               AS creator_role,   -- 'agency' rows are auto-excluded by the P&L (they use agency commission)
       COALESCE((SELECT SUM(p.amount_received) FROM public.payments p
                  WHERE p.quote_id=q.id AND p.approval_status='approved'),0) AS collected
  FROM public.quotes q
  LEFT JOIN public.users u ON u.id=q.created_by
 WHERE q.segment='GOVERNMENT' AND q.status='won'
 ORDER BY q.ref_number;

-- ============ 2a) SET one deal's % (edit the ref + the number) ============
-- UPDATE public.quotes SET govt_commission_percent = 10
--  WHERE ref_number = 'UA/GSRTC/2026-27/0134';

-- ============ 2b) OR bulk-set every past won govt deal to ONE rate ============
-- (only if the same % applies to all; leaves any you already set alone)
-- UPDATE public.quotes SET govt_commission_percent = 10
--  WHERE segment='GOVERNMENT' AND status='won' AND govt_commission_percent IS NULL;

-- ============ 3) VERIFY ============
-- SELECT ref_number, govt_commission_percent FROM public.quotes
--  WHERE segment='GOVERNMENT' AND status='won' AND govt_commission_percent IS NOT NULL
--  ORDER BY ref_number;
