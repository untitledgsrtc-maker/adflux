-- supabase_phase34z61_morning_checkin_push.sql
--
-- Phase 34Z.61 — 9:30 AM IST "Good morning · time to check in" push.
-- 15 May 2026
--
-- Owner directive: "At the morning, around 9:30 AM, push the
-- notification that 'good morning, it's your punching time, open
-- and check in.' In a good manner so they're not frustrated."
--
-- Adds:
--   • public.push_morning_checkin() — for each active sales/agency/
--     telecaller rep WITHOUT a check_in_at in today's work_sessions
--     row, fires a friendly push. Phase 33W's push_daily_reminders
--     already handles overdue follow-ups + 3-day-miss streak at
--     9:00 AM; this is the gentle nudge 30 min later for reps who
--     still haven't punched in.
--   • cron job 'untitled-morning-checkin' at 04:00 UTC (= 09:30 IST).
--
-- Idempotent.

-- ─── 1. Function ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.push_morning_checkin()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_count int := 0;
  v_rep   record;
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_dow   int  := EXTRACT(DOW FROM v_today)::int;  -- 0 = Sunday
  v_holiday boolean;
BEGIN
  -- Skip Sundays + active holidays. Owner directive: "in a good
  -- manner so they're not frustrated" — no spam on days off.
  IF v_dow = 0 THEN
    RETURN 0;
  END IF;
  SELECT EXISTS(
    SELECT 1 FROM public.holidays
     WHERE holiday_date = v_today AND COALESCE(is_active, true)
  ) INTO v_holiday;
  IF v_holiday THEN
    RETURN 0;
  END IF;

  FOR v_rep IN
    SELECT u.id, u.name
      FROM public.users u
     WHERE u.role IN ('sales', 'agency', 'telecaller')
       AND COALESCE(u.is_active, true) = true
       AND NOT EXISTS (
         SELECT 1
           FROM public.work_sessions ws
          WHERE ws.user_id   = u.id
            AND ws.work_date = v_today
            AND ws.check_in_at IS NOT NULL
       )
  LOOP
    PERFORM public.enqueue_push(
      v_rep.id,
      'Good morning, ' || COALESCE(split_part(v_rep.name, ' ', 1), 'team') || ' · time to check in',
      'Tap to open /work, submit your plan, and start your day.',
      '/work',
      'morning-checkin-' || to_char(v_today, 'YYYY-MM-DD')
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public.push_morning_checkin() TO authenticated;


-- ─── 2. Schedule the cron ────────────────────────────────────────
-- 9:30 IST = 04:00 UTC. Re-run safely.
DO $$
BEGIN
  PERFORM cron.unschedule('untitled-morning-checkin');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'untitled-morning-checkin',
  '0 4 * * *',  -- 04:00 UTC daily = 09:30 IST
  $$ SELECT public.push_morning_checkin(); $$
);

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────
-- Returns the rep count that WOULD get pushed if it fired right now.
-- Cron-managed jobname check too.
SELECT
  (SELECT count(*) FROM cron.job WHERE jobname = 'untitled-morning-checkin') AS cron_present,
  (SELECT count(*)
     FROM public.users u
    WHERE u.role IN ('sales','agency','telecaller')
      AND COALESCE(u.is_active, true) = true
      AND NOT EXISTS (
        SELECT 1 FROM public.work_sessions ws
         WHERE ws.user_id = u.id
           AND ws.work_date = (now() AT TIME ZONE 'Asia/Kolkata')::date
           AND ws.check_in_at IS NOT NULL
      )
  ) AS would_push_now;
