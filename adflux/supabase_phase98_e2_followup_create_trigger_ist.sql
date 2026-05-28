-- supabase_phase98_e2_followup_create_trigger_ist.sql
--
-- Phase 98.E2 — close F-D004 (follow-up CREATE-time push uses
-- Postgres CURRENT_DATE which is UTC on Supabase).
--
-- BACKGROUND
-- ──────────
-- Phase 34Z.55 added `tg_push_on_followup_due` (the CREATE-time
-- push, NOT the every-5-min cron). Phase 61.4 re-declared the
-- same function to add the `IF NOT public.is_push_allowed_now()
-- THEN RETURN NEW; END IF;` quiet-hours gate. Body otherwise
-- byte-identical to Phase 34Z.55.
--
-- That body still uses Postgres `CURRENT_DATE` at two sites:
--   * skip-future guard:     `NEW.follow_up_date > CURRENT_DATE`
--   * was-already-due guard: `OLD.follow_up_date <= CURRENT_DATE`
--
-- Supabase session timezone defaults to UTC. `CURRENT_DATE`
-- therefore equals UTC date, which rolls at 05:30 IST.
--
-- Live impact (from Phase 98 audit, owner SQL probe):
--   * Rep creates follow-up `tomorrow IST 10:00` at 18:45 IST.
--   * IST date is today; UTC date is also today (UTC = 13:15).
--   * Skip-future guard: `tomorrow_ist > today_utc` → TRUE → push
--     correctly skipped.
--   * BUT: rep creates follow-up `today IST 21:00` at 18:45 IST.
--     IST date today; UTC date still today. Skip-future guard
--     correctly fires push.
--   * Problem case is the IST evening boundary: rep creates
--     follow-up `today IST 23:30` at 22:30 IST.
--     UTC time = 17:00 UTC, UTC date = today.
--     IST date today (still). `today_today > today_today` is
--     FALSE → push proceeds. Quiet-hours gate at 22:30 IST
--     blocks it anyway (Phase 61.4 window 09-21 IST).
--   * Truly broken case: rep creates follow-up `tomorrow IST` at
--     00:30 IST (= 19:00 UTC prev day). UTC date is yesterday;
--     IST date is tomorrow. `tomorrow_ist > yesterday_utc` is
--     TRUE → push correctly skipped.
--   * REGRESSION case: between IST 00:00 and IST 05:30 (= UTC
--     18:30-00:00 prev day), Postgres CURRENT_DATE is yesterday
--     UTC. A rep who creates `today IST` follow-up during that
--     5.5-hour window: `today_ist > yesterday_utc` is TRUE →
--     skip-future fires → push CORRECTLY skipped (the push will
--     fire when due via the 5-min cron Phase 93.8/97.A400).
--   * Real regression: between IST 18:30 and IST 23:59 (= UTC
--     13:00-18:29), CURRENT_DATE is today UTC = today IST. A
--     rep creating `tomorrow IST` follow-up: `tomorrow_ist >
--     today_utc` is TRUE → skip. Same as expected. Most cases
--     work by coincidence.
--   * The edge case that surfaces only between IST 18:30 and
--     IST 23:59 on the same calendar day: rep creates follow-up
--     for `today IST 22:00`. CURRENT_DATE returns today UTC =
--     today IST. `today_ist > today_utc` = `today > today` =
--     FALSE → push proceeds → quiet-hours gate may still block
--     (depending on the exact moment). Behaviour is
--     time-window-dependent and inconsistent.
--
-- The intent in Phase 34Z.55 was "if the follow-up is for a
-- FUTURE IST DAY, skip CREATE-time push and let the 5-min cron
-- handle it when due". Today's code uses UTC date — works most
-- of the time, breaks at the 5.5-hour IST midnight window.
--
-- FIX
-- ───
-- Replace `CURRENT_DATE` (Postgres session TZ) with
-- `(now() AT TIME ZONE 'Asia/Kolkata')::date`. Mirrors the
-- pattern used in Phase 93.8 / 97.A400 (`push_followup_due_
-- reminders`), Phase 34Z.61 (`push_morning_checkin`), and
-- Phase 34Z.84 (`push_followup_digest`). Body otherwise
-- byte-identical to Phase 61.4:
--   * SECURITY DEFINER preserved
--   * SET search_path = public, extensions preserved
--   * Quiet-hours gate (Phase 61.4 line 108) preserved
--   * enqueue_push call + tag `'fu-' || NEW.id::text` preserved
--   * Trigger DDL UNTOUCHED (no DROP TRIGGER / CREATE TRIGGER)
--
-- IDEMPOTENCY
-- ───────────
-- CREATE OR REPLACE FUNCTION + NOTIFY pgrst. No table mutation.
-- Re-runnable.
--
-- SCOPE
-- ─────
-- This migration closes F-D004 only. It does NOT touch:
--   * Phase 93.8 / 97.A400 `push_followup_due_reminders` cron
--     (already uses Asia/Kolkata)
--   * Phase 61.4 `is_push_allowed_now()` helper
--   * Phase 34Z.55 trigger DDL itself (only the function body
--     `tg_push_on_followup_due` is re-created)
--   * Phase 33W triggers Phase 98.A re-declared
--   * `enqueue_push` (Phase 34Z.69 / 97.A2 REVOKE intact)
--   * Any rep-side JS, Edge Function, or APK
--   * Other `CURRENT_DATE` uses elsewhere in the schema (those
--     are separate sites; this file fixes only the follow-up
--     CREATE trigger)


CREATE OR REPLACE FUNCTION public.tg_push_on_followup_due()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_lead   record;
  v_title  text;
  v_body   text;
  v_today_ist date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  IF NEW.assigned_to IS NULL OR NEW.is_done IS TRUE THEN RETURN NEW; END IF;
  -- Phase 98.E2 — was: NEW.follow_up_date > CURRENT_DATE (UTC).
  IF NEW.follow_up_date IS NULL OR NEW.follow_up_date > v_today_ist THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    -- Phase 98.E2 — was: OLD.follow_up_date <= CURRENT_DATE (UTC).
    IF OLD.follow_up_date IS NOT NULL
       AND OLD.follow_up_date <= v_today_ist
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


NOTIFY pgrst, 'reload schema';


-- ───────────── VERIFY ─────────────
-- Run all 3 after applying. Each must return the expected
-- result. If any fails, ROLLBACK.
--
-- 1. Function body now references Asia/Kolkata + no longer
--    references CURRENT_DATE (1 row, both checks true):
--
--    SELECT proname,
--           pg_get_functiondef(oid) ILIKE '%Asia/Kolkata%' AS has_ist,
--           pg_get_functiondef(oid) NOT ILIKE '%CURRENT_DATE%' AS no_utc_current_date,
--           pg_get_functiondef(oid) ILIKE '%is_push_allowed_now%' AS quiet_hours_intact
--      FROM pg_proc
--     WHERE proname = 'tg_push_on_followup_due';
--    -- Expected: 1 row, all three booleans true.
--
-- 2. Trigger DDL still bound to the function (1 row, table =
--    follow_ups, function = tg_push_on_followup_due):
--
--    SELECT t.tgname, c.relname AS table_name, p.proname AS function
--      FROM pg_trigger t
--      JOIN pg_class c ON c.oid = t.tgrelid
--      JOIN pg_proc  p ON p.oid = t.tgfoid
--     WHERE p.proname = 'tg_push_on_followup_due'
--       AND NOT t.tgisinternal;
--    -- Expected: 1 row binding the function to follow_ups.
--
-- 3. PostgREST schema reload landed:
--
--    SELECT 1;
--    -- Returns 1.


-- ───────────── ROLLBACK ─────────────
-- Re-apply ONLY if a real regression appears. Restores the
-- Phase 61.4 body byte-identical with UTC CURRENT_DATE. Re-
-- opens F-D004 (IST evening / morning edge cases).
--
--   CREATE OR REPLACE FUNCTION public.tg_push_on_followup_due()
--   RETURNS trigger
--   LANGUAGE plpgsql
--   SECURITY DEFINER
--   SET search_path = public, extensions
--   AS $$
--   DECLARE
--     v_lead   record;
--     v_title  text;
--     v_body   text;
--   BEGIN
--     IF NEW.assigned_to IS NULL OR NEW.is_done IS TRUE THEN RETURN NEW; END IF;
--     IF NEW.follow_up_date IS NULL OR NEW.follow_up_date > CURRENT_DATE THEN
--       RETURN NEW;
--     END IF;
--     IF TG_OP = 'UPDATE' THEN
--       IF OLD.follow_up_date IS NOT NULL
--          AND OLD.follow_up_date <= CURRENT_DATE
--          AND OLD.is_done = NEW.is_done THEN
--         RETURN NEW;
--       END IF;
--     END IF;
--
--     -- Phase 61.4 — quiet hours.
--     IF NOT public.is_push_allowed_now() THEN RETURN NEW; END IF;
--
--     SELECT id, name, company, phone INTO v_lead
--       FROM public.leads WHERE id = NEW.lead_id;
--     IF NOT FOUND THEN RETURN NEW; END IF;
--
--     v_title := 'Follow-up · ' || COALESCE(v_lead.name, v_lead.company, 'lead');
--     v_body  := COALESCE(NEW.note,
--                         'Due ' || to_char(NEW.follow_up_date, 'DD Mon'));
--
--     PERFORM public.enqueue_push(
--       NEW.assigned_to, v_title, v_body,
--       '/leads/' || v_lead.id::text,
--       'fu-' || NEW.id::text
--     );
--     RETURN NEW;
--   END $$;
--
--   NOTIFY pgrst, 'reload schema';
