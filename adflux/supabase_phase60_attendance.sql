-- supabase_phase60_attendance.sql
--
-- Phase 60 — Attendance / Check-in module.
-- 19 May 2026
--
-- Owner directives (this sprint):
--   - Swipe-to-check-in landing on app open (sales + telecaller + admin)
--   - Reuse existing work_sessions table (Phase 12); no schema sprawl
--   - Reminder schedule (Mon-Sat, skip Sunday + holidays + approved leaves):
--       9:30  IST  →  rep nudge attempt 1
--       10:00 IST  →  rep nudge attempt 2
--       10:15 IST  →  rep nudge attempt 3
--       10:30 IST  →  rep nudge attempt 4 + admin escalation push
--   - Half-day cutoff = check-in timestamp > 11:30 IST  →  status='half_day'
--   - 8:00 PM IST  →  auto-checkout (set check_out_at + polite goodnight)
--   - 8:30 PM IST  →  no-checkin users get leaves row leave_type='unpaid_absent'
--   - Every 15 min  →  gps_off scan (only between check_in_at and check_out_at)
--   - Every 30 min  →  internet_off admin scan (push_subscriptions.last_seen
--                       + gps_pings.created_at + api access all > 3h stale)
--   - Every push includes rep's first name. Polite tone.
--
-- Frozen contracts touched: NONE (work_sessions is Phase 12, not in §28 list).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS,
-- CREATE OR REPLACE everywhere. DROP POLICY IF EXISTS before CREATE.
-- ALTER cron jobs unscheduled+rescheduled at file end so re-running
-- doesn't double-fire.


-- =====================================================================
-- §1. work_sessions — add attendance columns
-- =====================================================================
ALTER TABLE public.work_sessions
  ADD COLUMN IF NOT EXISTS check_in_status   text
    CHECK (check_in_status IS NULL OR check_in_status IN ('on_time','late','half_day','absent'));

ALTER TABLE public.work_sessions
  ADD COLUMN IF NOT EXISTS late_minutes      int;

ALTER TABLE public.work_sessions
  ADD COLUMN IF NOT EXISTS auto_checked_out  boolean DEFAULT false;

-- Index for the no-checkin scan path (used by reminder cron RPC).
CREATE INDEX IF NOT EXISTS idx_work_sessions_today_no_checkin
  ON public.work_sessions (work_date)
  WHERE check_in_at IS NULL AND is_off_day = false;


-- =====================================================================
-- §2. attendance_warnings — audit log for reminders sent
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.attendance_warnings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  work_date   date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date,
  kind        text NOT NULL CHECK (kind IN ('no_checkin','gps_off','internet_off','admin_escalation','auto_checkout','marked_absent')),
  attempt_num int  DEFAULT 1,
  message     text,
  sent_at     timestamptz DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_attendance_warnings_user_date
  ON public.attendance_warnings (user_id, work_date DESC);

-- Idempotency guard: avoid duplicate reminders for the same (user, date,
-- kind, attempt_num). Edge function uses ON CONFLICT to no-op when the
-- cron fires twice due to a clock skew retry.
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_warnings_dedupe
  ON public.attendance_warnings (user_id, work_date, kind, attempt_num);

ALTER TABLE public.attendance_warnings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS aw_admin_all   ON public.attendance_warnings;
DROP POLICY IF EXISTS aw_self_select ON public.attendance_warnings;

-- Admin / co_owner see + write everything.
CREATE POLICY aw_admin_all ON public.attendance_warnings
  FOR ALL TO authenticated
  USING      (public.get_my_role() IN ('admin','co_owner'))
  WITH CHECK (public.get_my_role() IN ('admin','co_owner'));

-- Rep can read their own audit (so a polite "you missed check-in twice
-- today" UI is possible later).
CREATE POLICY aw_self_select ON public.attendance_warnings
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());


-- =====================================================================
-- §3. Helpers
-- =====================================================================

-- 3.1 IST today.
CREATE OR REPLACE FUNCTION public.ist_today() RETURNS date
LANGUAGE sql STABLE AS $$
  SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date
$$;

-- 3.2 IST timestamp now.
CREATE OR REPLACE FUNCTION public.ist_now() RETURNS timestamp
LANGUAGE sql STABLE AS $$
  SELECT (now() AT TIME ZONE 'Asia/Kolkata')
$$;

-- 3.3 First name of a user for personalized copy.
CREATE OR REPLACE FUNCTION public.user_first_name(p_user uuid) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT split_part(COALESCE(name, 'there'), ' ', 1)
  FROM public.users WHERE id = p_user
$$;

-- 3.4 Is today a workday for this user? Mon-Sat AND not in holidays
-- AND user has no approved leave row for today.
CREATE OR REPLACE FUNCTION public.is_workday_for(p_user uuid, p_date date DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_date date := COALESCE(p_date, public.ist_today());
  v_dow  int  := EXTRACT(dow FROM v_date)::int;  -- 0=Sun, 6=Sat
BEGIN
  -- Sunday off.
  IF v_dow = 0 THEN RETURN false; END IF;

  -- Holiday master list.
  IF EXISTS (SELECT 1 FROM public.holidays WHERE holiday_date = v_date) THEN
    RETURN false;
  END IF;

  -- Approved leave row covers this date. The leaves table is one row
  -- per (user, day) — Phase 36 design. leave_date is the absent day,
  -- leave_type the kind ('annual','sick','unpaid_absent','etc.').
  IF EXISTS (
    SELECT 1 FROM public.leaves
    WHERE user_id = p_user
      AND status = 'approved'
      AND leave_date = v_date
  ) THEN
    RETURN false;
  END IF;

  RETURN true;
END $$;


-- =====================================================================
-- §4. record_checkin RPC — swipe-to-check-in writes here
-- =====================================================================
-- Returns: {
--   status: 'on_time'|'late'|'half_day',
--   late_minutes: int,
--   check_in_at: timestamptz,
--   work_date: date,
--   name: text
-- }
CREATE OR REPLACE FUNCTION public.record_checkin(
  p_lat numeric DEFAULT NULL,
  p_lng numeric DEFAULT NULL
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
  v_existing       record;
  v_name           text;
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

  -- Insert or update today's row. UNIQUE(user_id, work_date) guarantees
  -- one row per rep per day. If a row exists from earlier in the day
  -- (created by plan submission etc.), update its check_in fields.
  INSERT INTO public.work_sessions (
    user_id, work_date, check_in_at, check_in_gps_lat, check_in_gps_lng,
    check_in_status, late_minutes
  )
  VALUES (v_user, v_date, v_check_in_at, p_lat, p_lng, v_status, v_late_minutes)
  ON CONFLICT (user_id, work_date) DO UPDATE
    SET check_in_at      = COALESCE(public.work_sessions.check_in_at, EXCLUDED.check_in_at),
        check_in_gps_lat = COALESCE(public.work_sessions.check_in_gps_lat, EXCLUDED.check_in_gps_lat),
        check_in_gps_lng = COALESCE(public.work_sessions.check_in_gps_lng, EXCLUDED.check_in_gps_lng),
        check_in_status  = COALESCE(public.work_sessions.check_in_status, EXCLUDED.check_in_status),
        late_minutes     = COALESCE(public.work_sessions.late_minutes,    EXCLUDED.late_minutes);

  -- Resolve any open no_checkin warnings for today (so future scans
  -- skip this user).
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
    'check_in_at',  v_check_in_at,
    'work_date',    v_date,
    'name',         v_name
  );
END $$;

REVOKE ALL ON FUNCTION public.record_checkin(numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_checkin(numeric, numeric) TO authenticated;


-- =====================================================================
-- §5. is_checked_in_today RPC — gate query for /check-in vs /work
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

  SELECT check_in_at, check_in_status, late_minutes, work_date
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
    'work_date',    public.ist_today(),
    'is_workday',   public.is_workday_for(v_user),
    'name',         v_name
  );
END $$;

REVOKE ALL ON FUNCTION public.is_checked_in_today() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_checked_in_today() TO authenticated;


-- =====================================================================
-- §6. enqueue_attendance_reminder — called by cron edge functions
-- =====================================================================
-- Pushes a polite message + writes attendance_warnings audit row.
-- ON CONFLICT (user_id, work_date, kind, attempt_num) DO NOTHING so
-- a cron retry doesn't double-push.
CREATE OR REPLACE FUNCTION public.enqueue_attendance_reminder(
  p_user        uuid,
  p_kind        text,
  p_attempt     int,
  p_title       text,
  p_body        text,
  p_url         text DEFAULT '/check-in'
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_inserted boolean;
BEGIN
  INSERT INTO public.attendance_warnings (user_id, work_date, kind, attempt_num, message)
  VALUES (p_user, public.ist_today(), p_kind, p_attempt, p_title || ' — ' || COALESCE(p_body, ''))
  ON CONFLICT (user_id, work_date, kind, attempt_num) DO NOTHING
  RETURNING true INTO v_inserted;

  IF v_inserted IS NULL THEN
    -- Already pushed this attempt today — short-circuit.
    RETURN false;
  END IF;

  PERFORM public.enqueue_push(
    p_user,
    p_title,
    p_body,
    p_url,
    'attendance-' || p_kind || '-' || public.ist_today()::text || '-' || p_attempt::text
  );
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.enqueue_attendance_reminder(uuid, text, int, text, text, text) FROM PUBLIC;


-- =====================================================================
-- §7. tick_attendance() — single entry point called by pg_cron
-- =====================================================================
-- Reads IST clock + decides which action to perform. Keeps cron
-- registration simple (one job per minute) while the SQL body owns
-- the dispatch logic.
--
-- Phase 60 ships with this single dispatcher; later phases can split
-- into edge functions when the body grows.
CREATE OR REPLACE FUNCTION public.tick_attendance()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ist     timestamp := public.ist_now();
  v_date    date := v_ist::date;
  v_hhmm    int  := EXTRACT(hour FROM v_ist)::int * 100 + EXTRACT(minute FROM v_ist)::int;
  v_dow     int  := EXTRACT(dow FROM v_date)::int;
  v_row     record;
  v_name    text;
  v_pushed  int := 0;
  v_skipped int := 0;
  v_admin   record;
BEGIN
  -- Sunday short-circuit.
  IF v_dow = 0 THEN
    RETURN jsonb_build_object('skipped','sunday');
  END IF;

  -- Holiday short-circuit (all users — saves loop work).
  IF EXISTS (SELECT 1 FROM public.holidays WHERE holiday_date = v_date) THEN
    RETURN jsonb_build_object('skipped','holiday');
  END IF;

  -- 7a. Rep reminders. Fires at exactly 9:30 / 10:00 / 10:15 / 10:30 IST.
  -- HHMM int math avoids floating-point drift in cron schedules.
  --
  -- Role scope: SALES + TELECALLER.
  -- Jubin (sales head) and Renuka (TC head) ride along on their base
  -- role (sales / telecaller) — there is no separate sales_manager
  -- role in users.role. Phase 42 stores management distinction in
  -- users.team_role; attendance doesn't need that distinction.
  -- Agency role is excluded across the entire attendance module —
  -- they're commission-only (quote + payment update); no field work,
  -- no GPS, no check-in. Admin / co_owner are excluded because they
  -- ARE the owner — they receive escalation pushes, not their own
  -- check-in nudges.
  IF v_hhmm IN (930, 1000, 1015, 1030) THEN
    FOR v_row IN
      SELECT u.id AS user_id, u.name
        FROM public.users u
       WHERE u.is_active = true
         AND u.role IN ('sales','telecaller')
         AND public.is_workday_for(u.id, v_date)
         AND NOT EXISTS (
           SELECT 1 FROM public.work_sessions w
            WHERE w.user_id = u.id
              AND w.work_date = v_date
              AND w.check_in_at IS NOT NULL
         )
    LOOP
      v_name := split_part(COALESCE(v_row.name, 'there'), ' ', 1);
      IF v_hhmm = 930 THEN
        IF public.enqueue_attendance_reminder(
          v_row.user_id, 'no_checkin', 1,
          'Good morning, ' || v_name,
          v_name || ', swipe to check-in when you''re ready. We''re rooting for you.',
          '/check-in'
        ) THEN v_pushed := v_pushed + 1; ELSE v_skipped := v_skipped + 1; END IF;
      ELSIF v_hhmm = 1000 THEN
        IF public.enqueue_attendance_reminder(
          v_row.user_id, 'no_checkin', 2,
          v_name || ', a quick reminder',
          'Hope all''s well. A check-in helps us plan your day together.',
          '/check-in'
        ) THEN v_pushed := v_pushed + 1; ELSE v_skipped := v_skipped + 1; END IF;
      ELSIF v_hhmm = 1015 THEN
        IF public.enqueue_attendance_reminder(
          v_row.user_id, 'no_checkin', 3,
          v_name || ', friendly nudge',
          'Check-in is still open. Tap when you can.',
          '/check-in'
        ) THEN v_pushed := v_pushed + 1; ELSE v_skipped := v_skipped + 1; END IF;
      ELSIF v_hhmm = 1030 THEN
        IF public.enqueue_attendance_reminder(
          v_row.user_id, 'no_checkin', 4,
          v_name || ', heads-up',
          'Past 11:30 IST counts as half-day. Tap soon — we care about your day.',
          '/check-in'
        ) THEN v_pushed := v_pushed + 1; ELSE v_skipped := v_skipped + 1; END IF;

        -- 4th attempt = also fire admin escalation push.
        FOR v_admin IN
          SELECT id FROM public.users WHERE role IN ('admin','co_owner') AND is_active = true
        LOOP
          PERFORM public.enqueue_attendance_reminder(
            v_admin.id, 'admin_escalation',
            (EXTRACT(EPOCH FROM v_ist - v_date::timestamp)::int / 60),  -- minute-of-day for uniqueness
            'Heads up: ' || v_name || ' not checked in',
            v_name || ' has missed check-in. A quick nudge from you helps.',
            '/people?tab=team'
          );
        END LOOP;
      END IF;
    END LOOP;
  END IF;

  -- 7b. GPS-off scan — every 15 min between 9:30 and 19:45 IST.
  -- Only fires for users WHO ARE CHECKED IN AND NOT YET CHECKED OUT.
  IF v_hhmm BETWEEN 930 AND 1945
     AND (EXTRACT(minute FROM v_ist)::int % 15 = 0) THEN
    FOR v_row IN
      SELECT u.id AS user_id, u.name
        FROM public.users u
        JOIN public.work_sessions w
          ON w.user_id = u.id AND w.work_date = v_date
       WHERE u.is_active = true
         AND u.role IN ('sales','telecaller')
         AND w.check_in_at IS NOT NULL
         AND w.check_out_at IS NULL
         AND public.is_workday_for(u.id, v_date)
         -- No fresh GPS ping in 30 min.
         AND NOT EXISTS (
           SELECT 1 FROM public.gps_pings g
            WHERE g.user_id = u.id
              AND g.created_at > now() - interval '30 minutes'
         )
    LOOP
      v_name := split_part(COALESCE(v_row.name, 'there'), ' ', 1);
      PERFORM public.enqueue_attendance_reminder(
        v_row.user_id, 'gps_off',
        EXTRACT(hour FROM v_ist)::int * 100 + EXTRACT(minute FROM v_ist)::int,
        v_name || ', your GPS is off',
        'Turning it on helps us count your kms for TA accurately.',
        '/work'
      );
      v_pushed := v_pushed + 1;
    END LOOP;
  END IF;

  -- 7c. Internet-off admin scan — every 30 min, 3 h+ staleness.
  IF (EXTRACT(minute FROM v_ist)::int % 30 = 0) THEN
    FOR v_row IN
      SELECT u.id AS user_id, u.name,
             COALESCE(
               (SELECT max(last_seen_at) FROM public.push_subscriptions ps WHERE ps.user_id = u.id),
               (SELECT max(created_at) FROM public.gps_pings g WHERE g.user_id = u.id)
             ) AS last_seen
        FROM public.users u
        JOIN public.work_sessions w
          ON w.user_id = u.id AND w.work_date = v_date
       WHERE u.is_active = true
         AND u.role IN ('sales','telecaller')
         AND w.check_in_at IS NOT NULL
         AND w.check_out_at IS NULL
         AND public.is_workday_for(u.id, v_date)
    LOOP
      IF v_row.last_seen IS NULL OR v_row.last_seen < now() - interval '3 hours' THEN
        v_name := split_part(COALESCE(v_row.name, 'there'), ' ', 1);
        FOR v_admin IN
          SELECT id FROM public.users WHERE role IN ('admin','co_owner') AND is_active = true
        LOOP
          PERFORM public.enqueue_attendance_reminder(
            v_admin.id, 'internet_off',
            (EXTRACT(EPOCH FROM v_ist - v_date::timestamp)::int / 60),
            'Heads up: ' || v_name || ' phone offline',
            v_name || '''s phone has been offline 3+ hrs. A quick check helps.',
            '/people?tab=team'
          );
        END LOOP;
        v_pushed := v_pushed + 1;
      END IF;
    END LOOP;
  END IF;

  -- 7d. Auto-checkout at 20:00 IST.
  IF v_hhmm = 2000 THEN
    FOR v_row IN
      SELECT w.id, w.user_id, w.daily_counters, u.name
        FROM public.work_sessions w
        JOIN public.users u ON u.id = w.user_id
       WHERE w.work_date = v_date
         AND w.check_in_at IS NOT NULL
         AND w.check_out_at IS NULL
    LOOP
      UPDATE public.work_sessions
         SET check_out_at = now(),
             auto_checked_out = true
       WHERE id = v_row.id;

      v_name := split_part(COALESCE(v_row.name, 'there'), ' ', 1);
      PERFORM public.enqueue_attendance_reminder(
        v_row.user_id, 'auto_checkout', 1,
        'Day complete, ' || v_name,
        'Rest up. We''ll see you tomorrow.',
        '/my-performance'
      );
      v_pushed := v_pushed + 1;
    END LOOP;
  END IF;

  -- 7e. Mark-absent at 20:30 IST — users who never checked in get
  -- an unpaid_absent leave row that Phase 36 unpaid-leave math reads.
  IF v_hhmm = 2030 THEN
    FOR v_row IN
      SELECT u.id AS user_id, u.name
        FROM public.users u
       WHERE u.is_active = true
         AND u.role IN ('sales','telecaller')
         AND public.is_workday_for(u.id, v_date)
         AND NOT EXISTS (
           SELECT 1 FROM public.work_sessions w
            WHERE w.user_id = u.id
              AND w.work_date = v_date
              AND w.check_in_at IS NOT NULL
         )
         -- Don't double-insert if already absent-marked today.
         AND NOT EXISTS (
           SELECT 1 FROM public.leaves l
            WHERE l.user_id = u.id
              AND l.leave_type = 'unpaid_absent'
              AND l.leave_date = v_date
         )
    LOOP
      INSERT INTO public.leaves (
        user_id, leave_date, leave_type, status, is_paid_request, is_half_day, reason, admin_note
      )
      VALUES (
        v_row.user_id, v_date, 'unpaid_absent', 'approved', false, false,
        'No check-in by 20:30 IST',
        'Auto-created by tick_attendance() — Phase 60.'
      );

      -- Also INSERT or UPDATE work_sessions with status='absent' for the UI.
      INSERT INTO public.work_sessions (user_id, work_date, check_in_status, is_off_day, off_reason)
      VALUES (v_row.user_id, v_date, 'absent', true, 'No check-in (auto-absent)')
      ON CONFLICT (user_id, work_date) DO UPDATE
        SET check_in_status = 'absent',
            is_off_day      = true,
            off_reason      = 'No check-in (auto-absent)';

      v_name := split_part(COALESCE(v_row.name, 'there'), ' ', 1);
      PERFORM public.enqueue_attendance_reminder(
        v_row.user_id, 'marked_absent', 1,
        v_name || ', today logged as unpaid absent',
        'No check-in recorded. Please reach your manager if this is a mistake.',
        '/my-performance'
      );
      v_pushed := v_pushed + 1;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('pushed', v_pushed, 'skipped', v_skipped, 'ist_hhmm', v_hhmm);
END $$;

REVOKE ALL ON FUNCTION public.tick_attendance() FROM PUBLIC;
-- service role can invoke via SQL; pg_cron runs as table owner.


-- =====================================================================
-- §8. pg_cron registration
-- =====================================================================
-- Schedule tick_attendance() every minute. The function's HHMM gate
-- ensures actual side effects fire only at the configured timestamps.
-- Cheap: each tick is ~5ms when nothing matches.
SELECT cron.unschedule('attendance-tick')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'attendance-tick');

SELECT cron.schedule(
  'attendance-tick',
  '* * * * *',
  $$ SELECT public.tick_attendance(); $$
);


NOTIFY pgrst, 'reload schema';


-- =====================================================================
-- §9. VERIFY
-- =====================================================================
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'work_sessions'
      AND column_name IN ('check_in_status','late_minutes','auto_checked_out'))    AS work_sessions_columns,
  (SELECT count(*) FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'attendance_warnings')          AS attendance_warnings_table,
  (SELECT count(*) FROM pg_proc
    WHERE proname IN ('ist_today','ist_now','user_first_name','is_workday_for',
                      'record_checkin','is_checked_in_today',
                      'enqueue_attendance_reminder','tick_attendance'))            AS functions,
  (SELECT count(*) FROM cron.job WHERE jobname = 'attendance-tick')                AS cron_job,
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'attendance_warnings')             AS rls_policies;

-- Expected:
--   work_sessions_columns      = 3
--   attendance_warnings_table  = 1
--   functions                  = 8
--   cron_job                   = 1
--   rls_policies               = 2
