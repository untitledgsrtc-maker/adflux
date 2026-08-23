-- =====================================================================
-- FINANCE P7 — two-way bank↔CRM reconciliation (2026-08-22)
-- Owner: "reconcile view — see each CRM receipt matched to a bank credit,
-- flag both ways, one-tap match/ignore." After P3.3 (§218 income = CRM),
-- the PRIMARY integrity check flipped: it is no longer only "is every bank
-- credit in the CRM?" but "does every CRM receipt I count as revenue have a
-- matching bank credit?" (a CRM payment with no bank credit = revenue that
-- never actually hit the bank). This file makes finance_reconcile TWO-WAY
-- and adds a gated match/ignore action so a resolved row drops off.
--
-- ADDITIVE + §45-safe: one new nullable column, edit-in-place finance_reconcile
-- (§71 canonical moves here — the p5_p6 copy is neutered to a pointer), one new
-- gated write RPC. No live rep flow, no P&L income source change.
-- Run this whole file once in Supabase Studio.
-- =====================================================================

-- ══════════════ part 1 · the ignore flag (bank credit that is NOT a sales receipt) ══════════════
ALTER TABLE public.finance_transactions
  ADD COLUMN IF NOT EXISTS reconcile_ignored boolean NOT NULL DEFAULT false;

-- ══════════════ part 2 · finance_reconcile — now TWO-WAY ══════════════
-- Returns:
--   bank_income_total     Σ bank income credits in range (segment-scoped)
--   crm_receipts_total    Σ ALL approved CRM payments in range (gross)
--   crm_income_won_total  Σ approved payments on WON quotes (the number that
--                         ties to the P&L income population, §218)
--   gap                   bank − crm_won
--   unmatched[]           BANK credits with no matching/linked CRM payment and
--                         not ignored — "in the bank, not in the CRM". (id, date,
--                         amount, description, segment)
--   unmatched_crm[]       approved payments on WON quotes with no near-matching
--                         and no hand-linked bank credit — "recorded in the CRM,
--                         not seen in the bank" (the primary integrity check).
--                         (payment_id, date, amount, ref, client, segment)
--   unmatched_count / unmatched_crm_count
-- Match on GROSS amount_received (bank credits are GST-inclusive). Same
-- ±₹50/±1% within ±7 days rule both directions. Segment-scoped (Vishal = govt).
CREATE OR REPLACE FUNCTION public.finance_reconcile(
  p_from date DEFAULT NULL, p_to date DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_role text := public.get_my_role();
  v_gp   boolean := EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.team_role = 'government_partner');
  v_seg  text := NULL;   -- NULL = both segments (admin / accounts)
  v_bank numeric; v_crm numeric; v_crm_won numeric; v_un jsonb; v_un_crm jsonb;
BEGIN
  IF COALESCE(v_role,'') NOT IN ('admin','accounts') THEN
    IF v_gp THEN v_seg := 'GOVERNMENT'; ELSE RETURN '{}'::jsonb; END IF;
  END IF;

  -- bank income (ledger receipts, segment derived like finance_pnl_summary)
  SELECT COALESCE(SUM(amount),0) INTO v_bank
    FROM public.finance_transactions
   WHERE bucket = 'income' AND direction = 'in'
     AND (p_from IS NULL OR txn_date >= p_from) AND (p_to IS NULL OR txn_date <= p_to)
     AND (v_seg IS NULL OR COALESCE(segment,
            CASE company WHEN 'Untitled Advertising'    THEN 'GOVERNMENT'
                         WHEN 'Untitled Adflux Pvt Ltd' THEN 'PRIVATE' END) = v_seg);

  -- CRM receipts — ALL approved payments (gross)
  SELECT COALESCE(SUM(p.amount_received),0) INTO v_crm
    FROM public.payments p JOIN public.quotes q ON q.id = p.quote_id
   WHERE p.approval_status = 'approved'
     AND (p_from IS NULL OR p.payment_date >= p_from) AND (p_to IS NULL OR p.payment_date <= p_to)
     AND (v_seg IS NULL OR q.segment = v_seg);

  -- CRM receipts on WON quotes — the P&L-tying population
  SELECT COALESCE(SUM(p.amount_received),0) INTO v_crm_won
    FROM public.payments p JOIN public.quotes q ON q.id = p.quote_id
   WHERE p.approval_status = 'approved' AND q.status = 'won'
     AND (p_from IS NULL OR p.payment_date >= p_from) AND (p_to IS NULL OR p.payment_date <= p_to)
     AND (v_seg IS NULL OR q.segment = v_seg);

  -- BANK credits with no matching/linked CRM payment (and not ignored)
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'date') DESC), '[]'::jsonb) INTO v_un
  FROM (
    SELECT jsonb_build_object(
             'id',          ft.id,
             'date',        ft.txn_date,
             'amount',      ft.amount,
             'description', LEFT(COALESCE(ft.description,''), 60),
             'segment',     COALESCE(ft.segment,
                              CASE ft.company WHEN 'Untitled Advertising'    THEN 'GOVERNMENT'
                                              WHEN 'Untitled Adflux Pvt Ltd' THEN 'PRIVATE' END)) AS x
      FROM public.finance_transactions ft
     WHERE ft.bucket = 'income' AND ft.direction = 'in'
       AND ft.matched_payment_id IS NULL
       AND ft.reconcile_ignored = false
       AND (p_from IS NULL OR ft.txn_date >= p_from) AND (p_to IS NULL OR ft.txn_date <= p_to)
       AND (v_seg IS NULL OR COALESCE(ft.segment,
              CASE ft.company WHEN 'Untitled Advertising'    THEN 'GOVERNMENT'
                              WHEN 'Untitled Adflux Pvt Ltd' THEN 'PRIVATE' END) = v_seg)
       AND NOT EXISTS (
         SELECT 1 FROM public.payments p
          WHERE p.approval_status = 'approved'
            AND p.payment_date BETWEEN ft.txn_date - 7 AND ft.txn_date + 7
            AND abs(COALESCE(p.amount_received,0) - ft.amount) <= GREATEST(50, ft.amount * 0.01)
            AND (v_seg IS NULL OR EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = p.quote_id AND q.segment = v_seg))
       )
  ) s;

  -- CRM payments (WON) with no near-matching AND no hand-linked bank credit
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'date') DESC), '[]'::jsonb) INTO v_un_crm
  FROM (
    SELECT jsonb_build_object(
             'payment_id', p.id,
             'date',       p.payment_date,
             'amount',     p.amount_received,
             'ref',        q.quote_number,
             'client',     COALESCE(q.client_company, q.client_name, 'Client'),
             'segment',    q.segment) AS x
      FROM public.payments p JOIN public.quotes q ON q.id = p.quote_id
     WHERE p.approval_status = 'approved' AND q.status = 'won'
       AND COALESCE(p.amount_received,0) > 0
       AND (p_from IS NULL OR p.payment_date >= p_from) AND (p_to IS NULL OR p.payment_date <= p_to)
       AND (v_seg IS NULL OR q.segment = v_seg)
       -- no bank income credit hand-linked to this payment
       AND NOT EXISTS (SELECT 1 FROM public.finance_transactions ft
                        WHERE ft.matched_payment_id = p.id AND ft.bucket='income' AND ft.direction='in')
       -- and no bank income credit near-matches it on amount + date
       AND NOT EXISTS (
         SELECT 1 FROM public.finance_transactions ft
          WHERE ft.bucket = 'income' AND ft.direction = 'in' AND ft.reconcile_ignored = false
            AND ft.txn_date BETWEEN p.payment_date - 7 AND p.payment_date + 7
            AND abs(ft.amount - COALESCE(p.amount_received,0)) <= GREATEST(50, COALESCE(p.amount_received,0) * 0.01)
            AND (v_seg IS NULL OR COALESCE(ft.segment,
                   CASE ft.company WHEN 'Untitled Advertising'    THEN 'GOVERNMENT'
                                   WHEN 'Untitled Adflux Pvt Ltd' THEN 'PRIVATE' END) = v_seg)
       )
  ) s2;

  RETURN jsonb_build_object(
    'bank_income_total',    v_bank,
    'crm_receipts_total',   v_crm,
    'crm_income_won_total', v_crm_won,
    'gap',                  v_bank - v_crm_won,
    'unmatched',            v_un,
    'unmatched_count',      jsonb_array_length(v_un),
    'unmatched_crm',        v_un_crm,
    'unmatched_crm_count',  jsonb_array_length(v_un_crm)
  );
END $fn$;
GRANT EXECUTE ON FUNCTION public.finance_reconcile(date,date) TO authenticated;

-- ══════════════ part 3 · finance_match_txn — the gated match/ignore action ══════════════
-- Sets a BANK income credit's matched_payment_id (link it to a CRM payment) OR
-- reconcile_ignored=true (a bank credit that is not a sales receipt). Either way
-- the row drops off both unmatched lists. admin/accounts full; govt_partner
-- (Vishal) only on GOVERNMENT txns (§152); else denied (fail-closed on NULL role).
CREATE OR REPLACE FUNCTION public.finance_match_txn(
  p_txn_id uuid, p_payment_id uuid DEFAULT NULL, p_ignore boolean DEFAULT false
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_role    text    := public.get_my_role();
  v_gp      boolean := EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.team_role = 'government_partner');
  v_txn_seg text;
BEGIN
  IF p_txn_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_txn'); END IF;
  -- role gate (fail-closed): admin/accounts, or a government_partner
  IF COALESCE(v_role,'') NOT IN ('admin','accounts') AND NOT v_gp THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT COALESCE(segment, CASE company WHEN 'Untitled Advertising'    THEN 'GOVERNMENT'
                                        WHEN 'Untitled Adflux Pvt Ltd' THEN 'PRIVATE' END)
    INTO v_txn_seg FROM public.finance_transactions WHERE id = p_txn_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'no_txn'); END IF;

  -- §152: a govt_partner who is NOT admin/accounts may only touch GOVERNMENT rows
  IF COALESCE(v_role,'') NOT IN ('admin','accounts') AND v_gp
     AND COALESCE(v_txn_seg,'') <> 'GOVERNMENT' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden_segment');
  END IF;

  IF p_ignore THEN
    UPDATE public.finance_transactions
       SET reconcile_ignored = true, matched_payment_id = NULL WHERE id = p_txn_id;
  ELSE
    UPDATE public.finance_transactions
       SET matched_payment_id = p_payment_id, reconcile_ignored = false WHERE id = p_txn_id;
  END IF;
  RETURN jsonb_build_object('ok', true);
END $fn$;
REVOKE EXECUTE ON FUNCTION public.finance_match_txn(uuid,uuid,boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.finance_match_txn(uuid,uuid,boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ── VERIFY ──
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name='finance_transactions' AND column_name='reconcile_ignored') AS has_ignore_col,
  to_regprocedure('public.finance_reconcile(date,date)')            IS NOT NULL     AS reconcile_ok,
  to_regprocedure('public.finance_match_txn(uuid,uuid,boolean)')    IS NOT NULL     AS match_fn_ok;
