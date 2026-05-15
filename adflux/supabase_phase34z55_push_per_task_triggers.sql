-- supabase_phase34z55_push_per_task_triggers.sql
--
-- Phase 34Z.55 — per-task push triggers.
-- 15 May 2026
--
-- Phase 33W shipped triggers for new-lead / payment / quote-won and a
-- 9 AM cron that rolls up "N follow-ups due today" once per morning.
-- Owner reported (15 May 2026): "whenever the task or call, whatever
-- the notification or upcoming notification are there, but in the
-- notification tab, post notification not coming in the application."
--
-- Two gaps closed here:
--
-- 1. lead_tasks INSERT — when generate_lead_tasks creates a row for a
--    rep (sla_breach / follow_up_due / hot_idle / etc.), push the rep
--    immediately so the smart task lands on their phone the same
--    moment it lands on /work.
--
-- 2. follow_ups INSERT — when a follow-up is scheduled for TODAY,
--    push the assignee right away. Future-dated follow-ups still hit
--    the 9 AM cron rollup the morning they're due.
--
-- Both call public.enqueue_push() (shipped in Phase 33W). Tag is
-- deduped per task / per follow-up row so re-firing doesn't spam.
-- Errors swallowed silently inside enqueue_push (it uses pg_net which
-- already isolates failures from the writing transaction).
--
-- Prerequisites:
--   • Phase 33R: push_subscriptions table
--   • Phase 33S: notify-rep Edge Function
--   • Phase 33W: enqueue_push() helper + app.settings.anon_key set
--
-- Idempotent: CREATE OR REPLACE everywhere, DROP TRIGGER IF EXISTS
-- before CREATE TRIGGER.

-- ─── 1. lead_tasks → push the rep on insert ──────────────────────
CREATE OR REPLACE FUNCTION public.tg_push_on_lead_task_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_lead        record;
  v_title       text;
  v_body        text;
  v_kind_label  text;
BEGIN
  IF NEW.assigned_to IS NULL THEN RETURN NEW; END IF;
  IF NEW.status      IS DISTINCT FROM 'open' THEN RETURN NEW; END IF;

  -- Human label per kind (matches TASK_KIND_LABEL in the React hook).
  v_kind_label := CASE NEW.kind
    WHEN 'sla_breach'         THEN 'SLA breach'
    WHEN 'follow_up_due'      THEN 'Follow-up due'
    WHEN 'hot_idle'           THEN 'Hot lead going cold'
    WHEN 'qualified_no_quote' THEN 'Qualified — no quote yet'
    WHEN 'nurture_revisit'    THEN 'Nurture revisit'
    WHEN 'new_untouched'      THEN 'New lead waiting'
    ELSE 'Smart task'
  END;

  -- Pull the lead's name / company for the body.
  SELECT id, name, company, phone INTO v_lead
    FROM public.leads WHERE id = NEW.lead_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  v_title := v_kind_label || ' · ' || COALESCE(v_lead.name, v_lead.company, 'lead');
  v_body  := COALESCE(NEW.reason,
                      COALESCE(v_lead.company, '') ||
                      CASE WHEN v_lead.phone IS NOT NULL THEN ' · ' || v_lead.phone ELSE '' END);

  PERFORM public.enqueue_push(
    NEW.assigned_to,
    v_title,
    v_body,
    '/leads/' || v_lead.id::text,
    'task-' || NEW.id::text
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_push_lead_task_insert ON public.lead_tasks;
CREATE TRIGGER tg_push_lead_task_insert
  AFTER INSERT ON public.lead_tasks
  FOR EACH ROW EXECUTE FUNCTION public.tg_push_on_lead_task_insert();


-- ─── 2. follow_ups → push the assignee when due today ────────────
-- INSERT OR UPDATE-to-today both fire. The 9 AM rollup still picks
-- up the "you have N due today" digest separately; this per-row push
-- gives the rep an immediate ping when a follow-up is added during
-- the day (e.g. straight after a call outcome modal).
CREATE OR REPLACE FUNCTION public.tg_push_on_followup_due()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_lead   record;
  v_title  text;
  v_body   text;
BEGIN
  IF NEW.assigned_to IS NULL OR NEW.is_done IS TRUE THEN
    RETURN NEW;
  END IF;
  -- Only push when the follow-up is for today (or already overdue).
  -- Future-dated rows ride the 9 AM cron the morning they're due.
  IF NEW.follow_up_date IS NULL
     OR NEW.follow_up_date > CURRENT_DATE THEN
    RETURN NEW;
  END IF;
  -- On UPDATE, only fire if the date moved INTO today/past from a
  -- future date, OR is_done flipped back to false. Skip the spam if
  -- the row was already due and we're just touching another column.
  IF TG_OP = 'UPDATE' THEN
    IF OLD.follow_up_date IS NOT NULL
       AND OLD.follow_up_date <= CURRENT_DATE
       AND OLD.is_done = NEW.is_done THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT id, name, company, phone INTO v_lead
    FROM public.leads WHERE id = NEW.lead_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  v_title := 'Follow-up · ' || COALESCE(v_lead.name, v_lead.company, 'lead');
  v_body  := COALESCE(NEW.note,
                      'Due ' || to_char(NEW.follow_up_date, 'DD Mon'));

  PERFORM public.enqueue_push(
    NEW.assigned_to,
    v_title,
    v_body,
    '/leads/' || v_lead.id::text,
    'fu-' || NEW.id::text
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_push_followup_due ON public.follow_ups;
CREATE TRIGGER tg_push_followup_due
  AFTER INSERT OR UPDATE OF follow_up_date, is_done ON public.follow_ups
  FOR EACH ROW EXECUTE FUNCTION public.tg_push_on_followup_due();


NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────
-- Both triggers should exist after the run.
SELECT
  (SELECT count(*) FROM pg_trigger
    WHERE tgname = 'tg_push_lead_task_insert')  AS lead_task_trigger,
  (SELECT count(*) FROM pg_trigger
    WHERE tgname = 'tg_push_followup_due')      AS followup_trigger;
