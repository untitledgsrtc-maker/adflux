-- supabase_phase118_chase_counts_outstanding.sql
-- Phase 118 (2026-06-05) — extend my_chase_counts() with the ₹ amount
-- outstanding on won-but-unpaid quotes, for the Sales Day Summary
-- "Quote outstanding: N · ₹X" line.
--
-- WHY: the day summary needs both the COUNT (already returned as
-- pay_chase) and the rupee value still to collect. payments are gated by
-- payments_sales_read_own (sales only) so a telecaller/co-owner client
-- query can't compute it; this SECURITY DEFINER fn already sums approved
-- payments server-side, so we add one more aggregate column. Self-scoped
-- to auth.uid() — no parameter, nothing to spoof.
--
-- Idempotent: CREATE OR REPLACE. Additive — adds a 3rd OUT column.
-- Existing callers that read quote_chase / pay_chase are unaffected
-- (extra column is ignored by positional/by-name reads).

-- Phase 118 — adding the 3rd OUT column (pay_outstanding) CHANGES the
-- return type, so CREATE OR REPLACE alone errors 42P13. DROP first.
-- Safe: callers resolve the RPC at call time; REVOKE/GRANT re-applied
-- below; nothing depends on the old signature.
DROP FUNCTION IF EXISTS public.my_chase_counts();

CREATE OR REPLACE FUNCTION public.my_chase_counts()
RETURNS TABLE(quote_chase int, pay_chase int, pay_outstanding numeric)
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
    ) AS pay_chase,
    (SELECT COALESCE(SUM(
              q.total_amount - COALESCE(
                (SELECT SUM(p.amount_received)
                   FROM public.payments p
                  WHERE p.quote_id = q.id
                    AND (p.approval_status IS NULL OR p.approval_status = 'approved')),
                0)
            ), 0)::numeric
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
    ) AS pay_outstanding;
$function$;

REVOKE ALL ON FUNCTION public.my_chase_counts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_chase_counts() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────────
-- (a) Function now returns 3 columns, still hardened:
SELECT
  p.proname,
  p.prosecdef                                           AS security_definer,
  (pg_get_functiondef(p.oid) ILIKE '%pay_outstanding%') AS has_outstanding_col,
  (pg_get_functiondef(p.oid) ILIKE '%auth.uid()%')      AS self_scoped
FROM pg_proc p
WHERE p.proname = 'my_chase_counts';
-- Expected: security_definer=t, has_outstanding_col=t, self_scoped=t.

-- (b) Run it as the current session — one row, three values:
SELECT * FROM public.my_chase_counts();
