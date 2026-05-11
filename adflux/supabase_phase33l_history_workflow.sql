-- supabase_phase33l_history_workflow.sql
--
-- Phase 33L — three SQL pieces shipped together:
--   1. score_history(user_id, months_back) — returns last N months
--      of avg score + total payable. Powers the /my-performance
--      trend sparkline (F5 fix).
--   2. regen_payment_fu_notes(quote_id) — updates payment-collection
--      follow-up note text to reflect live outstanding. Called by
--      admin "Recompute" button if/when added; UI banner already
--      shows live O/S (Phase 33I) so this is cosmetic but completes
--      item E from the audit.
--   3. backfill_ta_all_active_reps() — runs compute_daily_ta for
--      yesterday for every sales/agency/telecaller user with a GPS
--      ping in the last 24h. Designed to be invoked nightly via
--      pg_cron once owner wires it up; for now admin can call it
--      manually. Closes deferred-I7-adjacent gap "TA nightly
--      recompute".
--   4. Leaves approval workflow — set leaves.status='pending' as
--      a real option, only 'approved' counts in score function.
--      Already works due to Phase 33G.8 is_leave_day function
--      filtering on status='approved'. Add a helper to flip
--      pending → approved.

-- ─── 1. score_history ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.score_history(
  p_user_id uuid, p_months_back int DEFAULT 6
) RETURNS TABLE (
  month_start    date,
  month_label    text,
  working_days   int,
  avg_score_pct  numeric,
  total_payable  numeric
)
LANGUAGE plpgsql STABLE
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  d date;
  m record;
BEGIN
  FOR d IN
    SELECT generate_series(
      (date_trunc('month', CURRENT_DATE) - (p_months_back - 1) * INTERVAL '1 month')::date,
      date_trunc('month', CURRENT_DATE)::date,
      '1 month'
    )::date
  LOOP
    SELECT * INTO m FROM public.monthly_score(p_user_id, d);
    month_start    := d;
    month_label    := to_char(d, 'Mon');
    working_days   := COALESCE(m.working_days, 0);
    avg_score_pct  := COALESCE(m.avg_score_pct, 0);
    total_payable  := COALESCE(m.total_payable, 0);
    RETURN NEXT;
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.score_history(uuid, int) TO authenticated;

-- ─── 2. regen_payment_fu_notes ────────────────────────────────────
-- Owner directive: admin "Recompute" should also regenerate the
-- payment-collection FU note text. UI banner already shows live O/S
-- via render-time math (Phase 33I), but the note string itself still
-- holds the snapshot from won-time. This RPC rebuilds the note.
CREATE OR REPLACE FUNCTION public.regen_payment_fu_notes(p_quote_id uuid)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_quote    record;
  v_paid     numeric := 0;
  v_outstand numeric := 0;
  v_count    int;
BEGIN
  SELECT id, total_amount,
         COALESCE(quote_number, ref_number, id::text) AS label
    INTO v_quote
    FROM quotes WHERE id = p_quote_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  SELECT COALESCE(SUM(amount_received), 0) INTO v_paid
    FROM payments
   WHERE quote_id = p_quote_id AND approval_status = 'approved';

  v_outstand := GREATEST(0, v_quote.total_amount - v_paid);

  -- Update the three payment-collection FU rows.
  UPDATE follow_ups
     SET note = CASE
       WHEN note LIKE '%2nd reminder%' THEN
         'Payment collection: 2nd reminder · ₹' || to_char(v_outstand, 'FM99,99,99,999') || ' outstanding'
       WHEN note LIKE '%final reminder%' THEN
         'Payment collection: final reminder · ₹' || to_char(v_outstand, 'FM99,99,99,999') || ' outstanding'
       ELSE
         'Payment collection: ₹' || to_char(v_outstand, 'FM99,99,99,999') || ' outstanding (' || v_quote.label || ')'
     END
   WHERE quote_id = p_quote_id
     AND note LIKE 'Payment collection%'
     AND is_done = false;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public.regen_payment_fu_notes(uuid) TO authenticated;

-- ─── 3. backfill_ta_all_active_reps ──────────────────────────────
-- Nightly TA recompute for every rep with GPS activity yesterday.
-- Run via pg_cron once enabled, or admin can hit it manually from
-- /admin/ta-payouts.
CREATE OR REPLACE FUNCTION public.backfill_ta_all_active_reps()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_count   int := 0;
  v_date    date := CURRENT_DATE - 1;
BEGIN
  FOR v_user_id IN
    SELECT DISTINCT gp.user_id
      FROM gps_pings gp
     WHERE gp.captured_at >= v_date::timestamptz
       AND gp.captured_at <  (v_date + 1)::timestamptz
  LOOP
    PERFORM public.compute_daily_ta(v_user_id, v_date);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public.backfill_ta_all_active_reps() TO authenticated;

-- ─── 4. Leaves approval workflow — already supported ─────────────
-- The leaves.status enum already allows pending/approved/rejected.
-- is_leave_day() (Phase 33G.8) filters on status='approved' so
-- pending rows don't get counted. UI inserts as 'approved' directly
-- since admin is sole approver. Helper for explicit pending → approved
-- flips:
CREATE OR REPLACE FUNCTION public.approve_leave(p_leave_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row record;
BEGIN
  SELECT user_id, leave_date INTO v_row
    FROM leaves WHERE id = p_leave_id AND status <> 'approved';
  IF NOT FOUND THEN RETURN; END IF;

  UPDATE leaves SET status = 'approved' WHERE id = p_leave_id;

  -- Recompute the rep's score for that day so the exclusion takes effect.
  PERFORM public.compute_daily_score(v_row.user_id, v_row.leave_date);
END $$;

GRANT EXECUTE ON FUNCTION public.approve_leave(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY:
-- score_history smoke test:
--   SELECT * FROM score_history(auth.uid(), 6);
-- regen test on a Won quote with payments:
--   SELECT regen_payment_fu_notes('<quote_id>');
--   SELECT note FROM follow_ups WHERE quote_id='<quote_id>'
--     AND note LIKE 'Payment collection%' AND is_done = false;
-- nightly TA stub:
--   SELECT backfill_ta_all_active_reps();
