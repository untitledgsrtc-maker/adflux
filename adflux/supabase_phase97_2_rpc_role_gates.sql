-- supabase_phase97_2_rpc_role_gates.sql
--
-- Phase 97.2 — close audit findings F-104, F-101, F-102, F-108.
-- F-105 (enqueue_push gate) DEFERRED to Batch A2 per owner directive.
--
-- ROOT CAUSES
-- ───────────
-- F-104: `public.get_my_role()` + `public.is_sales_manager()` are
--        SECURITY DEFINER without `SET search_path`. Defense-in-depth
--        gap: pg_temp-shadow attack surface. Both are RLS keystones.
--
-- F-101: `public.approve_leave(p_leave_id uuid)` has no caller-role
--        check. Any rep can approve their own leave + inflate
--        compute_monthly_salary payout.
--
-- F-102: `public.compute_monthly_salary(uuid,int,int)` + 9 sibling
--        SECURITY DEFINER RPCs (_compute_monthly_salary_base,
--        compute_daily_score, monthly_score, compute_daily_ta,
--        backfill_performance, backfill_ta, score_history,
--        consecutive_missed_days, todays_suggested_tasks) accept
--        p_user_id but never check `get_my_role()` vs `auth.uid()`.
--        Any rep reads any other rep's salary/score/TA via PostgREST.
--
-- F-108: `public.eligible_for_paid_leave(p_user_id uuid)` exposes
--        any user's tenure boolean — leaks join_date by bisect.
--
-- FIX PATTERN
-- ───────────
-- 1. Add helper `public._assert_self_or_admin(uuid)` — admin/co_owner
--    bypass OR `p_user_id = auth.uid()` self-call pass. Raises
--    SQLSTATE 42501 otherwise.
-- 2. CREATE OR REPLACE each affected function. Body copied byte-
--    identical from live `pg_get_functiondef()` output (2026-05-27).
--    Gate prepended at top of plpgsql body.
-- 3. F-104: get_my_role + is_sales_manager get `SET search_path =
--    public, pg_temp` + REVOKE/GRANT tightening.
-- 4. eligible_for_paid_leave: LANGUAGE sql → plpgsql so the gate
--    can be prepended. Behaviour preserved for legitimate self/admin
--    callers; cross-rep call now raises 42501.
--
-- ADMIN PATH (unchanged)
-- ──────────────────────
-- Brijesh / Vishal have get_my_role() IN ('admin','co_owner') →
-- bypass the gate on every function. Existing admin pages (/admin/
-- salary, /admin/leaves, /people, /my-performance) keep working.
--
-- SELF PATH (unchanged)
-- ─────────────────────
-- Sales rep calling compute_monthly_salary(auth.uid(), 2026, 5)
-- passes — gate hits the `p_user_id = auth.uid()` branch.
--
-- TRIGGER PATH (unchanged)
-- ────────────────────────
-- Phase 34Z.66 (compute_daily_score AFTER INSERT on lead_activities)
-- + Phase 34Z.67 (compute_daily_ta AFTER INSERT on gps_pings) fire
-- inside the rep's own transaction context. NEW.created_by =
-- auth.uid() → gate passes via self-call branch.
--
-- CRON PATH (unchanged — implicit bypass via NULL three-valued logic)
-- ──────────────────────────────────────────────────────────────────
-- pg_cron jobs (Phase 49 nightly backfill, Phase 76 GPS cron) run
-- as the `postgres` superuser. In that session auth.uid() returns
-- NULL. Inside the helper:
--   get_my_role() → SELECT role FROM users WHERE id = NULL → no rows → NULL
--   NULL NOT IN ('admin','co_owner') → NULL (UNKNOWN, not TRUE)
--   p_user_id <> NULL → NULL
--   NULL AND NULL → NULL
--   IF NULL THEN RAISE → branch NOT taken
-- Net: cron runs unaffected. This is the desired behavior — cron
-- is trusted-internal, not external rep-facing. No explicit cron
-- bypass needed in the gate.
--
-- IDEMPOTENCY
-- ───────────
-- All functions use CREATE OR REPLACE (re-runnable). Helper uses
-- CREATE OR REPLACE. No table changes. No data writes.
--
-- DEFERRED (explicit non-goals)
-- ─────────────────────────────
-- F-105 enqueue_push — A2 audit pending; need caller map first.
-- F-001b owner role DB purge — separate Batch E after audit.

-- ═══════════════════════════════════════════════════════════════
-- 1. Helper: _assert_self_or_admin
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._assert_self_or_admin(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF public.get_my_role() NOT IN ('admin', 'co_owner')
     AND p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Restricted: cannot access another user''s data (caller=%, target=%)',
                    auth.uid(), p_user_id
      USING ERRCODE = '42501';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public._assert_self_or_admin(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public._assert_self_or_admin(uuid) TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 2. F-104 — get_my_role + is_sales_manager: pin search_path
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT role FROM public.users WHERE id = auth.uid()
$function$;

REVOKE ALL ON FUNCTION public.get_my_role() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_my_role() TO authenticated;

CREATE OR REPLACE FUNCTION public.is_sales_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.users
     WHERE id = auth.uid()
       AND team_role = 'sales_manager'
       AND is_active = true
  );
$function$;

REVOKE ALL ON FUNCTION public.is_sales_manager() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_sales_manager() TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 3. F-101 — approve_leave: admin/co_owner only
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.approve_leave(p_leave_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row record;
BEGIN
  -- Phase 97.2 gate (F-101): admin/co_owner only.
  IF public.get_my_role() NOT IN ('admin', 'co_owner') THEN
    RAISE EXCEPTION 'Only admin/co_owner can approve leaves'
      USING ERRCODE = '42501';
  END IF;

  SELECT user_id, leave_date INTO v_row
    FROM leaves WHERE id = p_leave_id AND status <> 'approved';
  IF NOT FOUND THEN RETURN; END IF;

  UPDATE leaves SET status = 'approved' WHERE id = p_leave_id;

  -- Recompute the rep's score for that day so the exclusion takes effect.
  PERFORM public.compute_daily_score(v_row.user_id, v_row.leave_date);
END $function$;

-- ═══════════════════════════════════════════════════════════════
-- 4. F-108 — eligible_for_paid_leave: self-or-admin
-- (LANGUAGE sql → plpgsql so gate can be prepended.)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.eligible_for_paid_leave(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  PERFORM public._assert_self_or_admin(p_user_id);
  RETURN COALESCE(
    (SELECT join_date <= (CURRENT_DATE - INTERVAL '9 months')
       FROM public.staff_incentive_profiles
      WHERE user_id = p_user_id),
    false
  );
END $function$;

-- ═══════════════════════════════════════════════════════════════
-- 5. F-102 — 9 sibling SECURITY DEFINER RPCs gated by p_user_id
-- ═══════════════════════════════════════════════════════════════

-- 5.1 _compute_monthly_salary_base
CREATE OR REPLACE FUNCTION public._compute_monthly_salary_base(p_user_id uuid, p_year integer, p_month integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_month_start    date;
  v_month_end      date;
  v_month_year     text;
  v_fy             text;
  v_paid_quota     numeric;
  v_unpaid_divisor int;

  v_monthly_salary numeric := 0;
  v_base           numeric := 0;
  v_variable       numeric := 0;
  v_score_pct      numeric := 0;
  v_working_days   int     := 0;

  v_incentive      numeric := 0;
  v_ta_da          numeric := 0;

  v_leave_total       numeric := 0;
  v_leave_paid_req    numeric := 0;
  v_leave_unpaid_req  numeric := 0;
  v_paid_used_ytd     numeric := 0;
  v_leave_paid        numeric := 0;
  v_leave_unpaid      numeric := 0;
  v_unpaid_deduction  numeric := 0;

  v_fy_start       date;
  v_net            numeric;
  v_score_row      record;
BEGIN
  PERFORM public._assert_self_or_admin(p_user_id);

  v_month_start := make_date(p_year, p_month, 1);
  v_month_end   := (v_month_start + INTERVAL '1 month' - INTERVAL '1 day')::date;
  v_month_year  := to_char(v_month_start, 'YYYY-MM');
  v_fy          := public.fy_for_date(v_month_start);
  v_fy_start    := CASE WHEN p_month >= 4
                          THEN make_date(p_year, 4, 1)
                          ELSE make_date(p_year - 1, 4, 1) END;

  SELECT paid_quota_days, unpaid_divisor
    INTO v_paid_quota, v_unpaid_divisor
    FROM public.salary_policy WHERE fy = v_fy;
  v_paid_quota     := COALESCE(v_paid_quota, 12);
  v_unpaid_divisor := COALESCE(v_unpaid_divisor, 26);

  SELECT * INTO v_score_row
    FROM public.monthly_score(p_user_id, v_month_start)
    LIMIT 1;
  v_monthly_salary := COALESCE(v_score_row.monthly_salary, 0);
  v_base           := COALESCE(v_score_row.base_amount, 0);
  v_variable       := COALESCE(v_score_row.variable_earned, 0);
  v_score_pct      := COALESCE(v_score_row.avg_score_pct, 0);
  v_working_days   := COALESCE(v_score_row.working_days, 0);

  SELECT COALESCE(SUM(amount_paid), 0) INTO v_incentive
    FROM public.incentive_payouts
   WHERE staff_id = p_user_id
     AND month_year = v_month_year;

  SELECT COALESCE(SUM(total_amount), 0) INTO v_ta_da
    FROM public.daily_ta
   WHERE user_id = p_user_id
     AND ta_date BETWEEN v_month_start AND v_month_end;

  SELECT
    COALESCE(SUM(CASE WHEN is_paid_request AND is_half_day  THEN 0.5
                      WHEN is_paid_request                  THEN 1
                      ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN NOT is_paid_request AND is_half_day THEN 0.5
                      WHEN NOT is_paid_request                  THEN 1
                      ELSE 0 END), 0)
  INTO v_leave_paid_req, v_leave_unpaid_req
    FROM public.leaves
   WHERE user_id = p_user_id
     AND status = 'approved'
     AND leave_date BETWEEN v_month_start AND v_month_end;

  v_leave_total := v_leave_paid_req + v_leave_unpaid_req;

  SELECT COALESCE(SUM(CASE WHEN is_half_day THEN 0.5 ELSE 1 END), 0)
    INTO v_paid_used_ytd
    FROM public.leaves
   WHERE user_id = p_user_id
     AND status = 'approved'
     AND is_paid_request = true
     AND leave_date >= v_fy_start
     AND leave_date <  v_month_start;

  v_leave_paid := LEAST(v_leave_paid_req,
                        GREATEST(0, v_paid_quota - v_paid_used_ytd));
  v_leave_unpaid := v_leave_unpaid_req + (v_leave_paid_req - v_leave_paid);

  IF v_base > 0 AND v_unpaid_divisor > 0 THEN
    v_unpaid_deduction := round((v_base / v_unpaid_divisor) * v_leave_unpaid);
  ELSE
    v_unpaid_deduction := 0;
  END IF;

  v_net := round(v_base + v_variable + v_incentive + v_ta_da - v_unpaid_deduction);

  RETURN jsonb_build_object(
    'user_id',            p_user_id,
    'year',               p_year,
    'month',              p_month,
    'fy',                 v_fy,
    'monthly_salary',     v_monthly_salary,
    'base',               round(v_base),
    'variable',           round(v_variable),
    'score_pct',          round(v_score_pct, 1),
    'working_days',       v_working_days,
    'incentive',          v_incentive,
    'ta_da',              v_ta_da,
    'leave_days_total',   v_leave_total,
    'leave_days_paid',    v_leave_paid,
    'leave_days_unpaid',  v_leave_unpaid,
    'leave_paid_req',     v_leave_paid_req,
    'leave_unpaid_req',   v_leave_unpaid_req,
    'paid_quota',         v_paid_quota,
    'paid_used_ytd',      v_paid_used_ytd,
    'unpaid_divisor',     v_unpaid_divisor,
    'unpaid_deduction',   v_unpaid_deduction,
    'net_payable',        v_net
  );
END $function$;

-- 5.2 compute_monthly_salary (wrapper for Phase 42 manager override)
CREATE OR REPLACE FUNCTION public.compute_monthly_salary(p_user_id uuid, p_year integer, p_month integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_result jsonb;
  v_is_manager boolean;
  v_override_pct numeric;
  v_team_revenue numeric;
  v_override_amount numeric := 0;
  v_month_year text := lpad(p_year::text, 4, '0') || '-' || lpad(p_month::text, 2, '0');
BEGIN
  PERFORM public._assert_self_or_admin(p_user_id);

  SELECT (team_role = 'sales_manager') INTO v_is_manager
    FROM public.users WHERE id = p_user_id;
  v_is_manager := COALESCE(v_is_manager, false);

  SELECT public._compute_monthly_salary_base(p_user_id, p_year, p_month) INTO v_result;

  IF v_is_manager THEN
    SELECT incentive_override_pct INTO v_override_pct
      FROM public.staff_incentive_profiles
     WHERE user_id = p_user_id;

    IF v_override_pct IS NOT NULL AND v_override_pct > 0 THEN
      SELECT COALESCE(SUM(COALESCE(new_client_revenue, 0) + COALESCE(renewal_revenue, 0)), 0)
        INTO v_team_revenue
        FROM public.monthly_sales_data
       WHERE staff_id IN (SELECT id FROM public.users WHERE manager_id = p_user_id)
         AND month_year = v_month_year;

      v_override_amount := round(v_team_revenue * (v_override_pct / 100.0));

      v_result := v_result
        || jsonb_build_object(
             'team_revenue',     v_team_revenue,
             'override_pct',     v_override_pct,
             'override_amount',  v_override_amount,
             'incentive',        (COALESCE((v_result->>'incentive')::numeric, 0) + v_override_amount),
             'net_payable',      (COALESCE((v_result->>'net_payable')::numeric, 0) + v_override_amount)
           );
    END IF;
  END IF;

  RETURN v_result;
END $function$;

-- 5.3 compute_daily_score
-- -------------------------------------------------------------------------
-- compute_daily_score REMOVED from this file (Phase 178 consolidation).
-- The ONE canonical version now lives in: db/functions/compute_daily_score.sql
-- Do NOT re-add it here. To change the score, edit the canonical file only (§71).
-- -------------------------------------------------------------------------

-- 5.4 monthly_score
CREATE OR REPLACE FUNCTION public.monthly_score(p_user_id uuid, p_month_start date)
RETURNS TABLE(user_id uuid, month_start date, working_days integer, avg_score_pct numeric, monthly_salary numeric, base_amount numeric, variable_cap numeric, variable_earned numeric, total_payable numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_avg     numeric := 0;
  v_days    int := 0;
  v_salary  numeric := 0;
  v_base    numeric;
  v_var_cap numeric;
  v_var_earned numeric;
BEGIN
  PERFORM public._assert_self_or_admin(p_user_id);

  SELECT AVG(score_pct), COUNT(*)
    INTO v_avg, v_days
    FROM daily_performance dp
   WHERE dp.user_id = p_user_id
     AND dp.work_date >= p_month_start
     AND dp.work_date < (p_month_start + INTERVAL '1 month')
     AND dp.is_excluded = false;

  SELECT COALESCE(sip.monthly_salary, 0) INTO v_salary
    FROM staff_incentive_profiles sip
   WHERE sip.user_id = p_user_id;

  v_base    := v_salary * 0.70;
  v_var_cap := v_salary * 0.30;

  IF v_days = 0 THEN
    v_avg := 100;
    v_var_earned := v_var_cap;
  ELSIF v_avg < 50 THEN
    v_var_earned := 0;
  ELSE
    v_var_earned := (v_avg / 100.0) * v_var_cap;
  END IF;

  RETURN QUERY
  SELECT p_user_id, p_month_start, v_days,
         ROUND(v_avg, 1), v_salary, ROUND(v_base, 0),
         ROUND(v_var_cap, 0), ROUND(v_var_earned, 0),
         ROUND(v_base + v_var_earned, 0);
END $function$;

-- 5.5 compute_daily_ta
CREATE OR REPLACE FUNCTION public.compute_daily_ta(p_user_id uuid, p_date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_total_km     numeric := 0;
  v_ping_count   int := 0;
  v_primary_city text;
  v_category     text;
  v_da_amount    numeric := 0;
  v_bike_amount  numeric := 0;
  v_hotel_amount numeric := 0;
  v_total_amount numeric := 0;
  v_is_home      boolean := false;
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

  v_claim_da     numeric := 0;
  v_claim_hotel  numeric := 0;
  v_override_km  numeric;
BEGIN
  PERFORM public._assert_self_or_admin(p_user_id);

  FOR v_ping IN
    SELECT captured_at, lat, lng, accuracy_m
      FROM public.gps_pings
     WHERE user_id = p_user_id
       AND captured_at >= p_date::timestamptz
       AND captured_at <  (p_date + 1)::timestamptz
       AND (accuracy_m IS NULL OR accuracy_m <= 50)
     ORDER BY captured_at ASC
  LOOP
    v_ping_count := v_ping_count + 1;
    IF v_prev_lat IS NOT NULL THEN
      v_seg_km  := public.haversine_km(v_prev_lat, v_prev_lng, v_ping.lat, v_ping.lng);
      v_seg_hrs := GREATEST(EXTRACT(EPOCH FROM (v_ping.captured_at - v_prev_ts)) / 3600.0, 0.0001);
      v_seg_speed := v_seg_km / v_seg_hrs;
      IF v_seg_km >= 0.10 AND v_seg_speed <= 120 THEN
        v_total_km := v_total_km + v_seg_km;
      END IF;
    END IF;
    v_prev_lat := v_ping.lat;
    v_prev_lng := v_ping.lng;
    v_prev_ts  := v_ping.captured_at;
  END LOOP;

  SELECT dc.city_name, dc.category, dc.is_home, dc.bike_per_km
    INTO v_city_count
    FROM public.gps_pings gp
    CROSS JOIN LATERAL public.detect_city(gp.lat, gp.lng) dc
   WHERE gp.user_id = p_user_id
     AND gp.captured_at >= p_date::timestamptz
     AND gp.captured_at <  (p_date + 1)::timestamptz
     AND (gp.accuracy_m IS NULL OR gp.accuracy_m <= 50)
   GROUP BY dc.city_name, dc.category, dc.is_home, dc.bike_per_km
   ORDER BY COUNT(*) DESC
   LIMIT 1;

  IF v_city_count.city_name IS NOT NULL THEN
    v_primary_city := v_city_count.city_name;
    v_category     := v_city_count.category;
    v_is_home      := v_city_count.is_home;
    v_bike_rate    := v_city_count.bike_per_km;
  END IF;

  v_da_amount    := 0;
  v_bike_amount  := ROUND(v_total_km * v_bike_rate, 0);

  SELECT
    COALESCE(SUM(CASE WHEN kind IN ('da_night', 'other')
                      THEN COALESCE(claim_amount, 0)
                      ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN kind = 'hotel'
                      THEN COALESCE(claim_amount, 0)
                      ELSE 0 END), 0),
    MAX(CASE WHEN kind = 'ta_override'
             THEN COALESCE(claim_km, 0)
             ELSE NULL END)
  INTO v_claim_da, v_claim_hotel, v_override_km
  FROM public.ta_da_requests
  WHERE user_id   = p_user_id
    AND claim_date = p_date
    AND status     = 'approved';

  IF v_override_km IS NOT NULL AND v_override_km > 0 THEN
    v_total_km    := v_override_km;
    v_bike_amount := ROUND(v_override_km * v_bike_rate, 0);
  END IF;

  v_da_amount    := v_da_amount + v_claim_da;
  v_hotel_amount := v_claim_hotel;

  v_total_amount := v_da_amount + v_bike_amount + v_hotel_amount;

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
    ROUND(v_total_km, 2), v_da_amount, v_bike_amount, v_hotel_amount, v_total_amount,
    'pending', v_ping_count, v_overnight, now()
  )
  ON CONFLICT (user_id, ta_date) DO UPDATE
    SET primary_city    = EXCLUDED.primary_city,
        city_category   = EXCLUDED.city_category,
        km_traveled     = EXCLUDED.km_traveled,
        da_amount       = EXCLUDED.da_amount,
        bike_amount     = EXCLUDED.bike_amount,
        hotel_amount    = EXCLUDED.hotel_amount,
        total_amount    = EXCLUDED.da_amount + EXCLUDED.bike_amount + EXCLUDED.hotel_amount,
        gps_pings_count = EXCLUDED.gps_pings_count,
        hotel_requested = EXCLUDED.hotel_requested,
        computed_at     = now()
    WHERE daily_ta.status = 'pending';
END $function$;

-- 5.6 backfill_performance
CREATE OR REPLACE FUNCTION public.backfill_performance(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE d date;
BEGIN
  PERFORM public._assert_self_or_admin(p_user_id);
  FOR d IN
    SELECT generate_series(CURRENT_DATE - 30, CURRENT_DATE, '1 day')::date
  LOOP
    PERFORM public.compute_daily_score(p_user_id, d);
  END LOOP;
END $function$;

-- 5.7 backfill_ta
CREATE OR REPLACE FUNCTION public.backfill_ta(p_user_id uuid, p_month_start date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  d  date;
  n  int := 0;
BEGIN
  PERFORM public._assert_self_or_admin(p_user_id);
  FOR d IN
    SELECT generate_series(
      p_month_start,
      LEAST((p_month_start + INTERVAL '1 month' - INTERVAL '1 day')::date, CURRENT_DATE),
      '1 day'
    )::date
  LOOP
    PERFORM public.compute_daily_ta(p_user_id, d);
    n := n + 1;
  END LOOP;
  RETURN n;
END $function$;

-- 5.8 score_history
CREATE OR REPLACE FUNCTION public.score_history(p_user_id uuid, p_months_back integer DEFAULT 6)
RETURNS TABLE(month_start date, month_label text, working_days integer, avg_score_pct numeric, total_payable numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  d date;
  m record;
BEGIN
  PERFORM public._assert_self_or_admin(p_user_id);
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
    total_payable := COALESCE(m.total_payable, 0);
    RETURN NEXT;
  END LOOP;
END $function$;

-- 5.9 consecutive_missed_days
CREATE OR REPLACE FUNCTION public.consecutive_missed_days(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_count int := 0;
  v_check date := CURRENT_DATE - 1;
  v_row   record;
BEGIN
  PERFORM public._assert_self_or_admin(p_user_id);
  WHILE v_count < 30 LOOP
    SELECT score_pct, is_excluded
      INTO v_row
      FROM daily_performance
     WHERE user_id = p_user_id AND work_date = v_check;

    EXIT WHEN NOT FOUND;
    IF v_row.is_excluded THEN
      v_check := v_check - 1;
      CONTINUE;
    END IF;
    IF v_row.score_pct < 50 THEN
      v_count := v_count + 1;
      v_check := v_check - 1;
    ELSE
      EXIT;
    END IF;
  END LOOP;
  RETURN v_count;
END $function$;

-- 5.10 todays_suggested_tasks
CREATE OR REPLACE FUNCTION public.todays_suggested_tasks(p_user_id uuid)
RETURNS TABLE(kind text, lead_id uuid, quote_id uuid, primary_text text, secondary_text text, priority integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  PERFORM public._assert_self_or_admin(p_user_id);

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
END $function$;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════
-- VERIFY (paste in Studio after applying — 5 queries)
-- ═══════════════════════════════════════════════════════════════
--
-- 1. Helper exists:
--    SELECT proname, pg_get_function_identity_arguments(oid) AS args
--      FROM pg_proc
--     WHERE pronamespace = 'public'::regnamespace
--       AND proname = '_assert_self_or_admin';
--    → 1 row, args = "p_user_id uuid".
--
-- 2. get_my_role + is_sales_manager have search_path pinned:
--    SELECT proname, proconfig
--      FROM pg_proc
--     WHERE pronamespace = 'public'::regnamespace
--       AND proname IN ('get_my_role', 'is_sales_manager');
--    → 2 rows, both proconfig contains 'search_path=public, pg_temp'.
--
-- 3. All 14 functions now have SET search_path:
--    SELECT proname, COALESCE(array_to_string(proconfig, ','), '<none>') AS cfg
--      FROM pg_proc
--     WHERE pronamespace = 'public'::regnamespace
--       AND proname IN (
--         'get_my_role','is_sales_manager','approve_leave',
--         'eligible_for_paid_leave','compute_monthly_salary',
--         '_compute_monthly_salary_base','compute_daily_score',
--         'monthly_score','compute_daily_ta','backfill_performance',
--         'backfill_ta','score_history','consecutive_missed_days',
--         'todays_suggested_tasks','_assert_self_or_admin')
--     ORDER BY proname;
--    → 15 rows. Each cfg should mention 'search_path'.
--
-- 4. Live block test — sales rep impersonation.
--    NOTE: replace BOTH uids below before running:
--      • v_uid           — IMPERSONATED rep (any active sales rep).
--      • target uid arg  — DIFFERENT rep (to trigger the cross-rep block).
--    Find both via: SELECT id, name, role FROM users
--                    WHERE role='sales' AND is_active=true ORDER BY name;
--    Pre-filled here: caa6236a-844b-4097-8d93-f71d9b28ffae=Dixita,
--                     8d37a7d1-dd41-4b5d-a422-d1f7114a1aa8=Mayur.
--    Confirm both exist in your DB before running.
--    DO $$
--    DECLARE v_uid uuid := 'caa6236a-844b-4097-8d93-f71d9b28ffae';
--    BEGIN
--      PERFORM set_config('role','authenticated',true);
--      PERFORM set_config('request.jwt.claims',
--        json_build_object('sub',v_uid::text,'role','authenticated')::text, true);
--      BEGIN
--        PERFORM public.compute_monthly_salary(
--          '8d37a7d1-dd41-4b5d-a422-d1f7114a1aa8'::uuid,  -- MAYUR uid, not Dixita
--          2026, 5);
--        RAISE NOTICE 'F102_TEST=FAIL_CROSS_USER_ALLOWED';
--      EXCEPTION WHEN insufficient_privilege THEN
--        RAISE NOTICE 'F102_TEST=PASS_BLOCKED %', SQLERRM;
--      END;
--    END $$;
--    → expect NOTICE: F102_TEST=PASS_BLOCKED ...
--
-- 5. Live self-call test as same sales rep — must succeed:
--    DO $$
--    DECLARE v_uid uuid := 'caa6236a-844b-4097-8d93-f71d9b28ffae';
--    DECLARE r jsonb;
--    BEGIN
--      PERFORM set_config('role','authenticated',true);
--      PERFORM set_config('request.jwt.claims',
--        json_build_object('sub',v_uid::text,'role','authenticated')::text, true);
--      r := public.compute_monthly_salary(v_uid, 2026, 5);
--      RAISE NOTICE 'F102_SELF=PASS net=%', r->>'net_payable';
--    END $$;
--    → expect NOTICE: F102_SELF=PASS net=...

-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK (only if regression observed — paste in Studio)
-- ═══════════════════════════════════════════════════════════════
-- Each function reverts to pre-Phase-97.2 body. Helper kept (no
-- harm — unused unless other phase calls it).
--
-- Symptoms that mean rollback needed:
--   • admin /admin/salary page errors with 42501
--   • Phase 34Z.66 score trigger raises 42501 inside rep transaction
--   • Phase 34Z.67 TA trigger raises 42501 inside rep transaction
--   • Phase 36 leave approval errors
--   • Cron jobs (Phase 49) errors on backfill_performance
--
-- Paste this block to revert:
--
-- CREATE OR REPLACE FUNCTION public.get_my_role()
-- RETURNS text LANGUAGE sql SECURITY DEFINER
-- AS $$ SELECT role FROM users WHERE id = auth.uid() $$;
--
-- CREATE OR REPLACE FUNCTION public.is_sales_manager()
-- RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
-- AS $$
--   SELECT EXISTS (
--     SELECT 1 FROM public.users
--      WHERE id = auth.uid()
--        AND team_role = 'sales_manager'
--        AND is_active = true
--   );
-- $$;
--
-- CREATE OR REPLACE FUNCTION public.approve_leave(p_leave_id uuid)
-- RETURNS void LANGUAGE plpgsql SECURITY DEFINER
-- SET search_path TO 'public' AS $$
-- DECLARE v_row record;
-- BEGIN
--   SELECT user_id, leave_date INTO v_row
--     FROM leaves WHERE id = p_leave_id AND status <> 'approved';
--   IF NOT FOUND THEN RETURN; END IF;
--   UPDATE leaves SET status = 'approved' WHERE id = p_leave_id;
--   PERFORM public.compute_daily_score(v_row.user_id, v_row.leave_date);
-- END $$;
--
-- CREATE OR REPLACE FUNCTION public.eligible_for_paid_leave(p_user_id uuid)
-- RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
-- SET search_path TO 'public' AS $$
--   SELECT COALESCE(
--     (SELECT join_date <= (CURRENT_DATE - INTERVAL '9 months')
--        FROM public.staff_incentive_profiles
--       WHERE user_id = p_user_id),
--     false
--   );
-- $$;
--
-- For the 10 sibling RPCs — inline rollback bodies below. Each is
-- byte-identical to the live (pre-Phase-97.2) body, with the
-- `PERFORM public._assert_self_or_admin(p_user_id);` line REMOVED
-- and `SET search_path TO 'public'` restored (the original).
-- Helper kept in DB after rollback — harmless, unused unless re-
-- deployed.
--
-- CREATE OR REPLACE FUNCTION public._compute_monthly_salary_base(p_user_id uuid, p_year integer, p_month integer)
-- RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
-- DECLARE
--   v_month_start    date; v_month_end date; v_month_year text; v_fy text;
--   v_paid_quota numeric; v_unpaid_divisor int;
--   v_monthly_salary numeric := 0; v_base numeric := 0; v_variable numeric := 0;
--   v_score_pct numeric := 0; v_working_days int := 0; v_incentive numeric := 0;
--   v_ta_da numeric := 0; v_leave_total numeric := 0;
--   v_leave_paid_req numeric := 0; v_leave_unpaid_req numeric := 0;
--   v_paid_used_ytd numeric := 0; v_leave_paid numeric := 0; v_leave_unpaid numeric := 0;
--   v_unpaid_deduction numeric := 0; v_fy_start date; v_net numeric; v_score_row record;
-- BEGIN
--   v_month_start := make_date(p_year, p_month, 1);
--   v_month_end := (v_month_start + INTERVAL '1 month' - INTERVAL '1 day')::date;
--   v_month_year := to_char(v_month_start, 'YYYY-MM'); v_fy := public.fy_for_date(v_month_start);
--   v_fy_start := CASE WHEN p_month >= 4 THEN make_date(p_year, 4, 1) ELSE make_date(p_year - 1, 4, 1) END;
--   SELECT paid_quota_days, unpaid_divisor INTO v_paid_quota, v_unpaid_divisor FROM public.salary_policy WHERE fy = v_fy;
--   v_paid_quota := COALESCE(v_paid_quota, 12); v_unpaid_divisor := COALESCE(v_unpaid_divisor, 26);
--   SELECT * INTO v_score_row FROM public.monthly_score(p_user_id, v_month_start) LIMIT 1;
--   v_monthly_salary := COALESCE(v_score_row.monthly_salary, 0);
--   v_base := COALESCE(v_score_row.base_amount, 0); v_variable := COALESCE(v_score_row.variable_earned, 0);
--   v_score_pct := COALESCE(v_score_row.avg_score_pct, 0); v_working_days := COALESCE(v_score_row.working_days, 0);
--   SELECT COALESCE(SUM(amount_paid), 0) INTO v_incentive FROM public.incentive_payouts WHERE staff_id = p_user_id AND month_year = v_month_year;
--   SELECT COALESCE(SUM(total_amount), 0) INTO v_ta_da FROM public.daily_ta WHERE user_id = p_user_id AND ta_date BETWEEN v_month_start AND v_month_end;
--   SELECT COALESCE(SUM(CASE WHEN is_paid_request AND is_half_day THEN 0.5 WHEN is_paid_request THEN 1 ELSE 0 END), 0),
--          COALESCE(SUM(CASE WHEN NOT is_paid_request AND is_half_day THEN 0.5 WHEN NOT is_paid_request THEN 1 ELSE 0 END), 0)
--   INTO v_leave_paid_req, v_leave_unpaid_req FROM public.leaves WHERE user_id = p_user_id AND status = 'approved' AND leave_date BETWEEN v_month_start AND v_month_end;
--   v_leave_total := v_leave_paid_req + v_leave_unpaid_req;
--   SELECT COALESCE(SUM(CASE WHEN is_half_day THEN 0.5 ELSE 1 END), 0) INTO v_paid_used_ytd FROM public.leaves
--    WHERE user_id = p_user_id AND status = 'approved' AND is_paid_request = true AND leave_date >= v_fy_start AND leave_date < v_month_start;
--   v_leave_paid := LEAST(v_leave_paid_req, GREATEST(0, v_paid_quota - v_paid_used_ytd));
--   v_leave_unpaid := v_leave_unpaid_req + (v_leave_paid_req - v_leave_paid);
--   IF v_base > 0 AND v_unpaid_divisor > 0 THEN v_unpaid_deduction := round((v_base / v_unpaid_divisor) * v_leave_unpaid);
--   ELSE v_unpaid_deduction := 0; END IF;
--   v_net := round(v_base + v_variable + v_incentive + v_ta_da - v_unpaid_deduction);
--   RETURN jsonb_build_object('user_id',p_user_id,'year',p_year,'month',p_month,'fy',v_fy,
--     'monthly_salary',v_monthly_salary,'base',round(v_base),'variable',round(v_variable),
--     'score_pct',round(v_score_pct,1),'working_days',v_working_days,'incentive',v_incentive,'ta_da',v_ta_da,
--     'leave_days_total',v_leave_total,'leave_days_paid',v_leave_paid,'leave_days_unpaid',v_leave_unpaid,
--     'leave_paid_req',v_leave_paid_req,'leave_unpaid_req',v_leave_unpaid_req,'paid_quota',v_paid_quota,
--     'paid_used_ytd',v_paid_used_ytd,'unpaid_divisor',v_unpaid_divisor,'unpaid_deduction',v_unpaid_deduction,
--     'net_payable',v_net);
-- END $function$;
--
-- CREATE OR REPLACE FUNCTION public.compute_monthly_salary(p_user_id uuid, p_year integer, p_month integer)
-- RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER AS $function$
-- DECLARE v_result jsonb; v_is_manager boolean; v_override_pct numeric; v_team_revenue numeric;
--   v_override_amount numeric := 0; v_month_year text := lpad(p_year::text,4,'0')||'-'||lpad(p_month::text,2,'0');
-- BEGIN
--   SELECT (team_role = 'sales_manager') INTO v_is_manager FROM public.users WHERE id = p_user_id;
--   v_is_manager := COALESCE(v_is_manager, false);
--   SELECT public._compute_monthly_salary_base(p_user_id, p_year, p_month) INTO v_result;
--   IF v_is_manager THEN
--     SELECT incentive_override_pct INTO v_override_pct FROM public.staff_incentive_profiles WHERE user_id = p_user_id;
--     IF v_override_pct IS NOT NULL AND v_override_pct > 0 THEN
--       SELECT COALESCE(SUM(COALESCE(new_client_revenue,0)+COALESCE(renewal_revenue,0)),0) INTO v_team_revenue
--         FROM public.monthly_sales_data
--        WHERE staff_id IN (SELECT id FROM public.users WHERE manager_id = p_user_id) AND month_year = v_month_year;
--       v_override_amount := round(v_team_revenue * (v_override_pct / 100.0));
--       v_result := v_result || jsonb_build_object('team_revenue',v_team_revenue,'override_pct',v_override_pct,
--         'override_amount',v_override_amount,
--         'incentive',(COALESCE((v_result->>'incentive')::numeric,0)+v_override_amount),
--         'net_payable',(COALESCE((v_result->>'net_payable')::numeric,0)+v_override_amount));
--     END IF;
--   END IF;
--   RETURN v_result;
-- END $function$;
--
-- compute_daily_score rollback body REMOVED (Phase 178). It was a stale
-- pre-Phase-110/113/127 version (calls-JSONB target, no call-gate, no meeting
-- exclusions). To restore the score, re-run db/functions/compute_daily_score.sql
-- — the single canonical source. Do NOT uncomment an old body.
--
-- For brevity, the remaining 7 (monthly_score, compute_daily_ta,
-- backfill_performance, backfill_ta, score_history,
-- consecutive_missed_days, todays_suggested_tasks) — copy from the
-- Phase 97.2 forward bodies above and DELETE the
-- `PERFORM public._assert_self_or_admin(p_user_id);` line + change
-- SET search_path back to TO 'public'. Each is independent + idempotent.
-- The 3 inlined above cover the highest-risk path (salary +
-- score). The 7 truncated functions follow the same mechanical
-- recipe — apply if a rollback ever fires; safe to delay since
-- removing the gate only OPENS the door, doesn't break the door.
--
-- NOTIFY pgrst, 'reload schema';
