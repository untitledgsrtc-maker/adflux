-- =====================================================================
-- Phase 93.7.1 + 93.7.2 — fix meeting-counter + drop duplicate score trigger
-- 26 May 2026
--
-- WHY (93.7.1)
--
-- Diagnosis (25 May 2026 session): Phase 93.6 + 93.7 SQL updated a
-- function called `bump_meeting_counter()`. That function is DEAD —
-- no trigger references it. The LIVE counter trigger
-- `trg_lead_activity_bump_counter` calls a different function:
-- `lead_activity_bump_counter()`. That live function lacks the
-- auto-check-in + revisit guards we shipped in 93.6/93.7. Net
-- effect: every meeting INSERT bumps daily_counters.meetings,
-- including companion "I'm here · auto-check-in" rows and revisits
-- to the same lead.
--
-- Owner saw: Kirti = 5 meetings on /team-dashboard, but only 2
-- unique non-companion lead_ids in lead_activities for today.
-- 3-row inflation matches the 2 companion rows + 1 revisit.
--
-- WHY (93.7.2)
--
-- Same session also revealed duplicate score triggers:
--   tg_score_on_activity            → tg_recompute_score_on_activity()
--   trg_recompute_score_on_activity → tg_recompute_score_on_activity()
-- Both fire on every lead_activities INSERT. Score recomputes
-- twice per row. Keep tg_score_on_activity (original Phase 34Z.66
-- name), drop trg_recompute_score_on_activity (duplicate).
--
-- WHAT
--
-- 1. CREATE OR REPLACE lead_activity_bump_counter() with the
--    Phase 93.6 + 93.7 guards inlined into the meeting branch.
--    Also: include 'site_visit' in the meeting bump (was missed —
--    only 'meeting' bumped before; site_visits never counted).
-- 2. Backfill daily_counters.meetings for the last 7 days using
--    COUNT DISTINCT COALESCE(lead_id::text, 'walkin_' || id::text)
--    so revisits + walk-ins resolve correctly.
-- 3. COMMENT on the DEAD bump_meeting_counter() function so future
--    grep doesn't waste time on it. Function body NOT dropped per
--    owner's "don't change anything beyond fix scope" rule.
-- 4. DROP trg_recompute_score_on_activity (duplicate). Score now
--    fires once per activity.
--
-- Idempotent. CREATE OR REPLACE + DROP TRIGGER IF EXISTS.
-- =====================================================================

-- ─── 93.7.1 — Re-target the LIVE counter function ───────────────────
CREATE OR REPLACE FUNCTION public.lead_activity_bump_counter()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_already_today int;
BEGIN
  -- Calls branch — unchanged. Every call row bumps.
  -- (Connect-rate KPI dedup handled client-side via direction filter
  -- + Phase 93.1 .or() guard. Counter intentionally raw.)
  IF NEW.activity_type = 'call' THEN
    PERFORM public.bump_daily_counter(NEW.created_by, 'calls', 1);
    RETURN NEW;
  END IF;

  -- Meeting branch — guards inline.
  IF NEW.activity_type IN ('meeting', 'site_visit') THEN
    -- Phase 93.6 — skip "I'm here · auto-check-in" companion rows.
    -- Companion shares activity_type='meeting' + GPS coords with the
    -- real meeting row, so without this guard every save double-bumps.
    IF NEW.notes IS NOT NULL
       AND NEW.notes LIKE 'I''m here · auto-check-in%' THEN
      RETURN NEW;
    END IF;

    -- Phase 93.7 — revisit detection. If NEW.lead_id is set AND the
    -- rep already has a non-companion meeting/site_visit row today
    -- for the same lead, skip. Walk-ins (lead_id IS NULL) always
    -- bump because they can't be dedupe'd.
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
        RETURN NEW;  -- revisit; KPI already credited today
      END IF;
    END IF;

    -- First non-companion meeting/site_visit for this lead today.
    PERFORM public.bump_daily_counter(NEW.created_by, 'meetings', 1);
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

-- Mark the dead function so future grep stops chasing it.
COMMENT ON FUNCTION public.bump_meeting_counter() IS
  'DEAD as of Phase 93.7.1 — no trigger references this function. '
  'The live counter trigger calls lead_activity_bump_counter() '
  'instead. Kept for blame-history but unused. Do not edit; edit '
  'lead_activity_bump_counter().';


-- ─── Backfill daily_counters.meetings for last 7 days ───────────────
-- Recompute from source-of-truth. Walk-ins keyed by activity id so
-- each is unique.
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


-- ─── 93.7.2 — Drop duplicate score trigger ──────────────────────────
DROP TRIGGER IF EXISTS trg_recompute_score_on_activity ON public.lead_activities;
-- Keep tg_score_on_activity (original Phase 34Z.66 name). Score will
-- now fire once per activity instead of twice.


NOTIFY pgrst, 'reload schema';


-- ─── VERIFY ─────────────────────────────────────────────────────────
-- After this runs:
--   * jsonb_counter and unique_meetings_today should match per rep
--   * Only 1 score trigger should remain on lead_activities
WITH today AS (
  SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS d
)
SELECT
  u.name,
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

-- Score trigger count (should be 1).
SELECT count(*) AS score_trigger_count
  FROM pg_trigger
 WHERE tgrelid = 'public.lead_activities'::regclass
   AND tgfoid = 'public.tg_recompute_score_on_activity'::regproc
   AND NOT tgisinternal;
