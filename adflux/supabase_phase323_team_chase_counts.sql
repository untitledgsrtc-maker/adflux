-- ============================================================================
-- supabase_phase323_team_chase_counts.sql  (perf audit Tier 3 — H4/H7/M17/M21)
-- ----------------------------------------------------------------------------
-- The Team Live dashboard (constantly open) downloads ALL sent quotes + ALL won
-- quotes + the WHOLE payments table on every load, then derives per-rep chase
-- counts in JS. All three hit the ~1000-row cap (silent under-count at scale) and
-- it's a big download on a hot page. This ADDITIVE RPC aggregates the SAME logic
-- in Postgres and returns ~1 row per rep.
--
-- Logic verified byte-for-byte against TeamDashboardV2.jsx (L631-668):
--   quote_chase = quotes status='sent', updated_at < (period_end − 3 days), per created_by
--   pay_chase   = quotes status='won', total>0, SUM(approved-or-null payments) < total, per created_by
-- The client fetches sent/won quotes + payments UNFILTERED (admin RLS = full team),
-- so this DEFINER RPC returns the identical row set for admin.
--
-- SAFE: additive, read-only (money_risk display-only). Gate = is_team_viewer() OR
-- admin (co_owner/Vishal is NOT admitted — §42/§153; he keeps his RLS-scoped raw
-- path). NULL role (Studio/service, no JWT) is permitted so the SHADOW-COMPARE
-- runs — a real logged-in non-admin non-viewer rep has a non-null role → gate
-- FALSE → 0 rows (they use their own path). Revert = git-revert the frontend.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.team_chase_counts(p_period_end date)
  RETURNS TABLE (created_by uuid, quote_chase bigint, pay_chase bigint)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $fn$
  WITH gate AS (
    SELECT (public.is_team_viewer()
            OR public.get_my_role() IS NULL                      -- Studio/service (shadow) — trusted
            OR COALESCE(public.get_my_role() = 'admin', false)) AS ok
  ),
  qc AS (  -- quote-chase: sent + stale >3d before period end (TeamDashboardV2 L636-644)
    SELECT q.created_by AS uid, count(*)::bigint AS n
      FROM public.quotes q CROSS JOIN gate
     WHERE gate.ok AND q.status = 'sent' AND q.created_by IS NOT NULL
       AND q.updated_at IS NOT NULL
       AND q.updated_at < ((p_period_end::timestamp AT TIME ZONE 'UTC') - interval '3 days')
     GROUP BY q.created_by
  ),
  paid AS (  -- SUM(amount_received) FILTER approved-or-null, per quote (L651-655)
    SELECT p.quote_id, sum(COALESCE(p.amount_received, 0)) AS total_paid
      FROM public.payments p CROSS JOIN gate
     WHERE gate.ok AND p.quote_id IS NOT NULL
       AND (p.approval_status IS NULL OR p.approval_status IN ('', 'approved'))
     GROUP BY p.quote_id
  ),
  pc AS (  -- pay-chase: won + total>0 + paid<total (L657-666)
    SELECT q.created_by AS uid, count(*)::bigint AS n
      FROM public.quotes q CROSS JOIN gate
      LEFT JOIN paid ON paid.quote_id = q.id
     WHERE gate.ok AND q.status = 'won' AND q.created_by IS NOT NULL
       AND COALESCE(q.total_amount, 0) > 0
       AND COALESCE(paid.total_paid, 0) < COALESCE(q.total_amount, 0)
     GROUP BY q.created_by
  )
  SELECT u.uid, COALESCE(qc.n, 0)::bigint, COALESCE(pc.n, 0)::bigint
    FROM (SELECT uid FROM qc UNION SELECT uid FROM pc) u
    LEFT JOIN qc ON qc.uid = u.uid
    LEFT JOIN pc ON pc.uid = u.uid;
$fn$;
REVOKE ALL     ON FUNCTION public.team_chase_counts(date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.team_chase_counts(date) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ── SHADOW-COMPARE — must return ZERO rows ──────────────────────────────────
-- Proves team_chase_counts(period_end) == an INDEPENDENT SQL replication of the
-- JS chase logic over the raw tables, per rep. Set p_end to a real period end
-- (the /team-dashboard "to" date, YYYY-MM-DD). 0 rows = the RPC matches the
-- client logic exactly. (Runs in Studio via the NULL-role gate permit.)
WITH params AS (SELECT DATE '2026-08-25' AS p_end),
rpc AS (
  SELECT r.created_by AS uid, r.quote_chase, r.pay_chase
    FROM params p CROSS JOIN LATERAL public.team_chase_counts(p.p_end) r
),
js_qc AS (
  SELECT q.created_by AS uid, count(*)::bigint AS n
    FROM params p, public.quotes q
   WHERE q.status = 'sent' AND q.created_by IS NOT NULL AND q.updated_at IS NOT NULL
     AND q.updated_at < ((p.p_end::timestamp AT TIME ZONE 'UTC') - interval '3 days')
   GROUP BY q.created_by
),
js_paid AS (
  SELECT quote_id, sum(COALESCE(amount_received, 0)) AS paid
    FROM public.payments
   WHERE quote_id IS NOT NULL AND (approval_status IS NULL OR approval_status IN ('', 'approved'))
   GROUP BY quote_id
),
js_pc AS (
  SELECT q.created_by AS uid, count(*)::bigint AS n
    FROM public.quotes q LEFT JOIN js_paid jp ON jp.quote_id = q.id
   WHERE q.status = 'won' AND q.created_by IS NOT NULL
     AND COALESCE(q.total_amount, 0) > 0
     AND COALESCE(jp.paid, 0) < COALESCE(q.total_amount, 0)
   GROUP BY q.created_by
),
js AS (
  SELECT u.uid, COALESCE(js_qc.n, 0) AS quote_chase, COALESCE(js_pc.n, 0) AS pay_chase
    FROM (SELECT uid FROM js_qc UNION SELECT uid FROM js_pc) u
    LEFT JOIN js_qc ON js_qc.uid = u.uid
    LEFT JOIN js_pc ON js_pc.uid = u.uid
)
SELECT COALESCE(r.uid, j.uid) AS uid,
       r.quote_chase AS rpc_qc, j.quote_chase AS js_qc,
       r.pay_chase   AS rpc_pc, j.pay_chase   AS js_pc
  FROM rpc r FULL OUTER JOIN js j ON j.uid = r.uid
 WHERE r.uid IS NULL OR j.uid IS NULL
    OR r.quote_chase IS DISTINCT FROM j.quote_chase
    OR r.pay_chase   IS DISTINCT FROM j.pay_chase;
-- ============================================================================
