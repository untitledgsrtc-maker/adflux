-- =====================================================================
-- FINANCE MODULE — P5 (bank↔CRM reconciliation) + P6 (task reminders)
-- 2026-08-06 · spec: docs/FINANCE_MODULE_SPEC.md · CLAUDE.md §155/§156
--
-- ONE file, two sections (§154). Both are finance-module, additive, §45-safe:
--   • P5 = a READ-ONLY reconcile RPC (pure SELECT, no writes).
--   • P6 = a task-reminder push cron (writes only finance_tasks.next_due +
--          fires push to admin/accounts; reuses the frozen enqueue_push).
-- Zero touch to sales/leads/quotes/payroll or any hot path.
-- Role gate mirrors finance_pnl_summary (§155 P3.2): admin/accounts = full;
-- co_owner+government_partner (Vishal) = GOVERNMENT-scoped; else '{}'. Fails
-- closed on NULL role. Idempotent (CREATE OR REPLACE / re-runnable cron).
-- =====================================================================


-- ==== part 1/2 · P5 — finance_reconcile(from, to) ====================
-- Owner-locked (§155): income is CRM; bank income credits are CROSS-CHECKED,
-- and any bank receipt with no matching CRM payment is flagged "not in CRM".
-- The live P&L keeps reading the bank ledger (owner-verified) — this is an
-- ADDITIVE read-only reconciliation, it does NOT change the P&L income source.
--
-- Returns:
--   bank_income_total  Σ bank income credits in the period (segment-scoped)
--   crm_receipts_total Σ approved CRM payments in the period (segment-scoped)
--   gap                bank − crm
--   unmatched[]        bank income rows with NO approved CRM payment of a
--                      near-equal amount (±₹50 or ±1%) within ±7 days, and not
--                      already hand-linked via matched_payment_id.
--   unmatched_count
CREATE OR REPLACE FUNCTION public.finance_reconcile(
  p_from date DEFAULT NULL, p_to date DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_role text := public.get_my_role();
  v_gp   boolean := EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.team_role = 'government_partner');
  v_seg  text := NULL;   -- NULL = both segments (admin / accounts)
  v_bank numeric; v_crm numeric; v_un jsonb;
BEGIN
  IF COALESCE(v_role,'') NOT IN ('admin','accounts') THEN
    IF v_gp THEN v_seg := 'GOVERNMENT'; ELSE RETURN '{}'::jsonb; END IF;
  END IF;

  -- Bank income (the ledger receipts, segment derived like finance_pnl_summary)
  SELECT COALESCE(SUM(amount),0) INTO v_bank
    FROM public.finance_transactions
   WHERE bucket = 'income' AND direction = 'in'
     AND (p_from IS NULL OR txn_date >= p_from) AND (p_to IS NULL OR txn_date <= p_to)
     AND (v_seg IS NULL OR COALESCE(segment,
            CASE company WHEN 'Untitled Advertising'      THEN 'GOVERNMENT'
                         WHEN 'Untitled Adflux Pvt Ltd'   THEN 'PRIVATE' END) = v_seg);

  -- CRM receipts (every approved payment = a cash receipt; segment via quote)
  SELECT COALESCE(SUM(p.amount_received),0) INTO v_crm
    FROM public.payments p JOIN public.quotes q ON q.id = p.quote_id
   WHERE p.approval_status = 'approved'
     AND (p_from IS NULL OR p.payment_date >= p_from) AND (p_to IS NULL OR p.payment_date <= p_to)
     AND (v_seg IS NULL OR q.segment = v_seg);

  -- Bank credits with no matching CRM payment (the "receipt not in CRM" flag)
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'date') DESC), '[]'::jsonb) INTO v_un
  FROM (
    SELECT jsonb_build_object(
             'date',        ft.txn_date,
             'amount',      ft.amount,
             'description', LEFT(COALESCE(ft.description,''), 60),
             'segment',     COALESCE(ft.segment,
                              CASE ft.company WHEN 'Untitled Advertising'    THEN 'GOVERNMENT'
                                              WHEN 'Untitled Adflux Pvt Ltd' THEN 'PRIVATE' END)) AS x
      FROM public.finance_transactions ft
     WHERE ft.bucket = 'income' AND ft.direction = 'in'
       AND ft.matched_payment_id IS NULL
       AND (p_from IS NULL OR ft.txn_date >= p_from) AND (p_to IS NULL OR ft.txn_date <= p_to)
       AND (v_seg IS NULL OR COALESCE(ft.segment,
              CASE ft.company WHEN 'Untitled Advertising'    THEN 'GOVERNMENT'
                              WHEN 'Untitled Adflux Pvt Ltd' THEN 'PRIVATE' END) = v_seg)
       AND NOT EXISTS (
         SELECT 1 FROM public.payments p
          WHERE p.approval_status = 'approved'
            AND p.payment_date BETWEEN ft.txn_date - 7 AND ft.txn_date + 7
            AND abs(COALESCE(p.amount_received,0) - ft.amount) <= GREATEST(50, ft.amount * 0.01)
            -- segment-scope the match (like v_crm) so Vishal's list can't "match" a
            -- GOVERNMENT bank credit against a PRIVATE payment → keeps his list ↔ gap consistent.
            AND (v_seg IS NULL OR EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = p.quote_id AND q.segment = v_seg))
       )
  ) s;

  RETURN jsonb_build_object(
    'bank_income_total',  v_bank,
    'crm_receipts_total', v_crm,
    'gap',                v_bank - v_crm,
    'unmatched',          v_un,
    'unmatched_count',    jsonb_array_length(v_un)
  );
END $fn$;
GRANT EXECUTE ON FUNCTION public.finance_reconcile(date,date) TO authenticated;


-- ==== part 2/2 · P6 — push_finance_task_reminders() + daily cron ======
-- For every active, not-done finance_task whose next_due has arrived, fire a
-- push to each active admin + accounts user, then advance recurring tasks to
-- their next occurrence (one-off tasks keep re-reminding once/day until done).
-- reminder_channel 'push_wa' still fires a push in v1 (WhatsApp reminders are
-- a later phase). Per-task-per-day tag (§97.A400) so a double-fire can't stack.
CREATE OR REPLACE FUNCTION public.push_finance_task_reminders()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_task  record;
  v_user  record;
  v_next  date;
  v_count int := 0;
BEGIN
  FOR v_task IN
    SELECT id, title, frequency, next_due
      FROM public.finance_tasks
     WHERE COALESCE(is_active, true) = true
       AND COALESCE(status, 'open') <> 'done'
       AND next_due IS NOT NULL
       AND next_due <= v_today
  LOOP
    FOR v_user IN
      SELECT id FROM public.users
       WHERE role IN ('admin', 'accounts') AND COALESCE(is_active, true) = true
    LOOP
      PERFORM public.enqueue_push(
        v_user.id,
        'Finance reminder: ' || v_task.title,
        'Due today — open Finance → Tasks.',
        '/finance?tab=tasks',
        'fin-task-' || v_task.id::text || '-' || to_char(v_today, 'YYYY-MM-DD')
      );
      v_count := v_count + 1;
    END LOOP;

    IF v_task.frequency IN ('daily', 'weekly', 'monthly') THEN
      v_next := v_task.next_due;
      WHILE v_next <= v_today LOOP
        v_next := CASE v_task.frequency
          WHEN 'daily'   THEN v_next + 1
          WHEN 'weekly'  THEN v_next + 7
          WHEN 'monthly' THEN (v_next + interval '1 month')::date
        END;
      END LOOP;
      UPDATE public.finance_tasks SET next_due = v_next WHERE id = v_task.id;
    END IF;
  END LOOP;

  RETURN v_count;
END $$;
-- Cron-only: it MUTATES finance_tasks.next_due + fires push. The cron runs as the
-- job owner (postgres, superuser → bypasses GRANT), so revoking from every client
-- role stops a logged-in user from advancing reminders / spamming admins by hand.
REVOKE EXECUTE ON FUNCTION public.push_finance_task_reminders() FROM PUBLIC, anon, authenticated;

-- 10:00 IST = 04:30 UTC (30 min after the 09:30 rep morning push). Re-run safe.
DO $$
BEGIN
  PERFORM cron.unschedule('untitled-finance-task-reminders');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'untitled-finance-task-reminders',
  '30 4 * * *',
  $$ SELECT public.push_finance_task_reminders(); $$
);

NOTIFY pgrst, 'reload schema';


-- ==== VERIFY =========================================================
-- Expect: both functions present (2), the cron job present (1), and a live
-- reconcile snapshot (bank vs CRM totals + how many bank receipts look
-- unrecorded across all data).
SELECT 'functions' AS check,
       (SELECT count(*) FROM pg_proc
         WHERE proname IN ('finance_reconcile','push_finance_task_reminders')
           AND pronamespace = 'public'::regnamespace)                       AS n_expect_2
UNION ALL SELECT 'cron_job',
       (SELECT count(*) FROM cron.job WHERE jobname = 'untitled-finance-task-reminders');

-- Live reconcile (all-time, admin view — runs right here in Studio):
SELECT
  (SELECT COALESCE(SUM(amount),0) FROM public.finance_transactions
     WHERE bucket='income' AND direction='in')                              AS bank_income,
  (SELECT COALESCE(SUM(p.amount_received),0) FROM public.payments p
     WHERE p.approval_status='approved')                                    AS crm_receipts,
  (SELECT count(*) FROM public.finance_transactions ft
     WHERE ft.bucket='income' AND ft.direction='in' AND ft.matched_payment_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.payments p
              WHERE p.approval_status='approved'
                AND p.payment_date BETWEEN ft.txn_date-7 AND ft.txn_date+7
                AND abs(COALESCE(p.amount_received,0)-ft.amount) <= GREATEST(50, ft.amount*0.01)))
                                                                            AS bank_receipts_not_in_crm;
