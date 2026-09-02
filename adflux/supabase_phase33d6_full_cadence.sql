-- =====================================================================
-- Phase 33D.6 — full follow-up cadence system
-- 11 May 2026
--
-- Owner-locked rules:
--   • New/Working leads → 9 follow-ups (days 1,3,5,8,12,17,20,25,30) [§278]
--   • QuoteSent → 8 follow-ups (days 2,5,9,12,18,20,25,30) [§278]. After the
--     LAST (seq-8) done → Nurture (30-day repeat until Lost).
--   • Nurture / Lost → +30 day FU, repeating (until rep toggles
--     cadence_paused or moves stage to Won).
--   • Won → cancel everything.
--   • Sundays push to Monday.
--   • When rep completes a FU, earlier overdue FUs in same cadence
--     auto-skip.
-- =====================================================================

-- ─── 1. Schema extensions ───────────────────────────────────────────
ALTER TABLE follow_ups
  ADD COLUMN IF NOT EXISTS sequence     int,
  ADD COLUMN IF NOT EXISTS cadence_type text,
  ADD COLUMN IF NOT EXISTS action_hint  text;

-- cadence_type values: 'lead_intro' | 'quote_chase' | 'nurture' | 'lost_nurture'

CREATE INDEX IF NOT EXISTS idx_follow_ups_lead_cadence_open
  ON follow_ups (lead_id, cadence_type)
  WHERE is_done = false AND lead_id IS NOT NULL;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS cadence_paused boolean DEFAULT false;

-- ─── 2. Helper: push Sunday to Monday ───────────────────────────────
CREATE OR REPLACE FUNCTION public.next_workday(d date)
RETURNS date
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN EXTRACT(DOW FROM d) = 0 THEN d + 1 ELSE d END
$$;

-- ─── 3. Cadence spec table (read-only constants in code) ────────────
-- (We encode cadence days in functions below; no extra table needed.)

-- ─── 4. Spawn cadence helpers ───────────────────────────────────────

-- Pre-quote cadence: 9 follow-ups starting from a base date (owner §278,
-- 2026-09-02: extended from 6 → days 1,3,5,8,12,17,20,25,30).
CREATE OR REPLACE FUNCTION public.spawn_lead_intro_cadence(
  p_lead_id uuid, p_owner uuid, p_base date
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_days int[]  := ARRAY[1, 3, 5, 8, 12, 17, 20, 25, 30];
  v_hints text[] := ARRAY[
    'Call or WhatsApp',
    'Call + send info',
    'Meeting or send quote',
    'Follow-up call',
    'Ask for decision',
    'Follow-up call',
    'Check in again',
    'Re-engage',
    'Final follow-up'
  ];
  i int;
BEGIN
  FOR i IN 1 .. array_length(v_days, 1) LOOP
    INSERT INTO public.follow_ups (
      lead_id, assigned_to, follow_up_date, follow_up_time,
      note, auto_generated, sequence, cadence_type, action_hint
    ) VALUES (
      p_lead_id, p_owner,
      public.next_workday(p_base + (v_days[i] || ' days')::interval),
      '10:00:00',
      'Auto: ' || v_hints[i],
      true, i, 'lead_intro', v_hints[i]
    );
  END LOOP;
END $$;

-- Quote chase: 8 follow-ups (owner §278, 2026-09-02: extended from 3 →
-- days 2,5,9,12,18,20,25,30). After the LAST (seq-8) chase is done+due the
-- lead auto-drops to Nurture (30-day repeat until Lost) — the de-stage gate
-- in followup_after_done was bumped seq 3 → 8 to match this longer sequence.
CREATE OR REPLACE FUNCTION public.spawn_quote_chase_cadence(
  p_lead_id uuid, p_owner uuid, p_base date
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_days int[]  := ARRAY[2, 5, 9, 12, 18, 20, 25, 30];
  v_hints text[] := ARRAY[
    'Ask: got the quote? Any questions?',
    'Follow-up call, ask for decision',
    'Follow-up — any blockers?',
    'Chase the decision',
    'Re-confirm interest + timeline',
    'Nudge for closure',
    'Check budget / offer help',
    'Final push — discount offer or meeting'
  ];
  i int;
BEGIN
  FOR i IN 1 .. array_length(v_days, 1) LOOP
    INSERT INTO public.follow_ups (
      lead_id, assigned_to, follow_up_date, follow_up_time,
      note, auto_generated, sequence, cadence_type, action_hint
    ) VALUES (
      p_lead_id, p_owner,
      public.next_workday(p_base + (v_days[i] || ' days')::interval),
      '10:00:00',
      'Auto: ' || v_hints[i],
      true, i, 'quote_chase', v_hints[i]
    );
  END LOOP;
END $$;

-- Nurture / Lost: single +30 day FU (repeating one at a time).
CREATE OR REPLACE FUNCTION public.spawn_nurture_followup(
  p_lead_id uuid, p_owner uuid, p_base date, p_cadence_type text
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_prev_seq int;
BEGIN
  -- Rotate nurture template variants (1, 2, 3) by counting prior
  -- done FUs of same cadence_type. (sequence % 3) + 1 → 1, 2, 3.
  SELECT COALESCE(MAX(sequence), 0) INTO v_prev_seq
    FROM public.follow_ups
   WHERE lead_id = p_lead_id AND cadence_type = p_cadence_type;

  INSERT INTO public.follow_ups (
    lead_id, assigned_to, follow_up_date, follow_up_time,
    note, auto_generated, sequence, cadence_type, action_hint
  ) VALUES (
    p_lead_id, p_owner,
    public.next_workday(p_base + INTERVAL '30 days'),
    '10:00:00',
    'Auto: 30-day check-in',
    true, v_prev_seq + 1, p_cadence_type, 'General check-in'
  );
END $$;

-- Cancel all OPEN follow-ups for a lead by cadence_type set.
-- -------------------------------------------------------------------------
-- cancel_lead_cadence REMOVED from this file (Phase 178).
-- Canonical: db/functions/cancel_lead_cadence.sql (§128.3 cadence cancel helper).
-- Do NOT re-add it here. Edit the canonical file only (§71).
-- -------------------------------------------------------------------------

-- ─── 5. Lead-creation trigger (replaces Phase 33D.4) ────────────────
-- -------------------------------------------------------------------------
-- lead_auto_create_followup REMOVED from this file (Phase 178).
-- Canonical: db/functions/lead_auto_create_followup.sql.  Do NOT re-add (§71). Trigger wiring stays.
-- -------------------------------------------------------------------------

-- Trigger already exists from Phase 33D.4; just replacing the function is enough.

-- ─── 6. Stage-change trigger ────────────────────────────────────────
-- -------------------------------------------------------------------------
-- lead_stage_change_cadence REMOVED from this file (Phase 178).
-- Canonical: db/functions/lead_stage_change_cadence.sql (§128.3 cadence stage-machine).
-- Do NOT re-add it here. Edit the canonical file only (§71). Trigger wiring stays.
-- -------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_lead_stage_change_cadence ON public.leads;
CREATE TRIGGER trg_lead_stage_change_cadence
  AFTER UPDATE OF stage ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.lead_stage_change_cadence();

-- ─── 7. Done-trigger: auto-skip past + spawn next ───────────────────
-- -------------------------------------------------------------------------
-- followup_after_done REMOVED from this file (Phase 178).
-- Canonical: db/functions/followup_after_done.sql (§174-FROZEN cadence engine).
-- Do NOT re-add it here. Edit the canonical file only (§71). Trigger wiring
-- (trg_followup_after_done) stays in phase33d6.
-- -------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_followup_after_done ON public.follow_ups;
CREATE TRIGGER trg_followup_after_done
  AFTER UPDATE OF is_done ON public.follow_ups
  FOR EACH ROW
  EXECUTE FUNCTION public.followup_after_done();

-- ─── 8. Duplicate phone lookup ──────────────────────────────────────
-- MOVED (Phase 260, §71/§72): find_lead_by_phone is now the single
-- canonical file db/functions/find_lead_by_phone.sql, which ADDS the
-- owner columns (owner_name/owner_id/owner_role/is_open) the dup warning
-- needs. The body was REMOVED here so re-running phase33d6 can no longer
-- revert to the owner-less version. To change it, edit the canonical.

-- ─── 9. Seed 3 nurture template variants (rotation) ────────────────
-- Keep existing 'Nurture' row; add 2 sibling rows so the rotation has
-- something to cycle through. Display order keys the cycle: 1, 2, 3.
INSERT INTO message_templates (name, stage, body, display_order)
VALUES
  ('Nurture · share portfolio', 'Nurture',
'Hello {name},

Quick share — we just installed a new LED display in {city} for a client similar to {company}. Would you like to see the photos?

Best regards,
{rep}
Untitled Adflux', 20),
  ('Nurture · seasonal nudge', 'Nurture',
'Hello {name},

Hope all is well at {company}. With the upcoming season, many businesses in {city} are locking in outdoor placements early. Worth a quick chat?

Best regards,
{rep}
Untitled Adflux', 30)
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ────────────────────────────────────────────────────────
-- NOTE (Phase 260): find_lead_by_phone's body now lives ONLY in
-- db/functions/find_lead_by_phone.sql. This count still includes it, so
-- function_count = 8 requires that canonical file to have been run too
-- (7 if only this file is run standalone). Not a break — expectation note.
SELECT
  (SELECT count(*) FROM pg_proc WHERE proname IN
    ('spawn_lead_intro_cadence','spawn_quote_chase_cadence',
     'spawn_nurture_followup','cancel_lead_cadence',
     'lead_stage_change_cadence','followup_after_done',
     'find_lead_by_phone','next_workday')) AS function_count,
  (SELECT count(*) FROM pg_trigger WHERE tgname IN
    ('trg_lead_stage_change_cadence','trg_followup_after_done','trg_lead_auto_followup')) AS trigger_count,
  (SELECT count(*) FROM message_templates WHERE stage='Nurture' AND is_active) AS nurture_variants;
