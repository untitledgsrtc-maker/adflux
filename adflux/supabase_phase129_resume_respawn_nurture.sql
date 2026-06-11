-- =====================================================================
-- PHASE 129 — Resume on a Nurture lead books the next 30-day check-in
-- 2026-06-11
-- REQUIRES 128.3 applied first (trg_lead_pause_close_auto_followups
-- must exist — this file only replaces the function body).
--
-- Owner directive (verbatim intent): "only need if in nurture — follow
-- up must see after 30 day only, not before."
--
-- Phase 128.3 made the pause toggle CLOSE open auto follow-ups; Resume
-- left the lead silent forever. Now: flipping cadence_paused OFF on a
-- lead whose stage = 'Nurture' spawns the nurture check-in dated
-- next_workday(today + 30 days) — never earlier (spawn_nurture_followup
-- adds the +30 internally, verified 33d6:118). Strictly Nurture-only
-- per owner: Lost / Working / etc. resume to silence as before.
--
-- §28-safe: same trigger event as 128.3 (UPDATE OF cadence_paused — the
-- toggle click only, zero hot-path cost §45); cadence types unchanged;
-- no push fn touched; duplicate-guard skips the spawn when an open
-- nurture row already exists. CREATE OR REPLACE swaps the 128.3 function
-- body in place — the pause-ON close branch below is byte-identical to
-- 128.3; only the resume ELSIF is new. Trigger DDL untouched.
-- =====================================================================

-- Guardian note (carried from 128.3): each close fires
-- trg_followup_after_done; the cascade converges on truth1's
-- cadence_paused gate -> no respawn, no push. The NEW resume spawn fires
-- AFTER pause flips false, so followup_after_done's stage gate ('nurture'
-- respawns only while stage='Nurture') is the loop bound there.
CREATE OR REPLACE FUNCTION public.lead_pause_close_auto_followups()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
BEGIN
  IF NEW.cadence_paused IS TRUE AND OLD.cadence_paused IS DISTINCT FROM TRUE THEN
    -- Pause ON: close open AUTO follow-ups (Phase 128.3, unchanged).
    UPDATE public.follow_ups
       SET is_done = true,
           note = COALESCE(note, '') || ' [closed: auto follow-ups paused]'
     WHERE lead_id = NEW.id
       AND is_done = false
       AND (cadence_type IN ('lead_intro','quote_chase','nurture','lost_nurture')
            OR (cadence_type IS NULL AND auto_generated = true
                AND note LIKE 'Auto-scheduled:%'));

  ELSIF NEW.cadence_paused IS NOT TRUE AND OLD.cadence_paused IS TRUE THEN
    -- PHASE-129 Resume: Nurture leads ONLY — book the next check-in at
    -- +30 days (next workday), never earlier. Skip when an open nurture
    -- row already exists (idempotent re-toggle safe).
    IF NEW.stage = 'Nurture' THEN
      v_owner := COALESCE(NEW.assigned_to, NEW.created_by);
      IF v_owner IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.follow_ups
         WHERE lead_id = NEW.id AND is_done = false AND cadence_type = 'nurture'
      ) THEN
        PERFORM public.spawn_nurture_followup(NEW.id, v_owner, CURRENT_DATE, 'nurture');
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- self-register
DO $$
BEGIN
  IF to_regclass('public.applied_migrations') IS NOT NULL THEN
    INSERT INTO public.applied_migrations (name, note)
    VALUES ('supabase_phase129_resume_respawn_nurture.sql',
            'Resume on Nurture lead books next 30-day check-in (+30d, never earlier)')
    ON CONFLICT (name) DO NOTHING;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY — expect t / t / 1 ────────────────────────────────────────
SELECT
  (SELECT position('PHASE-129' in pg_get_functiondef(oid)) > 0
     FROM pg_proc WHERE proname='lead_pause_close_auto_followups' LIMIT 1) AS resume_branch,
  (SELECT position('auto follow-ups paused' in pg_get_functiondef(oid)) > 0
     FROM pg_proc WHERE proname='lead_pause_close_auto_followups' LIMIT 1) AS pause_close_kept,
  (SELECT count(*) FROM pg_trigger
    WHERE tgname='trg_lead_pause_close_auto_followups')                    AS trigger_present;

SELECT 'Phase 129 resume -> +30d nurture check-in applied' AS status;
