-- supabase_phase113_13_my_chase_counts_rpc.sql
-- Phase 113.13 (2026-06-05) — my_chase_counts() RPC for the telecaller's
-- "Quote chase" + "Pay chase" KPI tiles (parity with the sales card).
--
-- WHY AN RPC: pay-chase needs the payments table, but the only rep-facing
-- read policy is `payments_sales_read_own` (role='sales' ONLY). A telecaller
-- cannot read payments, so an inline client query would return 0 payments →
-- every WON quote would look unpaid → pay-chase massively over-counts. This
-- SECURITY DEFINER function computes both counts SERVER-SIDE, scoped to the
-- CALLER's own quotes (created_by = auth.uid()), and returns ONLY the two
-- integers — no financial rows ever reach the client.
--
-- Definitions (mirror TeamDashboardV2 / Phase 82):
--   quote_chase = my 'sent' quotes whose updated_at is older than 3 days
--                 ("you sent it, nobody chased — follow up").
--   pay_chase   = my 'won' quotes whose summed APPROVED payments are still
--                 less than total_amount (won but not fully collected).
--
-- SECURITY: self-scoped — there is NO parameter, so a caller can only ever
-- get their OWN counts (auth.uid()). No _assert_self_or_admin needed; there's
-- nothing to spoof. SET search_path = public, pg_temp (F-104 hardening).
-- Idempotent (CREATE OR REPLACE). Additive — no existing object touched.

CREATE OR REPLACE FUNCTION public.my_chase_counts()
RETURNS TABLE(quote_chase int, pay_chase int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT
    (SELECT COUNT(*)::int
       FROM public.quotes q
      WHERE q.created_by = auth.uid()
        AND q.status     = 'sent'
        AND q.updated_at < (now() - interval '3 days')
    ) AS quote_chase,
    (SELECT COUNT(*)::int
       FROM public.quotes q
      WHERE q.created_by = auth.uid()
        AND q.status     = 'won'
        AND COALESCE(q.total_amount, 0) > 0
        AND COALESCE(
              (SELECT SUM(p.amount_received)
                 FROM public.payments p
                WHERE p.quote_id = q.id
                  AND (p.approval_status IS NULL OR p.approval_status = 'approved')),
              0
            ) < q.total_amount
    ) AS pay_chase;
$function$;

-- §41 DEFINER-fleet convention: revoke the implicit PUBLIC execute, then
-- grant only to authenticated. (Self-scoped anyway — an anon caller with
-- auth.uid() = NULL just gets (0,0) — but keep parity with the 97.2 RPCs.)
REVOKE ALL ON FUNCTION public.my_chase_counts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_chase_counts() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────────
-- (a) Function exists, SECURITY DEFINER + pg_temp hardening present:
SELECT
  p.proname,
  p.prosecdef                                   AS security_definer,
  (pg_get_functiondef(p.oid) ILIKE '%public, pg_temp%') AS pg_temp_hardening,
  (pg_get_functiondef(p.oid) ILIKE '%auth.uid()%')      AS self_scoped
FROM pg_proc p
WHERE p.proname = 'my_chase_counts';
-- Expected: security_definer=t, pg_temp_hardening=t, self_scoped=t.

-- (b) Run it as the current session (admin returns own counts; a rep returns
--     their own). Returns exactly one row with two integers:
SELECT * FROM public.my_chase_counts();
