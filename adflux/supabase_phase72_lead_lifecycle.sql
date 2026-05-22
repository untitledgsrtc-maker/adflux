-- supabase_phase72_lead_lifecycle.sql
-- Phase 72 (21 May 2026) — lead lifecycle automation
--
-- Owner findings (21 May 2026):
--   2) "Lost leads still appearing in tomorrow's follow-up schedule."
--      Cause: stage flip to Lost did NOT close open follow_ups.
--      Cadence triggers kept spawning quote_chase / lead_intro rows.
--   3) "Nurture lead should auto-revisit after 30 days from last update."
--      Cause: no cron / trigger to refresh Nurture leads. Reps had
--      to manually find them after 30 days.
--
-- Two changes here:
--
-- A. CLOSE-ON-LOST trigger.
--    When leads.stage flips to 'Lost' OR 'Won', mark all open
--    follow_ups for that lead as is_done=true. Also close any
--    open smart_tasks for the same (lead, rep). Idempotent.
--    Doesn't touch follow_ups already done.
--
-- B. NURTURE 30-DAY AUTO-REVISIT cron.
--    Daily 09:00 IST cron scans leads where:
--      - stage = 'Nurture'
--      - revisit_date <= today
--      - assigned_to / telecaller_id IS NOT NULL
--    For each match, upsert an open follow_up row for the rep due
--    today. Push trigger Phase 34Z.55 will then notify the rep at
--    9:30 IST morning push.
--    After spawning the follow_up, bump revisit_date forward 30 days
--    so it doesn't fire again tomorrow.
--
-- Idempotent. Triggers use CREATE OR REPLACE FUNCTION + DROP TRIGGER
-- IF EXISTS pattern.

-- ─── A. close-on-lost trigger ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_lead_close_followups_on_terminal()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Only act on stage transitions INTO Lost or Won.
  IF (TG_OP = 'UPDATE')
     AND (NEW.stage IN ('Lost', 'Won'))
     AND (OLD.stage IS DISTINCT FROM NEW.stage) THEN

    -- Close every open follow_up for this lead.
    UPDATE public.follow_ups
       SET is_done    = true,
           done_at    = now(),
           done_note  = COALESCE(done_note, '')
                      || CASE WHEN NEW.stage = 'Lost'
                              THEN ' [auto-closed: lead marked Lost]'
                              ELSE ' [auto-closed: lead marked Won]'
                         END
     WHERE lead_id = NEW.id
       AND is_done = false;

    -- Close every open smart_task / lead_task row.
    UPDATE public.lead_tasks
       SET status      = 'done',
           completed_at = now()
     WHERE lead_id = NEW.id
       AND status IN ('open', 'pending');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_lead_close_followups_on_terminal ON public.leads;
CREATE TRIGGER trg_lead_close_followups_on_terminal
  AFTER UPDATE OF stage ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.trg_lead_close_followups_on_terminal();


-- ─── B. Nurture 30-day auto-revisit RPC + cron ───────────────────
CREATE OR REPLACE FUNCTION public.run_nurture_revisit()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  r record;
  v_owner uuid;
  v_inserted int := 0;
  v_bumped   int := 0;
BEGIN
  FOR r IN
    SELECT id, assigned_to, telecaller_id, name, revisit_date
      FROM public.leads
     WHERE stage = 'Nurture'
       AND revisit_date IS NOT NULL
       AND revisit_date <= v_today
  LOOP
    -- Prefer telecaller, fall back to assigned sales rep.
    v_owner := COALESCE(r.telecaller_id, r.assigned_to);
    IF v_owner IS NULL THEN CONTINUE; END IF;

    -- Skip if rep already has an open follow_up due today/earlier
    -- for this lead (don't double-stack).
    IF EXISTS (
      SELECT 1 FROM public.follow_ups
       WHERE lead_id    = r.id
         AND assigned_to = v_owner
         AND is_done     = false
         AND follow_up_date <= v_today
    ) THEN
      -- Just bump revisit_date so it doesn't trigger again tomorrow.
      UPDATE public.leads
         SET revisit_date = v_today + INTERVAL '30 days'
       WHERE id = r.id;
      v_bumped := v_bumped + 1;
      CONTINUE;
    END IF;

    -- Spawn fresh follow_up due today.
    INSERT INTO public.follow_ups (
      lead_id, assigned_to,
      follow_up_date, follow_up_time,
      note, cadence_type,
      is_done, created_at
    ) VALUES (
      r.id, v_owner,
      v_today, '10:00',
      'Nurture revisit — last quote 30+ days ago. Re-pitch.',
      'nurture',
      false, now()
    );

    -- Bump revisit_date forward 30 days.
    UPDATE public.leads
       SET revisit_date = v_today + INTERVAL '30 days'
     WHERE id = r.id;

    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'inserted', v_inserted,
    'bumped',   v_bumped,
    'run_at',   now()
  );
END $$;

GRANT EXECUTE ON FUNCTION public.run_nurture_revisit() TO authenticated;

-- pg_cron schedule: daily 09:00 IST = 03:30 UTC.
-- pg_cron uses UTC. 09:00 IST is 03:30 UTC.
SELECT cron.unschedule('nurture-revisit-daily')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'nurture-revisit-daily');

SELECT cron.schedule(
  'nurture-revisit-daily',
  '30 3 * * *',
  $$ SELECT public.run_nurture_revisit(); $$
);

NOTIFY pgrst, 'reload schema';


-- ─── VERIFY ──────────────────────────────────────────────────────
-- Check trigger exists + cron registered.
SELECT
  (SELECT COUNT(*) FROM pg_trigger
    WHERE tgname = 'trg_lead_close_followups_on_terminal') AS lifecycle_trigger,
  (SELECT COUNT(*) FROM cron.job
    WHERE jobname = 'nurture-revisit-daily') AS nurture_cron;

SELECT 'Phase 72 lifecycle ready' AS status;
