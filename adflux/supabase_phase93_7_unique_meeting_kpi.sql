-- =====================================================================
-- Phase 93.7 — meeting KPI = unique lead per day (revisits don't count)
-- 25 May 2026
--
-- WHY
--
-- Owner directive (25 May 2026): "only unique meeting can be count in
-- KPI, revisit dont count in KPi". Phase 93.6 stopped auto-check-in
-- companion rows from inflating the counter. This phase further
-- ensures a second/third visit to the SAME lead on the same day adds
-- only 1 to the rep's meeting KPI.
--
-- Walk-in meetings (lead_id IS NULL) — each counts as unique by
-- definition (no lead to dedupe against).
--
-- WHAT
--
-- 1. Replace bump_meeting_counter trigger function:
--    - Drop auto-check-in rows (already in 93.6).
--    - NEW: if this rep already has a non-companion meeting/site_visit
--      row TODAY for the same lead_id (and NEW.lead_id is not null),
--      skip the bump — it's a revisit.
--    - If NEW.lead_id IS NULL (walk-in), always bump.
--
-- 2. Backfill daily_counters.meetings for last 7 days using
--    unique-key dedupe (lead_id when present, else activity_id as
--    surrogate so walk-ins each count).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.bump_meeting_counter()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date date := CURRENT_DATE;
  v_user uuid := NEW.created_by;
  v_already_today int;
BEGIN
  -- Only bump for meeting / site_visit activities.
  IF NEW.activity_type NOT IN ('meeting', 'site_visit') THEN
    RETURN NEW;
  END IF;

  -- Phase 93.6 — skip "I'm here · auto-check-in" companion rows.
  IF NEW.notes IS NOT NULL
     AND NEW.notes LIKE 'I''m here · auto-check-in%' THEN
    RETURN NEW;
  END IF;

  -- Phase 93.7 — revisit detection. If NEW.lead_id is set AND the rep
  -- already has a non-companion meeting row today for the same lead,
  -- this is a revisit. Don't bump the KPI. Walk-ins (lead_id NULL)
  -- always bump because they can't be dedupe'd.
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
      RETURN NEW;  -- revisit; KPI already credited for this lead today
    END IF;
  END IF;

  -- First meeting/site_visit with this lead today (or a walk-in).
  -- Bump the counter.
  INSERT INTO work_sessions (user_id, work_date, daily_counters)
  VALUES (v_user, v_date, jsonb_build_object('meetings', 1, 'calls', 0, 'new_leads', 0))
  ON CONFLICT (user_id, work_date) DO UPDATE
    SET daily_counters = COALESCE(work_sessions.daily_counters, '{}'::jsonb)
                         || jsonb_build_object(
                              'meetings',
                              COALESCE((work_sessions.daily_counters->>'meetings')::int, 0) + 1
                            );
  RETURN NEW;
END;
$$;


-- ─── Backfill daily_counters.meetings for last 7 days ───────────────
-- Unique meeting count = distinct lead_id (when present) + every
-- walk-in row (lead_id NULL). Use COUNT(DISTINCT ...) on a surrogate
-- key that's lead_id::text when set, else 'walkin_' || activity_id.
UPDATE public.work_sessions ws
   SET daily_counters = jsonb_set(
         COALESCE(ws.daily_counters, '{}'::jsonb),
         '{meetings}',
         to_jsonb((
           SELECT count(DISTINCT COALESCE(la.lead_id::text, 'walkin_' || la.id::text))
             FROM public.lead_activities la
            WHERE la.created_by      = ws.user_id
              AND la.created_at::date = ws.work_date
              AND la.activity_type   IN ('meeting', 'site_visit')
              AND (la.notes IS NULL
                   OR la.notes NOT LIKE 'I''m here · auto-check-in%')
         ))
       )
 WHERE ws.work_date >= CURRENT_DATE - interval '7 days';


NOTIFY pgrst, 'reload schema';


-- ─── VERIFY ─────────────────────────────────────────────────────────
WITH today AS (
  SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS d
)
SELECT
  u.name,
  ws.user_id,
  (ws.daily_counters->>'meetings')::int  AS jsonb_counter,
  (
    SELECT count(DISTINCT COALESCE(la.lead_id::text, 'walkin_' || la.id::text))
      FROM public.lead_activities la
     WHERE la.created_by      = ws.user_id
       AND la.created_at::date = ws.work_date
       AND la.activity_type   IN ('meeting', 'site_visit')
       AND (la.notes IS NULL
            OR la.notes NOT LIKE 'I''m here · auto-check-in%')
  )                                       AS unique_meetings_today
FROM public.work_sessions ws
JOIN public.users u ON u.id = ws.user_id, today
WHERE ws.work_date = today.d
  AND (ws.daily_counters->>'meetings')::int > 0
ORDER BY jsonb_counter DESC;
