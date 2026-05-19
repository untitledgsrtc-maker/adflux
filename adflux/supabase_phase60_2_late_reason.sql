-- supabase_phase60_2_late_reason.sql
--
-- Phase 60.2 (19 May 2026) — capture late_reason on check-in.
--
-- Owner directive: reps who check in past 9:30 IST should be asked
-- to enter a short reason. Half-day window (past 11:30 IST) also.
-- Required so admin sees WHY a rep is late, not just THAT they are.
--
-- Changes:
--   1. work_sessions.late_reason text — nullable.
--   2. record_checkin RPC accepts p_reason text DEFAULT NULL; stores it.
--   3. is_checked_in_today RPC returns late_reason in its payload.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS; CREATE OR REPLACE on both
-- RPCs.


-- =====================================================================
-- §1. work_sessions.late_reason
-- =====================================================================
ALTER TABLE public.work_sessions
  ADD COLUMN IF NOT EXISTS late_reason text;


-- =====================================================================
-- §2. record_checkin RPC — accept optional reason
-- =====================================================================
CREATE OR REPLACE FUNCTION public.record_checkin(
  p_lat    numeric DEFAULT NULL,
  p_lng    numeric DEFAULT NULL,
  p_reason text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user           uuid := auth.uid();
  v_now_ist        timestamp := public.ist_now();
  v_date           date := v_now_ist::date;
  v_status         text;
  v_late_minutes   int;
  v_cutoff_ontime  timestamp := v_date + interval '9 hour 30 minute';
  v_cutoff_half    timestamp := v_date + interval '11 hour 30 minute';
  v_check_in_at    timestamptz;
  v_name           text;
  v_reason         text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- Compute status from IST clock time.
  IF v_now_ist <= v_cutoff_ontime THEN
    v_status := 'on_time';
    v_late_minutes := 0;
  ELSIF v_now_ist <= v_cutoff_half THEN
    v_status := 'late';
    v_late_minutes := GREATEST(0, EXTRACT(EPOCH FROM (v_now_ist - v_cutoff_ontime))::int / 60);
  ELSE
    v_status := 'half_day';
    v_late_minutes := GREATEST(0, EXTRACT(EPOCH FROM (v_now_ist - v_cutoff_ontime))::int / 60);
  END IF;

  v_check_in_at := now();

  -- Trim reason (only stored when late/half_day; on-time check-ins
  -- ignore the reason).
  v_reason := NULLIF(BTRIM(COALESCE(p_reason, '')), '');
  IF v_status = 'on_time' THEN v_reason := NULL; END IF;

  INSERT INTO public.work_sessions (
    user_id, work_date, check_in_at, check_in_gps_lat, check_in_gps_lng,
    check_in_status, late_minutes, late_reason
  )
  VALUES (v_user, v_date, v_check_in_at, p_lat, p_lng, v_status, v_late_minutes, v_reason)
  ON CONFLICT (user_id, work_date) DO UPDATE
    SET check_in_at      = COALESCE(public.work_sessions.check_in_at,      EXCLUDED.check_in_at),
        check_in_gps_lat = COALESCE(public.work_sessions.check_in_gps_lat, EXCLUDED.check_in_gps_lat),
        check_in_gps_lng = COALESCE(public.work_sessions.check_in_gps_lng, EXCLUDED.check_in_gps_lng),
        check_in_status  = COALESCE(public.work_sessions.check_in_status,  EXCLUDED.check_in_status),
        late_minutes     = COALESCE(public.work_sessions.late_minutes,     EXCLUDED.late_minutes),
        late_reason      = COALESCE(public.work_sessions.late_reason,      EXCLUDED.late_reason);

  -- Resolve any open no_checkin warnings for today.
  UPDATE public.attendance_warnings
     SET resolved_at = now()
   WHERE user_id = v_user
     AND work_date = v_date
     AND kind IN ('no_checkin','admin_escalation')
     AND resolved_at IS NULL;

  v_name := public.user_first_name(v_user);

  RETURN jsonb_build_object(
    'status',       v_status,
    'late_minutes', v_late_minutes,
    'late_reason',  v_reason,
    'check_in_at',  v_check_in_at,
    'work_date',    v_date,
    'name',         v_name
  );
END $$;

-- Old signature (no p_reason) implicitly replaced by new default value.
REVOKE ALL ON FUNCTION public.record_checkin(numeric, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_checkin(numeric, numeric, text) TO authenticated;


-- =====================================================================
-- §3. is_checked_in_today returns late_reason
-- =====================================================================
CREATE OR REPLACE FUNCTION public.is_checked_in_today()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row  record;
  v_name text;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('checked_in', false, 'is_workday', false);
  END IF;

  SELECT check_in_at, check_in_status, late_minutes, late_reason, work_date
    INTO v_row
    FROM public.work_sessions
   WHERE user_id = v_user
     AND work_date = public.ist_today();

  v_name := public.user_first_name(v_user);

  RETURN jsonb_build_object(
    'checked_in',   v_row.check_in_at IS NOT NULL,
    'check_in_at',  v_row.check_in_at,
    'status',       v_row.check_in_status,
    'late_minutes', v_row.late_minutes,
    'late_reason',  v_row.late_reason,
    'work_date',    public.ist_today(),
    'is_workday',   public.is_workday_for(v_user),
    'name',         v_name
  );
END $$;

REVOKE ALL ON FUNCTION public.is_checked_in_today() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_checked_in_today() TO authenticated;


NOTIFY pgrst, 'reload schema';


-- =====================================================================
-- §4. VERIFY
-- =====================================================================
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'work_sessions' AND column_name = 'late_reason')   AS late_reason_col,
  (SELECT count(*) FROM pg_proc WHERE proname = 'record_checkin')         AS record_checkin_overloads,
  (SELECT count(*) FROM pg_proc WHERE proname = 'is_checked_in_today')    AS is_checked_in_today;

-- Expected: 1 / 1 / 1
