-- =====================================================================
-- TRUTH 1 — the two cadence P0s (pipeline self-corruption)
-- 2026-06-10
--
-- Deep-audit findings, both inside followup_after_done() (canonical body =
-- supabase_phase33d6_full_cadence.sql:216, never superseded):
--
-- P0-A · Every outcome save on a QuoteSent lead silently parks it in Nurture.
--   PostCallOutcomeModal's save bulk-closes ALL open follow_ups for the lead
--   (Phase 102.A widened this) — including the FUTURE quote_chase seq-3 row.
--   followup_after_done sees seq-3 flip done + stage QuoteSent → moves the
--   lead to Nurture. The rep saved "Good" and the system cancelled the chase
--   + shrank the pipeline. Live since 29 May.
--   FIX: the FU3→Nurture park now ALSO requires the seq-3 row to be DUE
--   (follow_up_date <= IST today). A bulk close of a future chase step can
--   never park the lead; completing the chase at/after its due date still
--   parks exactly as designed.
--
-- P0-B · Lost/Won leads keep an immortal nurture follow-up.
--   The nurture/lost_nurture respawn branch has NO stage gate. Terminal flip:
--   the stage triggers close the open nurture row → this trigger re-spawns
--   +30d DURING that very UPDATE (invisible to its snapshot) → one open
--   nurture row survives forever on a dead lead. Root of the recurring
--   "lost leads still in follow-ups" (phases 72 → 76.3 → 117 fought symptoms).
--   FIX: respawn only while the lead is STILL in the stage that cadence
--   serves — 'nurture' respawns only when stage='Nurture'; 'lost_nurture'
--   only when stage='Lost' (the designed lost-leads cycle is preserved).
--
-- Everything else in the function is BYTE-IDENTICAL to 33d6: the false→true
-- gate, the auto-skip catch-up, cadence_paused check, owner resolution, and
-- the trigger DDL (untouched — CREATE OR REPLACE swaps the body in place).
--
-- §45: trigger fires only on follow_ups UPDATE OF is_done (not on any rep
-- save hot path beyond what already ran). The two gates each add at most one
-- comparison on data already in scope — zero added queries.
--
-- Includes: (1) the function fix, (2) a one-time heal closing existing zombie
-- rows (safe AFTER the fix — the close can no longer respawn), (3) a READ-ONLY
-- diagnostic listing leads possibly wrongly parked in Nurture since 29 May
-- for the owner to review (stages are NOT auto-reverted — owner's call).
-- =====================================================================

-- ── 1. The fixed function ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.followup_after_done()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead leads%ROWTYPE;
  v_owner uuid;
BEGIN
  -- Only act when is_done flips false → true (rep marks done).
  IF NEW.is_done IS NOT TRUE OR OLD.is_done IS TRUE THEN
    RETURN NEW;
  END IF;
  IF NEW.lead_id IS NULL THEN RETURN NEW; END IF;

  -- Auto-skip earlier OPEN FUs in same cadence_type (catch-up).
  UPDATE public.follow_ups
     SET is_done = true,
         note = COALESCE(note, '') || ' [auto-skipped: later FU done]'
   WHERE lead_id = NEW.lead_id
     AND cadence_type = NEW.cadence_type
     AND is_done = false
     AND sequence < NEW.sequence;

  SELECT * INTO v_lead FROM public.leads WHERE id = NEW.lead_id;
  IF v_lead.cadence_paused THEN RETURN NEW; END IF;
  v_owner := COALESCE(v_lead.assigned_to, v_lead.created_by);
  IF v_owner IS NULL THEN RETURN NEW; END IF;

  -- Quote chase FU3 done → auto-move to Nurture.
  -- TRUTH-1 P0-A gate: only when the seq-3 row was actually DUE. An outcome
  -- save bulk-closes future chase rows; that must never park the lead.
  IF NEW.cadence_type = 'quote_chase' AND NEW.sequence = 3
     AND v_lead.stage = 'QuoteSent'
     AND NEW.follow_up_date <= (now() AT TIME ZONE 'Asia/Kolkata')::date THEN
    UPDATE public.leads SET stage = 'Nurture' WHERE id = NEW.lead_id;
    -- The stage-change trigger will spawn the nurture FU.
  END IF;

  -- Nurture / Lost-nurture done → spawn next +30.
  -- TRUTH-1 P0-B gate: respawn only while the lead is STILL in the stage
  -- that cadence serves. A terminal/stage-change close must not resurrect.
  IF NEW.cadence_type = 'nurture' AND v_lead.stage = 'Nurture' THEN
    PERFORM public.spawn_nurture_followup(NEW.lead_id, v_owner, CURRENT_DATE, NEW.cadence_type);
  ELSIF NEW.cadence_type = 'lost_nurture' AND v_lead.stage = 'Lost' THEN
    PERFORM public.spawn_nurture_followup(NEW.lead_id, v_owner, CURRENT_DATE, NEW.cadence_type);
  END IF;

  RETURN NEW;
END $$;

-- ── 2. One-time heal — close the existing zombies ────────────────────
-- Safe only AFTER the fix above: with the new gates, these closes cannot
-- respawn. Open 'nurture' rows on leads no longer in Nurture + open
-- 'lost_nurture' rows on leads no longer in Lost.
UPDATE public.follow_ups fu
   SET is_done = true,
       note = COALESCE(fu.note, '') || ' [healed: lead left this cadence''s stage]'
  FROM public.leads l
 WHERE l.id = fu.lead_id
   AND fu.is_done = false
   AND (
     (fu.cadence_type = 'nurture'      AND l.stage <> 'Nurture')
     OR
     (fu.cadence_type = 'lost_nurture' AND l.stage <> 'Lost')
   );

-- self-register
DO $$
BEGIN
  IF to_regclass('public.applied_migrations') IS NOT NULL THEN
    INSERT INTO public.applied_migrations (name, note)
    VALUES ('supabase_truth1_cadence_p0_fixes.sql', 'Truth sprint - QuoteSent de-stage gate + zombie nurture gate + heal')
    ON CONFLICT (name) DO NOTHING;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY — all four must be true / zero ───────────────────────────
SELECT
  (SELECT position('follow_up_date <= (now() AT TIME ZONE' in pg_get_functiondef(oid)) > 0
     FROM pg_proc WHERE proname = 'followup_after_done' LIMIT 1)                          AS p0a_due_gate,      -- t
  (SELECT position('v_lead.stage = ''Nurture''' in pg_get_functiondef(oid)) > 0
     FROM pg_proc WHERE proname = 'followup_after_done' LIMIT 1)                          AS p0b_nurture_gate,  -- t
  (SELECT position('v_lead.stage = ''Lost''' in pg_get_functiondef(oid)) > 0
     FROM pg_proc WHERE proname = 'followup_after_done' LIMIT 1)                          AS p0b_lost_gate,     -- t
  (SELECT count(*) FROM public.follow_ups fu JOIN public.leads l ON l.id = fu.lead_id
    WHERE fu.is_done = false
      AND ((fu.cadence_type = 'nurture' AND l.stage <> 'Nurture')
        OR (fu.cadence_type = 'lost_nurture' AND l.stage <> 'Lost')))                     AS zombies_left;      -- 0

-- ─── DIAGNOSTIC (read-only) — leads possibly WRONGLY parked in Nurture ─
-- Since 29 May an outcome save could de-stage QuoteSent → Nurture. These are
-- Nurture leads whose quote_chase seq-3 carries the bulk-close auto-skip
-- marker — review and move genuine pipeline back to QuoteSent by hand (the
-- lead page → stage chip). Stages are NOT auto-changed here.
SELECT l.name, l.company, u.name AS rep, l.updated_at::date AS parked_on
  FROM public.leads l
  LEFT JOIN public.users u ON u.id = COALESCE(l.telecaller_id, l.assigned_to)
 WHERE l.stage = 'Nurture'
   AND EXISTS (
     SELECT 1 FROM public.follow_ups fu
      WHERE fu.lead_id = l.id
        AND fu.cadence_type = 'quote_chase'
        AND fu.sequence < 3
        AND fu.note LIKE '%[auto-skipped: later FU done]%'
   )
   AND l.updated_at >= '2026-05-29'
 ORDER BY l.updated_at DESC;

SELECT 'Truth 1 cadence P0 fixes applied' AS status;
