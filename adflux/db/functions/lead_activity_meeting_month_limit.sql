-- ============================================================================
-- db/functions/lead_activity_meeting_month_limit.sql - CANONICAL HOME (section 71)
-- ============================================================================
-- Phase 633 (19-11-2026, owner): at most 3 meetings per LEAD per month (all reps
-- together) count. BEFORE INSERT on lead_activities: a done meeting / site visit on a
-- lead that already had counted meetings on 3 different IST days this month (and none
-- yet today - a same-day revisit is already deduped by section 33) is SAVED with its
-- note prefixed 'Over monthly limit (3 meetings) · '. Every meeting counter skips that
-- prefix: lead_activity_bump_counter, recompute_daily_meetings, compute_daily_score,
-- GpsTrackV2 / useDaySummary / ManagerDashboardV2 / RepProfileV2 (section 33 lockstep).
-- Never blocks the insert; any error leaves the row untouched.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.lead_activity_meeting_month_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_day   date;
  v_start date;
  v_days  int;
BEGIN
  IF NEW.activity_type NOT IN ('meeting', 'site_visit') OR NEW.lead_id IS NULL THEN RETURN NEW; END IF;
  IF COALESCE(NEW.notes, '') LIKE 'I''m here · auto-check-in%'
     OR COALESCE(NEW.notes, '') LIKE 'Meeting scheduled%'
     OR COALESCE(NEW.notes, '') LIKE 'Over monthly limit%' THEN RETURN NEW; END IF;
  BEGIN
    v_day   := (COALESCE(NEW.created_at, now()) AT TIME ZONE 'Asia/Kolkata')::date;
    v_start := date_trunc('month', v_day)::date;
    IF EXISTS (SELECT 1 FROM public.lead_activities a
                WHERE a.lead_id = NEW.lead_id AND a.activity_type IN ('meeting', 'site_visit')
                  AND (a.created_at AT TIME ZONE 'Asia/Kolkata')::date = v_day
                  AND COALESCE(a.notes, '') NOT LIKE 'I''m here · auto-check-in%'
                  AND COALESCE(a.notes, '') NOT LIKE 'Meeting scheduled%'
                  AND COALESCE(a.notes, '') NOT LIKE 'Over monthly limit%') THEN
      RETURN NEW;   -- same-day revisit: section 33 dedup handles it
    END IF;
    SELECT count(DISTINCT (a.created_at AT TIME ZONE 'Asia/Kolkata')::date) INTO v_days
      FROM public.lead_activities a
     WHERE a.lead_id = NEW.lead_id AND a.activity_type IN ('meeting', 'site_visit')
       AND (a.created_at AT TIME ZONE 'Asia/Kolkata')::date >= v_start
       AND (a.created_at AT TIME ZONE 'Asia/Kolkata')::date <  v_day
       AND COALESCE(a.notes, '') NOT LIKE 'I''m here · auto-check-in%'
       AND COALESCE(a.notes, '') NOT LIKE 'Meeting scheduled%'
       AND COALESCE(a.notes, '') NOT LIKE 'Over monthly limit%';
    IF v_days >= 3 THEN
      NEW.notes := 'Over monthly limit (3 meetings) · ' || COALESCE(NEW.notes, '');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'lead_activity_meeting_month_limit skipped: %', SQLERRM;
  END;
  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public.lead_activity_meeting_month_limit() FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';

-- VERIFY: SELECT to_regprocedure('public.lead_activity_meeting_month_limit()') IS NOT NULL;  -- t
