-- supabase_phase61_quiet_hours.sql
--
-- Phase 61.4 (19 May 2026) — push notification quiet hours.
--
-- Owner reported (19 May 2026): "dhara got notification at 11:21 why ?"
-- — 11 follow-up-due pushes fired at 11:21 PM IST. Reps were going to
-- bed. Even if the trigger had a valid reason to fire, pushing after
-- 9 PM is a UX failure.
--
-- Fix: wrap every push trigger + attendance dispatcher with an IST
-- time gate. Pushes only fire between 09:00 and 21:00 IST. Outside
-- that window the trigger short-circuits — no push goes to the rep.
--
-- The follow-up / task itself still gets created normally; just the
-- notification is suppressed. The 9:30 IST morning check-in cron
-- handles the next-day digest, so reps still see the rolled-up
-- summary when they wake up.
--
-- Idempotent: CREATE OR REPLACE on every function; no schema mutation.


-- =====================================================================
-- §1. push_quiet_hours() helper — single source of truth
-- =====================================================================
-- Returns TRUE when the current IST clock is INSIDE the allowed
-- window. Default window: 09:00 IST (inclusive) → 21:00 IST (exclusive).
--
-- Why a function rather than inline checks:
--   1. Owner can later tighten / loosen by editing one place.
--   2. Future cron / edge functions reuse the same gate.
CREATE OR REPLACE FUNCTION public.is_push_allowed_now()
RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXTRACT(hour FROM (now() AT TIME ZONE 'Asia/Kolkata'))::int
         BETWEEN 9 AND 20
$$;


-- =====================================================================
-- §2. Phase 34Z.55 lead_tasks trigger — gate
-- =====================================================================
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
  -- Phase 61.4 — quiet hours.
  IF NOT public.is_push_allowed_now() THEN RETURN NEW; END IF;

  v_kind_label := CASE NEW.kind
    WHEN 'sla_breach'         THEN 'SLA breach'
    WHEN 'follow_up_due'      THEN 'Follow-up due'
    WHEN 'hot_idle'           THEN 'Hot lead going cold'
    WHEN 'qualified_no_quote' THEN 'Qualified — no quote yet'
    WHEN 'nurture_revisit'    THEN 'Nurture revisit'
    WHEN 'new_untouched'      THEN 'New lead waiting'
    ELSE 'Smart task'
  END;

  SELECT id, name, company, phone INTO v_lead
    FROM public.leads WHERE id = NEW.lead_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  v_title := v_kind_label || ' · ' || COALESCE(v_lead.name, v_lead.company, 'lead');
  v_body  := COALESCE(NEW.reason,
                      COALESCE(v_lead.company, '') ||
                      CASE WHEN v_lead.phone IS NOT NULL THEN ' · ' || v_lead.phone ELSE '' END);

  PERFORM public.enqueue_push(
    NEW.assigned_to, v_title, v_body,
    '/leads/' || v_lead.id::text,
    'task-' || NEW.id::text
  );
  RETURN NEW;
END $$;


-- =====================================================================
-- §3. Phase 34Z.55 follow_ups trigger — gate
-- =====================================================================
CREATE OR REPLACE FUNCTION public.tg_push_on_followup_due()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_lead   record;
  v_title  text;
  v_body   text;
BEGIN
  IF NEW.assigned_to IS NULL OR NEW.is_done IS TRUE THEN RETURN NEW; END IF;
  IF NEW.follow_up_date IS NULL OR NEW.follow_up_date > CURRENT_DATE THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.follow_up_date IS NOT NULL
       AND OLD.follow_up_date <= CURRENT_DATE
       AND OLD.is_done = NEW.is_done THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Phase 61.4 — quiet hours.
  IF NOT public.is_push_allowed_now() THEN RETURN NEW; END IF;

  SELECT id, name, company, phone INTO v_lead
    FROM public.leads WHERE id = NEW.lead_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  v_title := 'Follow-up · ' || COALESCE(v_lead.name, v_lead.company, 'lead');
  v_body  := COALESCE(NEW.note,
                      'Due ' || to_char(NEW.follow_up_date, 'DD Mon'));

  PERFORM public.enqueue_push(
    NEW.assigned_to, v_title, v_body,
    '/leads/' || v_lead.id::text,
    'fu-' || NEW.id::text
  );
  RETURN NEW;
END $$;


-- =====================================================================
-- §4. Phase 60 attendance enqueue helper — gate
-- =====================================================================
-- Attendance cron also runs every minute. The HHMM gate inside
-- tick_attendance() already restricts WHICH minute fires, but a 8:30
-- PM mark-absent push and 8 PM auto-checkout push are AT the quiet-
-- hours edge — keep those (they're functional notifications, not
-- nudges). Inside the 09:00–20:59 IST window everything else fires
-- normally.
--
-- enqueue_attendance_reminder is the funnel — gate it.
CREATE OR REPLACE FUNCTION public.enqueue_attendance_reminder(
  p_user        uuid,
  p_kind        text,
  p_attempt     int,
  p_title       text,
  p_body        text,
  p_url         text DEFAULT '/check-in'
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_inserted boolean;
BEGIN
  -- Phase 61.4 — auto_checkout (8 PM) + marked_absent (8:30 PM) are
  -- functional, bypass quiet hours. Everything else gated.
  IF NOT public.is_push_allowed_now()
     AND p_kind NOT IN ('auto_checkout', 'marked_absent') THEN
    RETURN false;
  END IF;

  INSERT INTO public.attendance_warnings (user_id, work_date, kind, attempt_num, message)
  VALUES (p_user, public.ist_today(), p_kind, p_attempt, p_title || ' — ' || COALESCE(p_body, ''))
  ON CONFLICT (user_id, work_date, kind, attempt_num) DO NOTHING
  RETURNING true INTO v_inserted;

  IF v_inserted IS NULL THEN
    RETURN false;
  END IF;

  PERFORM public.enqueue_push(
    p_user, p_title, p_body, p_url,
    'attendance-' || p_kind || '-' || public.ist_today()::text || '-' || p_attempt::text
  );
  RETURN true;
END $$;


NOTIFY pgrst, 'reload schema';


-- =====================================================================
-- §5. VERIFY
-- =====================================================================
SELECT
  public.is_push_allowed_now() AS push_allowed_right_now,
  (SELECT count(*) FROM pg_proc
    WHERE proname IN ('is_push_allowed_now', 'tg_push_on_lead_task_insert',
                      'tg_push_on_followup_due', 'enqueue_attendance_reminder'))
    AS functions_present;
-- Expected: TRUE or FALSE depending on time of day; functions_present = 4.
