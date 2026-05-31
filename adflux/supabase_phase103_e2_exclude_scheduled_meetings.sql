-- =====================================================================
-- Phase 103.E.2 — scheduled (future) meetings must not count as DONE
-- 2026-05-31 (Brijesh Solanki)
-- =====================================================================
--
-- BUG (diagnosed 31 May, Dixita — follow-up to 103.E.1):
--   She did 2 real field meetings, but the MEET KPI showed 3. The 3rd
--   row:
--       16:15  "Meeting scheduled · 2026-06-01"  (no GPS, lead exists)
--   is a FUTURE appointment she booked for tomorrow — logged by
--   PostCallOutcomeModal.jsx:697 as activity_type='meeting' with the
--   note "Meeting scheduled · <date>". It is NOT a meeting that
--   happened. It was inflating the done-meeting count by 1.
--
-- ROOT CAUSE:
--   The meeting KPI counts every activity_type IN ('meeting','site_visit')
--   row except auto-check-in companions. Scheduled-future meetings share
--   activity_type='meeting', so they leaked into the DONE count. The
--   "Meeting scheduled · " note prefix is the discriminator (only
--   PostCallOutcomeModal writes it — confirmed single source).
--
-- FIX (mirror the existing auto-check-in exclusion, everywhere meetings
--      are counted):
--   1. lead_activity_bump_counter (insert trigger) — skip the bump for
--      "Meeting scheduled%" rows, exactly like the auto-check-in skip.
--      Full Phase 98.H body reproduced VERBATIM with ONLY the new skip
--      added (calls branch + 93.7 revisit dedup byte-identical).
--   2. recompute_daily_meetings (103.E.1) — add the same exclusion so
--      the recompute + insert agree.
--   3. Re-heal last 7 days -> Dixita 3 -> 2.
--   (Frontend GpsTrackV2 uniqueMeetingCount gets the same exclusion in
--    the JS commit that ships alongside this.)
--
-- The scheduled row STAYS in the lead timeline (the rep still sees
-- "meeting booked for tomorrow") — it just stops counting as done.
--
-- NOTE (unchanged from 103.E.1): a day whose meetings were inflated may
--   have an inflated SCORE (compute_daily_score, 34Z.66) — that reads
--   meeting activities too and would also count scheduled rows. Flagged;
--   score recompute is a separate ask.
-- =====================================================================

-- ── 1. Insert trigger: skip scheduled-future meetings ────────────────
CREATE OR REPLACE FUNCTION public.lead_activity_bump_counter()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_already_today int;
  v_sibling_call  int;
BEGIN
  -- ── Calls branch (Phase 98.H) — byte-identical ──
  IF NEW.activity_type = 'call' THEN
    SELECT count(*)
      INTO v_sibling_call
      FROM public.call_logs cl
     WHERE cl.lead_id = NEW.lead_id
       AND cl.user_id = NEW.created_by
       AND abs(extract(epoch FROM (cl.created_at - NEW.created_at))) < 5;

    IF v_sibling_call = 0 THEN
      PERFORM public.bump_daily_counter(
        NEW.created_by,
        'calls',
        1,
        (COALESCE(NEW.created_at, now())
           AT TIME ZONE 'Asia/Kolkata')::date
      );
    END IF;
    RETURN NEW;
  END IF;

  -- ── Meeting / site_visit branch ──
  IF NEW.activity_type IN ('meeting', 'site_visit') THEN
    -- Phase 93.6 — skip "I'm here · auto-check-in" companion rows.
    IF NEW.notes IS NOT NULL
       AND NEW.notes LIKE 'I''m here · auto-check-in%' THEN
      RETURN NEW;
    END IF;

    -- Phase 103.E.2 — skip SCHEDULED FUTURE meetings. PostCallOutcomeModal
    -- logs "Meeting scheduled · <date>" as activity_type='meeting'; it is
    -- an appointment, not a done meeting, so it must not bump the KPI.
    IF NEW.notes IS NOT NULL
       AND NEW.notes LIKE 'Meeting scheduled%' THEN
      RETURN NEW;
    END IF;

    -- Phase 93.7 — revisit detection. Walk-ins (lead_id IS NULL) always
    -- bump (can't be dedupe'd).
    IF NEW.lead_id IS NOT NULL THEN
      SELECT count(*)
        INTO v_already_today
        FROM public.lead_activities prev
       WHERE prev.created_by      = NEW.created_by
         AND prev.lead_id         = NEW.lead_id
         AND prev.activity_type   IN ('meeting', 'site_visit')
         AND prev.created_at::date = NEW.created_at::date
         AND prev.id              <> NEW.id
         AND (prev.notes IS NULL
              OR prev.notes NOT LIKE 'I''m here · auto-check-in%');

      IF v_already_today > 0 THEN
        RETURN NEW;
      END IF;
    END IF;

    PERFORM public.bump_daily_counter(NEW.created_by, 'meetings', 1);
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

-- ── 2. Recompute: same exclusion (insert + recompute must agree) ─────
CREATE OR REPLACE FUNCTION public.recompute_daily_meetings(p_user uuid, p_date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_count int;
BEGIN
  SELECT count(DISTINCT COALESCE(lead_id::text, id::text))
    INTO v_count
    FROM public.lead_activities
   WHERE created_by      = p_user
     AND activity_type   IN ('meeting', 'site_visit')
     AND created_at::date = p_date
     AND (notes IS NULL OR notes NOT LIKE 'I''m here · auto-check-in%')
     -- Phase 103.E.2 — exclude scheduled-future meetings.
     AND (notes IS NULL OR notes NOT LIKE 'Meeting scheduled%');

  INSERT INTO public.work_sessions (user_id, work_date, daily_counters)
  VALUES (p_user, p_date, jsonb_build_object('meetings', v_count))
  ON CONFLICT (user_id, work_date) DO UPDATE
    SET daily_counters = jsonb_set(
          COALESCE(public.work_sessions.daily_counters, '{}'::jsonb),
          '{meetings}',
          to_jsonb(v_count)
        );
END
$function$;

REVOKE EXECUTE ON FUNCTION public.recompute_daily_meetings(uuid, date) FROM PUBLIC;

-- ── 3. Re-heal last 7 days (now drops scheduled rows) ────────────────
DO $heal$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT user_id, work_date
      FROM public.work_sessions
     WHERE work_date >= CURRENT_DATE - 6
  LOOP
    PERFORM public.recompute_daily_meetings(r.user_id, r.work_date);
  END LOOP;
END
$heal$;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- VERIFY
-- =====================================================================
-- V1: Dixita now = 2 (the 2 real field meetings; scheduled-tomorrow drops)
--   SELECT (daily_counters->>'meetings') AS counter_now
--     FROM work_sessions
--    WHERE user_id = 'caa6236a-844b-4097-8d93-f71d9b28ffae'
--      AND work_date = CURRENT_DATE;
--   Expected: 2.
--
-- V2: the insert trigger now skips scheduled rows — the live function
--     body contains the new guard.
--   SELECT pg_get_functiondef('public.lead_activity_bump_counter()'::regprocedure)
--     LIKE '%Meeting scheduled%%' AS skips_scheduled;
--   Expected: true.
-- =====================================================================
