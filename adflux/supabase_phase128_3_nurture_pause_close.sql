-- =====================================================================
-- PHASE 128.3 — Nurture / paused leads stop leaking follow-ups + pushes
-- 2026-06-11
--
-- Owner report (Candor Maternity Home): lead in Nurture, "Auto follow-ups
-- paused" banner ON — yet the rep still has an OPEN "Auto-scheduled:
-- follow up with new lead" row (due today, fires the due-push) + an
-- "Auto: 30-day check-in" row. Two leaks in lead_stage_change_cadence()
-- (canonical body = supabase_phase33d6_full_cadence.sql:165):
--
-- Leak 1a · The cadence_paused gate sits ABOVE the cancel branch — moving
--   a paused lead to Nurture closes NOTHING. Pause was blocking cleanup,
--   not just spawns. Backwards.
-- Leak 1b · cancel_lead_cadence matches cadence_type = ANY(...); legacy
--   Phase 33D.4 auto rows have cadence_type NULL ("Auto-scheduled:" note,
--   auto_generated=true) → unmatchable, survive every stage change except
--   the Lost/Won terminal close.
-- Plus: the "Auto follow-ups paused" toggle only flipped the flag — it
--   never closed already-open auto rows, so the banner over-promised.
--
-- FIX (three parts, §28-safe — cadence types unchanged; the frozen
-- 34Z.55 / 97_a400 push functions are NOT touched: closed rows can't
-- push or list because both gate on is_done=false; truth1
-- followup_after_done untouched; spawn gates on cadence_paused preserved):
--   1. cancel_lead_cadence also closes legacy NULL-cadence auto rows
--      when 'lead_intro' is targeted.
--   2. lead_stage_change_cadence: cancels run REGARDLESS of pause;
--      only the spawns stay pause-gated. Branch set identical to 33D.6.
--   3. NEW trigger on UPDATE OF cadence_paused — flipping the pause ON
--      closes open AUTO follow-ups (manual rep follow-ups untouched).
--      Fires only on the toggle click — zero hot-path cost (§45).
--      Resume does NOT respawn (known behavior, owner-flagged).
-- + one-time heal with before/after counts.
-- =====================================================================

-- ── 1. cancel_lead_cadence: also close legacy 33D.4 auto rows ────────
CREATE OR REPLACE FUNCTION public.cancel_lead_cadence(
  p_lead_id uuid, p_types text[]
) RETURNS void LANGUAGE sql AS $$
  UPDATE public.follow_ups
     SET is_done = true,
         note = COALESCE(note, '') || ' [cancelled by stage change]'
   WHERE lead_id = p_lead_id
     AND is_done = false
     AND (
       cadence_type = ANY(p_types)
       OR ('lead_intro' = ANY(p_types)
           AND cadence_type IS NULL
           AND auto_generated = true
           AND note LIKE 'Auto-scheduled:%')
     );
$$;

-- ── 2. Stage-change trigger: cleanup unconditional, spawns pause-gated ─
-- -------------------------------------------------------------------------
-- lead_stage_change_cadence REMOVED from this file (Phase 178).
-- Canonical: db/functions/lead_stage_change_cadence.sql (§128.3 cadence stage-machine).
-- Do NOT re-add it here. Edit the canonical file only (§71). Trigger wiring stays.
-- -------------------------------------------------------------------------
-- trg_lead_stage_change_cadence already points here; no DDL needed.

-- ── 3. Pause toggle closes open AUTO follow-ups (banner becomes true) ─
-- Guardian note: each close fires trg_followup_after_done, whose auto-skip
-- can recursively close earlier-sequence rows (bounded, max ~6 lead_intro);
-- every call converges on truth1's `IF v_lead.cadence_paused THEN RETURN`
-- gate → no respawn, no push (34Z.55 early-exits on is_done=true). Single
-- user action — not a hot path. If a future BULK heal needs to bypass the
-- cascade, add a session-variable guard then.
CREATE OR REPLACE FUNCTION public.lead_pause_close_auto_followups()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.cadence_paused IS TRUE AND OLD.cadence_paused IS DISTINCT FROM TRUE THEN
    UPDATE public.follow_ups
       SET is_done = true,
           note = COALESCE(note, '') || ' [closed: auto follow-ups paused]'
     WHERE lead_id = NEW.id
       AND is_done = false
       AND (cadence_type IN ('lead_intro','quote_chase','nurture','lost_nurture')
            OR (cadence_type IS NULL AND auto_generated = true
                AND note LIKE 'Auto-scheduled:%'));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_lead_pause_close_auto_followups ON public.leads;
CREATE TRIGGER trg_lead_pause_close_auto_followups
  AFTER UPDATE OF cadence_paused ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.lead_pause_close_auto_followups();

-- ── 4. One-time heal — counts first, then close ───────────────────────
-- BEFORE counts (informational):
SELECT
  count(*) FILTER (WHERE l.stage = 'Nurture'
    AND (fu.cadence_type IN ('lead_intro','quote_chase','lost_nurture')
         OR (fu.cadence_type IS NULL AND fu.auto_generated = true
             AND fu.note LIKE 'Auto-scheduled:%'))) AS nurture_stale_other_cadence,
  count(*) FILTER (WHERE l.cadence_paused = true
    AND (fu.cadence_type IN ('lead_intro','quote_chase','nurture','lost_nurture')
         OR (fu.cadence_type IS NULL AND fu.auto_generated = true
             AND fu.note LIKE 'Auto-scheduled:%'))) AS paused_open_auto
FROM public.follow_ups fu JOIN public.leads l ON l.id = fu.lead_id
WHERE fu.is_done = false;

UPDATE public.follow_ups fu
   SET is_done = true,
       note = COALESCE(fu.note, '') || ' [healed: nurture/pause cleanup]'
  FROM public.leads l
 WHERE l.id = fu.lead_id
   AND fu.is_done = false
   AND (
     (l.stage = 'Nurture'
       AND (fu.cadence_type IN ('lead_intro','quote_chase','lost_nurture')
            OR (fu.cadence_type IS NULL AND fu.auto_generated = true
                AND fu.note LIKE 'Auto-scheduled:%')))
     OR
     (l.cadence_paused = true
       AND (fu.cadence_type IN ('lead_intro','quote_chase','nurture','lost_nurture')
            OR (fu.cadence_type IS NULL AND fu.auto_generated = true
                AND fu.note LIKE 'Auto-scheduled:%')))
   );

-- self-register
DO $$
BEGIN
  IF to_regclass('public.applied_migrations') IS NOT NULL THEN
    INSERT INTO public.applied_migrations (name, note)
    VALUES ('supabase_phase128_3_nurture_pause_close.sql',
            'Nurture/pause FU leak - unconditional stage-change cleanup + legacy NULL-cadence close + pause-toggle close + heal')
    ON CONFLICT (name) DO NOTHING;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY — expect t / t / 1 / 0 ────────────────────────────────────
SELECT
  (SELECT position('PHASE-128.3' in pg_get_functiondef(oid)) > 0
     FROM pg_proc WHERE proname='lead_stage_change_cadence' LIMIT 1) AS cancels_unconditional,
  (SELECT position('Auto-scheduled:' in pg_get_functiondef(oid)) > 0
     FROM pg_proc WHERE proname='cancel_lead_cadence' LIMIT 1)       AS legacy_close,
  (SELECT count(*) FROM pg_trigger
    WHERE tgname='trg_lead_pause_close_auto_followups')              AS pause_trigger,
  (SELECT count(*) FROM public.follow_ups fu JOIN public.leads l ON l.id=fu.lead_id
    WHERE fu.is_done=false AND (l.cadence_paused=true OR l.stage='Nurture')
      AND (fu.cadence_type IN ('lead_intro','quote_chase')
           OR (fu.cadence_type IS NULL AND fu.auto_generated=true
               AND fu.note LIKE 'Auto-scheduled:%')))                AS zombies_left;

SELECT 'Phase 128.3 nurture/pause follow-up leak fixed' AS status;
