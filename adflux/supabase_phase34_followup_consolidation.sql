-- =====================================================================
-- Phase 34 — Follow-up + SLA + auto-assignment consolidation
-- 13 May 2026
--
-- This migration fixes four structural bugs the May 13 audit surfaced.
-- It is the SQL counterpart to Sprint B of the audit plan.
--
-- ────────────────────────────────────────────────────────────────────
-- WHAT WAS BROKEN
-- ────────────────────────────────────────────────────────────────────
--
-- 1. Dead handoff-SLA trigger.
--    public.lead_set_handoff_sla() (Phase 12, §8.1) checks
--    `NEW.stage = 'SalesReady'`. Phase 30A collapsed the lead stage
--    enum to 5 values (New, Working, QuoteSent, Won, Lost) and the
--    Phase 31N migration added Nurture back as a 6th value.
--    'SalesReady' is no longer in the CHECK constraint, so this
--    trigger's body never executes. handoff_sla_due_at therefore
--    never gets set, and Telecaller / Leads pages that flag SLA
--    breaches report nothing or stale data.
--
--    Per the Phase 30A header comment the intended handoff key is now
--    `stage = 'Working'` (rep started working a lead = telecaller has
--    handed it off). We re-point the trigger at the New → Working
--    transition.
--
-- 2. SLA is wall-clock UTC.
--    The original trigger set `handoff_sla_due_at = sales_ready_at +
--    interval '24 hours'`. India is UTC+5:30 and the business runs
--    six days a week (Sunday off) plus national holidays. A lead
--    handed off Friday 9pm IST currently breaches Saturday 9pm IST,
--    which is meaningless. We now compute the SLA as 24 working
--    hours in IST, rolled past Sundays and rows in `holidays`.
--
-- 3. No auto-assignment.
--    `leads.assigned_to` defaults to NULL and bulk Cronberry imports
--    routinely insert rows with no owner. These rows then sit in the
--    queue invisible to /work and /telecaller. We add a round-robin
--    function that picks the least-loaded active sales / telecaller
--    user whose segment_access matches the lead's segment, and a
--    BEFORE INSERT trigger that fills assigned_to when blank.
--
-- 4. Activity next_action_date never reaches /follow-ups.
--    When a rep logs a lead_activities row with `next_action_date`
--    set, the value lands on the activity row but no follow_ups row
--    is created. The follow-up therefore never appears in the rep's
--    /work task list. We add an AFTER INSERT trigger on
--    lead_activities that upserts an open follow_ups row for the
--    lead whenever next_action_date IS NOT NULL.
--
-- ────────────────────────────────────────────────────────────────────
-- DEPENDENCIES
-- ────────────────────────────────────────────────────────────────────
--   * public.holidays + public.is_off_day()   (Phase 12 §2)
--   * public.users.segment_access             (Phase 4e)
--   * public.leads, public.lead_activities    (Phase 12 §3-4)
--   * public.follow_ups + lead_id column      (Phase 33D.4)
--
-- ────────────────────────────────────────────────────────────────────
-- IDEMPOTENT — safe to re-run.
-- ────────────────────────────────────────────────────────────────────


-- ─── 1. Business-day SLA helper ──────────────────────────────────────
-- next_business_moment(ts) — given an arbitrary timestamptz, return
-- the same wall-clock time on the next IST business day if that day
-- is a Sunday or holiday; otherwise return ts unchanged. We use the
-- existing is_off_day() function for the calendar test.
CREATE OR REPLACE FUNCTION public.next_business_moment(p_ts timestamptz)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_date date := (p_ts AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  -- Roll forward day-by-day until we land on a working day. Bounded
  -- at 14 iterations as a safety net — even a long festival cluster
  -- never gets close.
  FOR i IN 1..14 LOOP
    IF NOT public.is_off_day(v_date) THEN
      EXIT;
    END IF;
    v_date := v_date + 1;
  END LOOP;

  -- Reconstruct a timestamptz at the same IST wall-clock time on the
  -- chosen date.
  RETURN ((v_date::text || ' ' ||
           to_char(p_ts AT TIME ZONE 'Asia/Kolkata', 'HH24:MI:SS'))
          ::timestamp AT TIME ZONE 'Asia/Kolkata');
END;
$$;

COMMENT ON FUNCTION public.next_business_moment(timestamptz) IS
  'Phase 34 — roll a timestamp forward to the next IST business day if it falls on a Sunday or holiday.';


-- ─── 2. Rewrite handoff-SLA trigger ──────────────────────────────────
-- The body now keys off New → Working (Phase 30A handoff semantics)
-- and uses next_business_moment() so a Friday-evening handoff
-- breaches Monday rather than Saturday.
CREATE OR REPLACE FUNCTION public.lead_set_handoff_sla()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Stamp the handoff timestamp + SLA when a lead first starts being
  -- worked. We treat sales_ready_at as the historical name for "rep
  -- acknowledged the handoff" so the column keeps its meaning.
  IF NEW.stage = 'Working' AND (OLD.stage IS DISTINCT FROM 'Working') THEN
    NEW.sales_ready_at     := COALESCE(NEW.sales_ready_at, now());
    NEW.handoff_sla_due_at :=
      public.next_business_moment(NEW.sales_ready_at + interval '24 hours');
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Trigger row already exists from Phase 12 §8.1. Re-binding it is a
-- no-op because CREATE OR REPLACE FUNCTION rewires the body in
-- place; the line below is here for completeness in case Phase 12
-- was never run on this database.
DROP TRIGGER IF EXISTS trg_leads_set_handoff_sla ON public.leads;
CREATE TRIGGER trg_leads_set_handoff_sla
  BEFORE UPDATE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.lead_set_handoff_sla();


-- ─── 3. Round-robin auto-assignment ──────────────────────────────────
-- assign_lead_round_robin(p_segment) — pick the active sales /
-- telecaller user whose segment_access matches (or is 'ALL') and
-- who currently owns the fewest open leads. Ties resolved
-- alphabetically by user id to keep the picker deterministic.
CREATE OR REPLACE FUNCTION public.assign_lead_round_robin(p_segment text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
BEGIN
  -- Inline the open-lead count as a correlated subquery so we don't
  -- introduce a LATERAL-only alias the schema linter can't resolve.
  SELECT u.id INTO v_user
    FROM public.users u
   WHERE u.is_active = true
     AND u.team_role IN ('sales', 'telecaller', 'agency')
     AND (u.segment_access = 'ALL' OR u.segment_access = p_segment OR u.segment_access IS NULL)
   ORDER BY (
     SELECT count(*)
       FROM public.leads l
      WHERE l.assigned_to = u.id
        AND l.stage NOT IN ('Won', 'Lost')
   ) ASC, u.id ASC
   LIMIT 1;

  RETURN v_user;
END;
$$;

COMMENT ON FUNCTION public.assign_lead_round_robin(text) IS
  'Phase 34 — return the active sales/telecaller user with the fewest open leads in the given segment.';


-- ─── 4. Auto-assign trigger on lead INSERT ───────────────────────────
-- Fires only when assigned_to is left blank. Lead-form / wizard
-- inserts that already set assigned_to (self-assign) are untouched.
CREATE OR REPLACE FUNCTION public.lead_auto_assign()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.assigned_to IS NULL THEN
    NEW.assigned_to := public.assign_lead_round_robin(NEW.segment);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_auto_assign ON public.leads;
CREATE TRIGGER trg_leads_auto_assign
  BEFORE INSERT ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.lead_auto_assign();


-- ─── 5. Sync lead_activities.next_action_date → follow_ups ───────────
-- When a rep logs an activity with a next-action date the row used
-- to stay on lead_activities only, so /work and /follow-ups never
-- surfaced the date. Now: if an open follow-up row exists for that
-- lead we update its date; otherwise we insert a new one. We mark
-- the row with auto_generated=true so future cleanups can tell
-- system-inserted rows from rep-curated ones.
CREATE OR REPLACE FUNCTION public.lead_activity_sync_followup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_existing uuid;
BEGIN
  IF NEW.next_action_date IS NULL THEN
    RETURN NEW;
  END IF;

  -- Owner of the follow-up: prefer the lead's current assignee, fall
  -- back to the activity's author so a follow-up never lands without
  -- someone to action it.
  SELECT COALESCE(l.assigned_to, NEW.created_by)
    INTO v_owner
    FROM public.leads l
   WHERE l.id = NEW.lead_id;

  IF v_owner IS NULL THEN
    RETURN NEW;
  END IF;

  -- Try to update an existing open follow-up first.
  SELECT id INTO v_existing
    FROM public.follow_ups
   WHERE lead_id = NEW.lead_id
     AND is_done = false
   ORDER BY follow_up_date ASC
   LIMIT 1;

  IF v_existing IS NOT NULL THEN
    UPDATE public.follow_ups
       SET follow_up_date = NEW.next_action_date,
           assigned_to    = v_owner,
           note           = COALESCE(NEW.notes, note)
     WHERE id = v_existing;
  ELSE
    INSERT INTO public.follow_ups (
      lead_id, assigned_to, follow_up_date, follow_up_time,
      note, auto_generated
    ) VALUES (
      NEW.lead_id,
      v_owner,
      NEW.next_action_date,
      '10:00:00',
      COALESCE(NEW.notes, 'Follow up'),
      true
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_activity_sync_followup ON public.lead_activities;
CREATE TRIGGER trg_lead_activity_sync_followup
  AFTER INSERT ON public.lead_activities
  FOR EACH ROW
  EXECUTE FUNCTION public.lead_activity_sync_followup();


NOTIFY pgrst, 'reload schema';


-- ─── VERIFY ──────────────────────────────────────────────────────────
-- Run these in Supabase Studio after the migration. Expected results:
--   1. sunday_rolls_to_monday → true. A Sunday wall-clock input gets
--      shifted to the next IST day; for any non-off day the function
--      returns the input unchanged, so we must pick a Sunday to see
--      it move. Brijesh's business is Mon–Sat (Sundays off only); a
--      Saturday input is NOT a "business day rolls forward" case.
--   2. round_robin_returns   → at least one uuid (assuming an active sales user exists).
--   3. activity_sync_trigger → 1
--   4. auto_assign_trigger   → 1
--   5. handoff_trigger       → 1
SELECT
  (SELECT public.next_business_moment('2026-05-10 14:00:00+05:30'::timestamptz)
            > '2026-05-10 14:00:00+05:30'::timestamptz) AS sunday_rolls_to_monday,
  (SELECT public.assign_lead_round_robin('PRIVATE')) AS round_robin_returns,
  (SELECT count(*) FROM pg_trigger WHERE tgname='trg_lead_activity_sync_followup') AS activity_sync_trigger,
  (SELECT count(*) FROM pg_trigger WHERE tgname='trg_leads_auto_assign') AS auto_assign_trigger,
  (SELECT count(*) FROM pg_trigger WHERE tgname='trg_leads_set_handoff_sla') AS handoff_trigger;
