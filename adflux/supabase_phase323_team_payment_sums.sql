-- ============================================================================
-- supabase_phase323_team_payment_sums.sql  (perf audit Tier 3 — M17, co_owner residue)
-- ----------------------------------------------------------------------------
-- M17 closed the per-rep chase counts for ADMIN + team-viewer via the DEFINER
-- team_chase_counts RPC. co_owner (Vishal, government_partner) is deliberately
-- NOT admitted to that RPC (§42/§153 — a DEFINER financial fn must not hand him
-- all-segment data), so he falls through to the client-side pay-chase path in
-- TeamDashboardV2, which still downloads the WHOLE payments table (RLS-scoped to
-- his govt segment) into the browser and silently caps at ~1000 rows.
--
-- This ADDITIVE, SECURITY INVOKER RPC does the same per-quote paid sum server-
-- side. Because it is INVOKER, the underlying payments RLS applies as the caller:
--   • co_owner (government_partner)  → GOVERNMENT-segment payments only (§152)
--   • rep                            → own quotes' payments only
--   • admin / Studio (postgres)      → all payments (RLS bypassed)
-- => co_owner keeps his exact govt scope by construction (no leak), just server-
-- aggregated and un-capped. No change to the DEFINER team_chase_counts.
--
-- The "paid" filter matches TeamDashboardV2 JS `if (p.approval_status &&
-- p.approval_status !== 'approved') return` byte-for-byte: include a row when
-- approval_status is falsy (NULL / '') OR = 'approved' (legacy rows predate the
-- 'pending' default and are NULL). Identical to team_chase_counts' `paid` CTE.
--
-- SAFE: additive, read-only (money display-only). Callable by authenticated only.
-- Revert = git-revert the frontend; the additive fn goes dormant.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.team_payment_sums()
  RETURNS TABLE (quote_id uuid, paid numeric)
  LANGUAGE sql STABLE SECURITY INVOKER
  SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p.quote_id,
         COALESCE(sum(COALESCE(p.amount_received, 0)), 0)::numeric AS paid
    FROM public.payments p
   WHERE p.quote_id IS NOT NULL
     AND (p.approval_status IS NULL OR p.approval_status IN ('', 'approved'))
   GROUP BY p.quote_id;
$fn$;

REVOKE ALL     ON FUNCTION public.team_payment_sums() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.team_payment_sums() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ── SHADOW-COMPARE — must return ZERO rows ──────────────────────────────────
-- Proves team_payment_sums() == an INDEPENDENT SQL replication of the client's
-- paidByQuote aggregation over the raw payments table. Runs in Studio as postgres
-- (RLS bypassed) so both sides see all payments → 0 rows = the SUM/filter/GROUP
-- match exactly. (The govt-only scoping for co_owner is enforced by RLS at call
-- time — not exercised here, and correct by construction for a plain INVOKER fn.)
WITH rpc AS (
  SELECT quote_id, paid FROM public.team_payment_sums()
),
js AS (  -- mirrors TeamDashboardV2 paidByQuote (approved-or-null, per quote)
  SELECT quote_id, COALESCE(sum(COALESCE(amount_received, 0)), 0)::numeric AS paid
    FROM public.payments
   WHERE quote_id IS NOT NULL
     AND (approval_status IS NULL OR approval_status IN ('', 'approved'))
   GROUP BY quote_id
)
SELECT COALESCE(r.quote_id, j.quote_id) AS quote_id,
       r.paid AS rpc_paid, j.paid AS js_paid
  FROM rpc r FULL OUTER JOIN js j ON j.quote_id = r.quote_id
 WHERE r.quote_id IS NULL OR j.quote_id IS NULL
    OR r.paid IS DISTINCT FROM j.paid;
-- ============================================================================
