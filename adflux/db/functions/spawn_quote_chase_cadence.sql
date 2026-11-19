-- ============================================================================
-- db/functions/spawn_quote_chase_cadence.sql - CANONICAL HOME (section 71: one definition)
-- ============================================================================
-- WHAT IT DOES: called by lead_stage_change_cadence when a lead moves New/Working ->
--   QuoteSent. Spawns the quote_chase follow-ups.
-- 8 chases (UNCHANGED, section 278): day 2, 5, 9, 12, 18, 20, 25, 30 at 10:00, sequence 1..8.
--   followup_after_done moves the lead to Nurture when sequence 8 is done.
-- Phase 625 (19-11-2026, owner): two extra rows, sequence 0 (never the Nurture trigger):
--   * 5 minutes after the quote ("Got the quote?") - push hours only, not Sunday;
--   * next working day 10:00 - skipped when it lands on the same day as chase 1.
-- History: phase33d6 (created), section 278 (8 chases). Edit THIS file.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.spawn_quote_chase_cadence(p_lead_id uuid, p_owner uuid, p_base date)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_days int[] := ARRAY[2, 5, 9, 12, 18, 20, 25, 30];
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
  v_soon    timestamp := (now() + interval '5 minutes') AT TIME ZONE 'Asia/Kolkata';
  v_next    date      := public.next_workday(p_base + 1);
BEGIN
  -- Phase 625: 5-minute "got the quote?" check + next-day check. Skipped when the quote's
  -- own trigger (auto_create_followup) already added them for this lead (no double rows).
  IF EXISTS (SELECT 1 FROM public.follow_ups f WHERE f.lead_id = p_lead_id AND f.cadence_type = 'quote_chase'
              AND f.sequence = 0 AND f.is_done = false) THEN
    v_next := NULL;
  ELSIF EXTRACT(HOUR FROM v_soon) BETWEEN 9 AND 20 AND EXTRACT(DOW FROM v_soon) <> 0 THEN   -- push hours on the DUE time
    INSERT INTO public.follow_ups (
      lead_id, assigned_to, follow_up_date, follow_up_time,
      note, auto_generated, sequence, cadence_type, action_hint
    ) VALUES (
      p_lead_id, p_owner, v_soon::date, date_trunc('minute', v_soon)::time,
      'Auto: Quote sent - check they got it', true, 0, 'quote_chase', 'Confirm the quote reached them'
    );
  END IF;

  -- Phase 625: next working day 10:00, unless chase 1 already falls on that day.
  IF v_next IS NOT NULL AND v_next <> public.next_workday(p_base + 2) THEN
    INSERT INTO public.follow_ups (
      lead_id, assigned_to, follow_up_date, follow_up_time,
      note, auto_generated, sequence, cadence_type, action_hint
    ) VALUES (
      p_lead_id, p_owner, v_next, '10:00:00',
      'Auto: Next-day check on the quote', true, 0, 'quote_chase', 'Any questions on the quote?'
    );
  END IF;

  FOR i IN 1 .. array_length(v_days, 1) LOOP
    INSERT INTO public.follow_ups (
      lead_id, assigned_to, follow_up_date, follow_up_time,
      note, auto_generated, sequence, cadence_type, action_hint
    ) VALUES (
      p_lead_id, p_owner,
      public.next_workday(p_base + (v_days[i] || ' days')::interval),
      '10:00:00',
      'Auto: ' || v_hints[i], true, i, 'quote_chase', v_hints[i]
    );
  END LOOP;
END $function$;

NOTIFY pgrst, 'reload schema';

-- VERIFY: SELECT pg_get_functiondef('public.spawn_quote_chase_cadence(uuid,uuid,date)'::regprocedure) LIKE '%check they got it%';  -- t
