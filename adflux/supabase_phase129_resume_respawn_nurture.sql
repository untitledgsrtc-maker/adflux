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
-- -------------------------------------------------------------------------
-- lead_pause_close_auto_followups REMOVED from this file (Phase 178).
-- Canonical: db/functions/lead_pause_close_auto_followups.sql.  Do NOT re-add (§71). Trigger wiring stays.
-- -------------------------------------------------------------------------

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
