-- ============================================================================
-- db/functions/rebuild_monthly_sales.sql — CANONICAL HOME (Phase 178 / Stage 2)
-- ============================================================================
--
-- ⭐ The ONE place rebuild_monthly_sales is allowed to live. EDIT THIS FILE to
--    change it; never re-paste it into a new phaseN file (§71). It lived in 2
--    files (phase2_additions, phase3c).
--
-- 💰 MONEY — the SALES LEDGER CORE. For a (staff, month) it recomputes
--    monthly_sales_data from scratch: sum of subtotal over APPROVED FINAL payments,
--    split new_client_revenue vs renewal_revenue by quote.revenue_type, credited to
--    the quote creator. monthly_sales_data feeds incentive (compute_monthly_salary's
--    sales_manager override + the frontend calculateIncentive). Called by all 3
--    payment handlers (insert/update/delete triggers) AND directly by the frontend
--    (usePayments / AdminDashboardDesktop / GovtProposalDetailV2 via rpc). Capture,
--    not change — byte-for-byte the live function (dumped 2026-06-24), zero DB run.
--
-- LOCKED CONTRACT (a diff that changes any is owner-sign-off):
--    • only payments with is_final_payment=true AND approval_status='approved' count
--      (the phase3c filter — the earlier phase2 version had NO approval check).
--    • split by quotes.revenue_type: 'new' -> new_client_revenue, 'renewal' ->
--      renewal_revenue. Credited to quotes.created_by = p_staff.
--    • month match via to_char(payment_date,'YYYY-MM') = p_month.
--    • ON CONFLICT (staff_id, month_year) upsert — a full rebuild, idempotent (this
--      is WHY the payment handlers can call it freely on every change).
--
-- PROVENANCE: captured byte-for-byte from the LIVE DB 2026-06-24 (the phase3c
--    version with the approved-only filter). Single signature (uuid, text). It is a
--    PLAIN function (not SECURITY DEFINER) — runs as the caller, RLS applies.
--    Running this file is a NO-OP.
--
-- SUPERSEDES (Phase 178 removed the body from both):
--      phase2_additions.sql                 (the older no-approval-filter version)
--      supabase_phase3c.sql                 (the live approved-only version)
--
-- REVERT: re-run this file. TRIPWIRE: VERIFY block at the bottom.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rebuild_monthly_sales(p_staff uuid, p_month text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  new_rev numeric := 0;
  ren_rev numeric := 0;
BEGIN
  SELECT
    COALESCE(SUM(CASE WHEN q.revenue_type = 'new'     THEN q.subtotal ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN q.revenue_type = 'renewal' THEN q.subtotal ELSE 0 END), 0)
  INTO new_rev, ren_rev
  FROM payments p
  JOIN quotes q ON q.id = p.quote_id
  WHERE p.is_final_payment = true
    AND p.approval_status  = 'approved'   -- NEW: approved only
    AND q.created_by       = p_staff
    AND to_char(p.payment_date, 'YYYY-MM') = p_month;

  INSERT INTO monthly_sales_data (staff_id, month_year, new_client_revenue, renewal_revenue)
  VALUES (p_staff, p_month, new_rev, ren_rev)
  ON CONFLICT (staff_id, month_year)
  DO UPDATE SET
    new_client_revenue = EXCLUDED.new_client_revenue,
    renewal_revenue    = EXCLUDED.renewal_revenue,
    updated_at         = now();
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rebuild_monthly_sales(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY / TRIPWIRE — read-only. All five must be TRUE.
-- ============================================================================
-- SELECT
--   pg_get_functiondef(p.oid) LIKE '%is_final_payment = true%'        AS final_only,
--   pg_get_functiondef(p.oid) LIKE '%approval_status  = ''approved''%' AS approved_only,
--   pg_get_functiondef(p.oid) LIKE '%revenue_type = ''new''%'          AS new_split,
--   pg_get_functiondef(p.oid) LIKE '%revenue_type = ''renewal''%'      AS renewal_split,
--   pg_get_functiondef(p.oid) LIKE '%ON CONFLICT (staff_id, month_year)%' AS idempotent_upsert
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = 'rebuild_monthly_sales';
