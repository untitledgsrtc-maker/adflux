-- ============================================================================
-- db/functions/lead_intro_repeat_dispatch.sql - CANONICAL HOME (section 71)
-- ============================================================================
-- Phase 625 (19-11-2026, owner): a New/Working lead must never sit with nothing
-- scheduled. Runs nightly (cron 'lead-intro-repeat', 20:45 IST Mon-Sat):
--   for every New/Working lead, auto follow-ups not paused, whose owner is active
--   and that has NO open follow-up:
--     * fewer than 5 repeats so far -> add one follow-up 2 working days out, 10:00
--       (cadence_type 'lead_intro', note 'Auto: no reply yet ...', sequence 101..105);
--     * 5 repeats done -> move the lead to Nurture (lead_stage_change_cadence then
--       closes lead_intro rows and spawns the 30-day nurture check-in).
--   At most 15 leads per owner per night (oldest contact first) so the backlog spreads.
-- Uses ONLY the frozen cadence type 'lead_intro' (CLAUDE.md section 28).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.lead_intro_repeat_dispatch()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_n int := 0;
  r record;
BEGIN
  FOR r IN
    WITH c AS (
      SELECT l.id, COALESCE(l.assigned_to, l.telecaller_id, l.created_by) AS owner,
             COALESCE(l.last_contact_at, l.created_at) AS seen_at,
             (SELECT count(*) FROM public.follow_ups f
               WHERE f.lead_id = l.id AND f.cadence_type = 'lead_intro'
                 AND f.note LIKE 'Auto: no reply yet%') AS repeats
        FROM public.leads l
       WHERE l.stage IN ('New', 'Working')
         AND l.cadence_paused IS NOT TRUE
         AND l.created_at < now() - interval '1 hour'
         AND NOT EXISTS (SELECT 1 FROM public.follow_ups f WHERE f.lead_id = l.id AND f.is_done = false)
    ), o AS (
      SELECT c.*, row_number() OVER (PARTITION BY c.owner ORDER BY c.seen_at) AS rn
        FROM c JOIN public.users u ON u.id = c.owner AND u.is_active
    )
    SELECT * FROM o WHERE rn <= 15
  LOOP
    IF r.repeats >= 5 THEN
      UPDATE public.leads SET stage = 'Nurture', updated_at = now() WHERE id = r.id AND stage IN ('New', 'Working');
    ELSE
      INSERT INTO public.follow_ups (
        lead_id, assigned_to, follow_up_date, follow_up_time,
        note, auto_generated, sequence, cadence_type, action_hint
      ) VALUES (
        r.id, r.owner, public.next_workday(v_today + 2), '10:00:00',
        'Auto: no reply yet - try ' || (r.repeats + 1) || ' of 5', true, 101 + r.repeats, 'lead_intro', 'Call or WhatsApp'
      );
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $function$;

REVOKE ALL ON FUNCTION public.lead_intro_repeat_dispatch() FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';

-- VERIFY: SELECT to_regprocedure('public.lead_intro_repeat_dispatch()') IS NOT NULL;  -- t
