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
CREATE OR REPLACE FUNCTION public.compute_daily_ta(
  p_user_id uuid, p_date date
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_km     numeric := 0;
  v_ping_count   int := 0;
  v_primary_city text;
  v_category     text;
  v_da_amount    numeric := 0;
  v_bike_amount  numeric := 0;
  v_total_amount numeric := 0;
  v_is_home      boolean := false;
  v_daily_da     numeric := 200;
  v_bike_rate    numeric := 3;
  v_city_count   record;
  v_prev_lat     numeric;
  v_prev_lng     numeric;
  v_prev_ts      timestamptz;
  v_ping         record;
  v_seg_km       numeric;
  v_seg_hrs      numeric;
  v_seg_speed    numeric;
  v_overnight    boolean := false;
BEGIN
  FOR v_ping IN
    SELECT captured_at, lat, lng, accuracy_m
      FROM public.gps_pings
     WHERE user_id = p_user_id
       AND captured_at >= p_date::timestamptz
       AND captured_at <  (p_date + 1)::timestamptz
       AND (accuracy_m IS NULL OR accuracy_m <= 200)
     ORDER BY captured_at ASC
  LOOP
    v_ping_count := v_ping_count + 1;
    IF v_prev_lat IS NOT NULL THEN
      v_seg_km  := public.haversine_km(v_prev_lat, v_prev_lng, v_ping.lat, v_ping.lng);
      v_seg_hrs := GREATEST(EXTRACT(EPOCH FROM (v_ping.captured_at - v_prev_ts)) / 3600.0, 0.0001);
      v_seg_speed := v_seg_km / v_seg_hrs;
      IF v_seg_km >= 0.03 AND v_seg_speed <= 200 THEN
        v_total_km := v_total_km + v_seg_km;
      END IF;
    END IF;
    v_prev_lat := v_ping.lat;
    v_prev_lng := v_ping.lng;
    v_prev_ts  := v_ping.captured_at;
  END LOOP;

  SELECT dc.city_name, dc.category, dc.is_home, dc.daily_da, dc.bike_per_km
    INTO v_city_count
    FROM public.gps_pings gp
    CROSS JOIN LATERAL public.detect_city(gp.lat, gp.lng) dc
   WHERE gp.user_id = p_user_id
     AND gp.captured_at >= p_date::timestamptz
     AND gp.captured_at <  (p_date + 1)::timestamptz
     AND (gp.accuracy_m IS NULL OR gp.accuracy_m <= 200)
   GROUP BY dc.city_name, dc.category, dc.is_home, dc.daily_da, dc.bike_per_km
   ORDER BY COUNT(*) DESC
   LIMIT 1;

  IF v_city_count.city_name IS NOT NULL THEN
    v_primary_city := v_city_count.city_name;
    v_category     := v_city_count.category;
    v_is_home      := v_city_count.is_home;
    v_daily_da     := v_city_count.daily_da;
    v_bike_rate    := v_city_count.bike_per_km;
  END IF;

  IF v_is_home THEN
    v_da_amount    := 0;
    v_bike_amount  := ROUND(v_total_km * v_bike_rate, 0);
  ELSIF v_primary_city IS NOT NULL THEN
    v_da_amount    := v_daily_da;
    v_bike_amount  := ROUND(v_total_km * v_bike_rate, 0);
  END IF;

  v_total_amount := v_da_amount + v_bike_amount;

  -- Phase 33Q — pull overnight flag from work_sessions for the day.
  SELECT COALESCE(overnight_stay, false) INTO v_overnight
    FROM work_sessions
   WHERE user_id = p_user_id AND work_date = p_date;
  v_overnight := COALESCE(v_overnight, false);

  INSERT INTO public.daily_ta (
    user_id, ta_date, primary_city, city_category,
    km_traveled, da_amount, bike_amount, hotel_amount, total_amount,
    status, gps_pings_count, hotel_requested, computed_at
  ) VALUES (
    p_user_id, p_date, v_primary_city, v_category,
    ROUND(v_total_km, 2), v_da_amount, v_bike_amount, 0, v_total_amount,
    'pending', v_ping_count, v_overnight, now()
  )
  ON CONFLICT (user_id, ta_date) DO UPDATE
    SET primary_city    = EXCLUDED.primary_city,
        city_category   = EXCLUDED.city_category,
        km_traveled     = EXCLUDED.km_traveled,
        da_amount       = EXCLUDED.da_amount,
        bike_amount     = EXCLUDED.bike_amount,
        total_amount    = EXCLUDED.da_amount + EXCLUDED.bike_amount + daily_ta.hotel_amount,
        gps_pings_count = EXCLUDED.gps_pings_count,
        hotel_requested = EXCLUDED.hotel_requested,
        computed_at     = now()
    WHERE daily_ta.status = 'pending';
END $$;

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
