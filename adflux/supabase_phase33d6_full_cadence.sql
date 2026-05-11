-- =====================================================================
-- Phase 33D.6 — full follow-up cadence system
-- 11 May 2026
--
-- Owner-locked rules:
--   • New/Working leads → 6 follow-ups (days 1, 3, 5, 8, 12, 17)
--   • QuoteSent → 3 follow-ups (days 2, 5, 9). After FU3 done → Nurture.
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

-- Pre-quote cadence: 6 follow-ups starting from a base date.
CREATE OR REPLACE FUNCTION public.spawn_lead_intro_cadence(
  p_lead_id uuid, p_owner uuid, p_base date
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_days int[]  := ARRAY[1, 3, 5, 8, 12, 17];
  v_hints text[] := ARRAY[
    'Call or WhatsApp',
    'Call + send info',
    'Meeting or send quote',
    'Follow-up call',
    'Ask for decision',
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

-- Quote chase: 3 follow-ups.
CREATE OR REPLACE FUNCTION public.spawn_quote_chase_cadence(
  p_lead_id uuid, p_owner uuid, p_base date
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_days int[]  := ARRAY[2, 5, 9];
  v_hints text[] := ARRAY[
    'Ask: got the quote? Any questions?',
    'Follow-up call, ask for decision',
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
CREATE OR REPLACE FUNCTION public.cancel_lead_cadence(
  p_lead_id uuid, p_types text[]
) RETURNS void LANGUAGE sql AS $$
  UPDATE public.follow_ups
     SET is_done = true,
         note = COALESCE(note, '') || ' [cancelled by stage change]'
   WHERE lead_id = p_lead_id
     AND is_done = false
     AND cadence_type = ANY(p_types);
$$;

-- ─── 5. Lead-creation trigger (replaces Phase 33D.4) ────────────────
CREATE OR REPLACE FUNCTION public.lead_auto_create_followup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid := COALESCE(NEW.assigned_to, NEW.created_by);
BEGIN
  IF v_owner IS NULL THEN RETURN NEW; END IF;
  IF NEW.cadence_paused THEN RETURN NEW; END IF;

  IF NEW.stage IN ('New', 'Working') THEN
    PERFORM public.spawn_lead_intro_cadence(NEW.id, v_owner, CURRENT_DATE);
  ELSIF NEW.stage = 'QuoteSent' THEN
    PERFORM public.spawn_quote_chase_cadence(NEW.id, v_owner, CURRENT_DATE);
  ELSIF NEW.stage = 'Nurture' THEN
    PERFORM public.spawn_nurture_followup(NEW.id, v_owner, CURRENT_DATE, 'nurture');
  ELSIF NEW.stage = 'Lost' THEN
    PERFORM public.spawn_nurture_followup(NEW.id, v_owner, CURRENT_DATE, 'lost_nurture');
  END IF;
  RETURN NEW;
END $$;

-- Trigger already exists from Phase 33D.4; just replacing the function is enough.

-- ─── 6. Stage-change trigger ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lead_stage_change_cadence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid := COALESCE(NEW.assigned_to, NEW.created_by);
BEGIN
  IF NEW.stage = OLD.stage THEN RETURN NEW; END IF;
  IF v_owner IS NULL THEN RETURN NEW; END IF;

  -- Won closes everything.
  IF NEW.stage = 'Won' THEN
    PERFORM public.cancel_lead_cadence(NEW.id,
      ARRAY['lead_intro','quote_chase','nurture','lost_nurture']);
    RETURN NEW;
  END IF;

  IF NEW.cadence_paused THEN RETURN NEW; END IF;

  -- QuoteSent → cancel pre-quote, start quote chase.
  IF NEW.stage = 'QuoteSent' AND OLD.stage IN ('New','Working') THEN
    PERFORM public.cancel_lead_cadence(NEW.id, ARRAY['lead_intro']);
    PERFORM public.spawn_quote_chase_cadence(NEW.id, v_owner, CURRENT_DATE);
  -- Nurture (manual move) → cancel quote_chase + lead_intro, start nurture.
  ELSIF NEW.stage = 'Nurture' AND OLD.stage <> 'Nurture' THEN
    PERFORM public.cancel_lead_cadence(NEW.id,
      ARRAY['lead_intro','quote_chase','lost_nurture']);
    PERFORM public.spawn_nurture_followup(NEW.id, v_owner, CURRENT_DATE, 'nurture');
  -- Lost → cancel everything, start lost_nurture.
  ELSIF NEW.stage = 'Lost' AND OLD.stage <> 'Lost' THEN
    PERFORM public.cancel_lead_cadence(NEW.id,
      ARRAY['lead_intro','quote_chase','nurture']);
    PERFORM public.spawn_nurture_followup(NEW.id, v_owner, CURRENT_DATE, 'lost_nurture');
  -- Re-activated from Nurture → fresh lead_intro cadence.
  ELSIF NEW.stage IN ('New','Working') AND OLD.stage IN ('Nurture','Lost') THEN
    PERFORM public.cancel_lead_cadence(NEW.id, ARRAY['nurture','lost_nurture']);
    PERFORM public.spawn_lead_intro_cadence(NEW.id, v_owner, CURRENT_DATE);
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_lead_stage_change_cadence ON public.leads;
CREATE TRIGGER trg_lead_stage_change_cadence
  AFTER UPDATE OF stage ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.lead_stage_change_cadence();

-- ─── 7. Done-trigger: auto-skip past + spawn next ───────────────────
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
  IF NEW.cadence_type = 'quote_chase' AND NEW.sequence = 3
     AND v_lead.stage = 'QuoteSent' THEN
    UPDATE public.leads SET stage = 'Nurture' WHERE id = NEW.lead_id;
    -- The stage-change trigger will spawn the nurture FU.
  END IF;

  -- Nurture / Lost-nurture done → spawn next +30.
  IF NEW.cadence_type IN ('nurture', 'lost_nurture') THEN
    PERFORM public.spawn_nurture_followup(NEW.lead_id, v_owner, CURRENT_DATE, NEW.cadence_type);
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_followup_after_done ON public.follow_ups;
CREATE TRIGGER trg_followup_after_done
  AFTER UPDATE OF is_done ON public.follow_ups
  FOR EACH ROW
  EXECUTE FUNCTION public.followup_after_done();

-- ─── 8. Duplicate phone lookup ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.find_lead_by_phone(p_phone text)
RETURNS TABLE (id uuid, name text, company text, stage text, assigned_to uuid)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_digits text := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
  v_norm text;
BEGIN
  IF length(v_digits) < 10 THEN RETURN; END IF;
  v_norm := CASE WHEN length(v_digits) = 10 THEN '91' || v_digits ELSE v_digits END;
  RETURN QUERY
  SELECT l.id, l.name, l.company, l.stage, l.assigned_to
    FROM public.leads l
   WHERE regexp_replace(COALESCE(l.phone, ''), '\D', '', 'g') = v_digits
      OR regexp_replace(COALESCE(l.phone, ''), '\D', '', 'g') = v_norm
   LIMIT 1;
END $$;

GRANT EXECUTE ON FUNCTION public.find_lead_by_phone(text) TO authenticated;

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
SELECT
  (SELECT count(*) FROM pg_proc WHERE proname IN
    ('spawn_lead_intro_cadence','spawn_quote_chase_cadence',
     'spawn_nurture_followup','cancel_lead_cadence',
     'lead_stage_change_cadence','followup_after_done',
     'find_lead_by_phone','next_workday')) AS function_count,
  (SELECT count(*) FROM pg_trigger WHERE tgname IN
    ('trg_lead_stage_change_cadence','trg_followup_after_done','trg_lead_auto_followup')) AS trigger_count,
  (SELECT count(*) FROM message_templates WHERE stage='Nurture' AND is_active) AS nurture_variants;
