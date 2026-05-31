-- =====================================================================
-- Phase 103.E.1 — meeting KPI drift fix (counter > real rows)
-- 2026-05-31 (Brijesh Solanki)
-- =====================================================================
--
-- BUG (diagnosed 31 May, Dixita):
--   daily_counters.meetings showed 4 but she had 3 real meeting rows
--   (all unique leads). The counter is HIGHER than reality.
--
-- ROOT CAUSE:
--   Every meeting-counter path is an AFTER **INSERT** trigger
--   (lead_activity_bump_counter, Phase 98.H, with the Phase 93.7 unique
--   dedup). There is NO decrement on DELETE. So:
--       log meeting   -> meetings + 1
--       delete meeting-> meetings UNCHANGED   <-- orphan +1 left behind
--   Re-logged / mistaken / deleted meetings each leave a stuck +1, so
--   the counter drifts above the true unique-meeting count over time.
--   Phase 32n / 93.7 fixed the INSERT side (duplicates / revisits).
--   Nobody ever fixed the DELETE side. That's the regression the owner
--   remembered "solving" — it was only ever half-solved.
--
-- WHAT THIS DOES (3 parts, all idempotent):
--   1. recompute_daily_meetings(user, date) — SETs daily_counters.meetings
--      to the TRUE unique count (same dedup key as the Phase 93.7 insert
--      bump: distinct lead_id for linked leads, each walk-in counts once,
--      auto-check-in companion rows excluded). It can only ever make the
--      counter MATCH reality — it cannot inflate.
--   2. AFTER DELETE trigger on lead_activities — recomputes when a
--      meeting/site_visit row is deleted, so the counter self-heals
--      forever. No more orphan +1.
--   3. One-time heal of the last 7 days' sessions, fixing the current
--      drift (Dixita 4 -> 3 today + any other rep/day that drifted).
--
-- WHAT THIS DOES NOT TOUCH:
--   - The INSERT bump (lead_activity_bump_counter) — it is correct on
--     insert (the data proved no double-insert). Left as-is.
--   - The score trigger (tg_score_on_activity, Phase 34Z.66) — separate.
--     NOTE: if a day's meetings were inflated, that day's *score* may
--     also have been inflated. This fix corrects the COUNTER only; say
--     the word and I'll recompute affected scores separately.
--   - calls / new_leads counters — same latent delete-drift exists but
--     is out of scope for this fix (owner reported meetings). Flagged.
-- =====================================================================

-- ── 1. Recompute helper ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.recompute_daily_meetings(p_user uuid, p_date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_count int;
BEGIN
  -- Unique meetings for the day. Dedup key matches Phase 93.7:
  --   linked lead  -> one per lead_id (revisits collapse)
  --   walk-in      -> lead_id NULL -> fall back to the row id (each unique)
  -- Auto-check-in companion rows are excluded (Phase 93.6).
  SELECT count(DISTINCT COALESCE(lead_id::text, id::text))
    INTO v_count
    FROM public.lead_activities
   WHERE created_by      = p_user
     AND activity_type   IN ('meeting', 'site_visit')
     AND created_at::date = p_date
     AND (notes IS NULL OR notes NOT LIKE 'I''m here · auto-check-in%');

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

-- Internal helper only — not an RPC. It can't inflate (it counts real
-- rows), but keep it off the public surface anyway.
REVOKE EXECUTE ON FUNCTION public.recompute_daily_meetings(uuid, date) FROM PUBLIC;

-- ── 2. Self-heal on DELETE ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lead_activity_meeting_recount_on_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF OLD.activity_type IN ('meeting', 'site_visit') THEN
    PERFORM public.recompute_daily_meetings(OLD.created_by, OLD.created_at::date);
  END IF;
  RETURN OLD;
END
$function$;

DROP TRIGGER IF EXISTS trg_lead_activity_meeting_recount_del ON public.lead_activities;
CREATE TRIGGER trg_lead_activity_meeting_recount_del
  AFTER DELETE ON public.lead_activities
  FOR EACH ROW
  EXECUTE FUNCTION public.lead_activity_meeting_recount_on_delete();

-- ── 3. One-time heal: last 7 days of sessions ────────────────────────
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
-- V1: Dixita's counter now equals her real unique meetings (was 4).
--   SELECT (work_sessions.daily_counters->>'meetings') AS counter_now,
--          (SELECT count(DISTINCT COALESCE(lead_id::text, id::text))
--             FROM lead_activities
--            WHERE created_by = 'caa6236a-844b-4097-8d93-f71d9b28ffae'
--              AND activity_type IN ('meeting','site_visit')
--              AND created_at::date = CURRENT_DATE
--              AND (notes IS NULL OR notes NOT LIKE 'I''m here · auto-check-in%')
--          ) AS real_unique
--     FROM work_sessions
--    WHERE user_id = 'caa6236a-844b-4097-8d93-f71d9b28ffae'
--      AND work_date = CURRENT_DATE;
--   Expected: counter_now = real_unique (both 3).
--
-- V2: the delete-heal trigger exists.
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'public.lead_activities'::regclass
--      AND tgname = 'trg_lead_activity_meeting_recount_del';
--   Expected: one row.
--
-- V3 (manual smoke): log a meeting (counter +1), delete it
--   (counter returns to prior value — no orphan). Before this fix the
--   delete left the +1 stuck.
-- =====================================================================
