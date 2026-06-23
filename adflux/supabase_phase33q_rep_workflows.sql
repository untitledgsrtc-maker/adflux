-- supabase_phase33q_rep_workflows.sql
--
-- Phase 33Q — rep-side workflows (owner directives #5, #12, #13, #16).
--
-- 1. Rep can insert OWN leaves as 'pending' (admin approves later).
-- 2. work_sessions.overnight_stay flag → propagates to daily_ta.hotel_requested.
-- 3. consecutive_missed_days(user_id) — counts back-to-back missed days
--    for the 3-day-miss popup.
-- 4. todays_suggested_tasks(user_id) — auto-suggests work for the day
--    when follow_ups is empty.

-- ─── 1. Rep self-insert leave (pending) ──────────────────────────
-- Existing Phase 33G.8 policies:
--   leaves_self_read   — SELECT own
--   leaves_admin_all   — ALL for admin/co_owner
-- Add: leaves_self_request — INSERT own as pending.

DROP POLICY IF EXISTS leaves_self_request ON public.leaves;

CREATE POLICY leaves_self_request ON public.leaves
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND status = 'pending'
  );

-- Rep can also delete their own pending request (only while pending).
DROP POLICY IF EXISTS leaves_self_withdraw ON public.leaves;
CREATE POLICY leaves_self_withdraw ON public.leaves
  FOR DELETE
  USING (
    user_id = auth.uid()
    AND status = 'pending'
  );

-- ─── 2. Overnight stay flag ──────────────────────────────────────
ALTER TABLE public.work_sessions
  ADD COLUMN IF NOT EXISTS overnight_stay boolean DEFAULT false;

ALTER TABLE public.daily_ta
  ADD COLUMN IF NOT EXISTS hotel_requested boolean DEFAULT false;

-- Update compute_daily_ta to surface work_sessions.overnight_stay onto
-- daily_ta.hotel_requested. Admin sees a chip on the row and types in
-- the hotel amount as before.
-- -------------------------------------------------------------------------
-- compute_daily_ta REMOVED from this file (Phase 178).
-- Canonical: db/functions/compute_daily_ta.sql  (MONEY function — TA payout)
-- Do NOT re-add it here. Edit the canonical file only (§71). Trigger wiring
-- (per-ping TA recompute + claim-approve) stays in the phase files.
-- -------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.compute_daily_ta(uuid, date) TO authenticated;

-- ─── 3. consecutive_missed_days ──────────────────────────────────
-- Counts working days going back from yesterday where score < 50%.
-- Stops counting when a day with score >= 50% or excluded day is hit.
-- Used by the 3-day-miss popup.
CREATE OR REPLACE FUNCTION public.consecutive_missed_days(p_user_id uuid)
RETURNS int
LANGUAGE plpgsql STABLE
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count int := 0;
  v_check date := CURRENT_DATE - 1;
  v_row   record;
BEGIN
  WHILE v_count < 30 LOOP
    SELECT score_pct, is_excluded
      INTO v_row
      FROM daily_performance
     WHERE user_id = p_user_id AND work_date = v_check;

    -- No row → stop (we don't know what happened that day).
    EXIT WHEN NOT FOUND;
    -- Excluded day (Sunday / holiday / leave) → skip without breaking streak.
    IF v_row.is_excluded THEN
      v_check := v_check - 1;
      CONTINUE;
    END IF;
    -- Score below 50% → counts as a miss.
    IF v_row.score_pct < 50 THEN
      v_count := v_count + 1;
      v_check := v_check - 1;
    ELSE
      EXIT;
    END IF;
  END LOOP;
  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public.consecutive_missed_days(uuid) TO authenticated;

-- ─── 4. todays_suggested_tasks ───────────────────────────────────
-- When the rep has no follow_ups due today, surface what they SHOULD
-- be doing. Returns a list of suggested actions with lead_id refs.
--
-- Heuristics:
--   • New leads untouched > 1 working day → 'Reach out to <name>'
--   • Quote sent > 5 days without payment → 'Chase <client>'
--   • Won quotes with O/S amount and no payment in 14 days → 'Collect from <client>'
CREATE OR REPLACE FUNCTION public.todays_suggested_tasks(p_user_id uuid)
RETURNS TABLE (
  kind        text,
  lead_id     uuid,
  quote_id    uuid,
  primary_text  text,
  secondary_text text,
  priority    int
)
LANGUAGE plpgsql STABLE
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- 1. New leads untouched > 24h.
  RETURN QUERY
  SELECT 'new_lead'::text, l.id, NULL::uuid,
         ('Reach out to ' || COALESCE(l.name, l.company, 'lead'))::text,
         (COALESCE(l.company, '') || ' · new')::text,
         1
    FROM leads l
   WHERE l.assigned_to = p_user_id
     AND l.stage = 'New'
     AND COALESCE(l.last_contact_at, l.created_at) < (now() - INTERVAL '24 hours')
   ORDER BY l.created_at ASC
   LIMIT 5;

  -- 2. Quotes sent > 5d ago without a payment.
  RETURN QUERY
  SELECT 'chase_quote'::text, NULL::uuid, q.id,
         ('Chase quote ' || COALESCE(q.quote_number, q.id::text))::text,
         (q.client_company || ' · sent ' || (CURRENT_DATE - q.updated_at::date) || 'd ago')::text,
         2
    FROM quotes q
   WHERE q.created_by = p_user_id
     AND q.status IN ('sent', 'negotiating')
     AND q.updated_at < (now() - INTERVAL '5 days')
     AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.quote_id = q.id)
   ORDER BY q.updated_at ASC
   LIMIT 3;

  -- 3. Won quotes with outstanding payment, no payment in 14d.
  RETURN QUERY
  SELECT 'collect_payment'::text, NULL::uuid, q.id,
         ('Collect from ' || q.client_company)::text,
         ('Won · ₹' || to_char(q.total_amount, 'FM99,99,99,999') || ' outstanding')::text,
         3
    FROM quotes q
   WHERE q.created_by = p_user_id
     AND q.status = 'won'
     AND NOT EXISTS (
       SELECT 1 FROM payments p
        WHERE p.quote_id = q.id
          AND p.approval_status = 'approved'
          AND p.created_at > (now() - INTERVAL '14 days')
     )
   ORDER BY q.updated_at ASC
   LIMIT 3;
END $$;

GRANT EXECUTE ON FUNCTION public.todays_suggested_tasks(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY:
-- 1. Self-leave RLS: set role to a sales user and try
--      INSERT INTO leaves (user_id, leave_date, leave_type, status)
--        VALUES (auth.uid(), CURRENT_DATE + 1, 'sick', 'pending');
--    Should succeed.
-- 2. work_sessions overnight: UPDATE own row SET overnight_stay=true.
--    Then SELECT compute_daily_ta(...).
--    daily_ta.hotel_requested = true.
-- 3. consecutive_missed_days:
--      SELECT consecutive_missed_days('<rep_uuid>');
-- 4. Suggested tasks:
--      SELECT * FROM todays_suggested_tasks('<rep_uuid>');
