-- supabase_phase98_h_calls_counter_repair.sql
--
-- Phase 98.H — repair work_sessions.daily_counters.calls (triggers).
--
-- BACKGROUND
-- ──────────
-- Today's /work audit math-locked the bug:
--   * trg_call_log_bump_counter fires on every call_logs INSERT
--     → calls bumped via bump_daily_counter('calls', 1).
--   * trg_lead_activity_bump_counter ALSO bumps 'calls' for every
--     lead_activities INSERT where activity_type='call' (Phase
--     93.7.1 body, kept that branch "intentionally raw"). The
--     PostCallOutcomeModal chain inserts BOTH rows per app call
--     → 2× bump per tap.
--   * bump_daily_counter UPSERTs to (user_id, current_date) where
--     current_date = Postgres CURRENT_DATE = UTC on Supabase. It
--     ignores NEW.call_at, so Phase 56l CallHistoryPoller
--     backfills of yesterday's device CallLog inflate today's
--     counter row.
--
-- Owner SQL probe (Probe Z2) showed 233 orphan call activities in
-- the past 7 days — lead_activities call rows without a sibling
-- call_logs row. Mostly produced by TC outcome-modal saves (Rima
-- 120 + 34, Dhara 23-9 per day) plus a few sales "Call from
-- leads list" actions. Dropping the call branch from
-- lead_activity_bump_counter would silently under-count this
-- TC activity, so we KEEP the branch and add a 5-second dedup
-- guard: skip the bump if a call_logs sibling INSERT just
-- fired for the same (user, lead).
--
-- A union-source backfill of work_sessions.daily_counters.calls
-- (call_logs by IST call_at + orphan lead_activities by IST
-- created_at) was already applied. This file ONLY swaps the
-- trigger function bodies to keep the clean state correct
-- going forward.
--
-- WHAT CHANGES
-- ────────────
-- 1. bump_daily_counter — 4th arg `p_for_date date DEFAULT NULL`.
--    Default = (now() AT TIME ZONE 'Asia/Kolkata')::date. Existing
--    meetings + new_leads callers pass nothing → IST today
--    (improvement, not break). Calls callers pass the per-row date.
--
-- 2. call_log_bump_counter — pass
--    (COALESCE(NEW.call_at, NEW.created_at)
--       AT TIME ZONE 'Asia/Kolkata')::date
--    so a Phase 56l late-import of yesterday's device CallLog
--    lands in yesterday's counter row, not today's.
--
-- 3. lead_activity_bump_counter — call branch gains 5s dedup
--    guard. Skip bump if any call_logs row for same
--    (lead_id, user_id) lies within 5s of NEW.created_at.
--    Sales tel: chain inserts call_logs first → guard hits →
--    skip (call_log_bump_counter already fired). TC outcome
--    modal / LeadsV2 row-call don't insert call_logs → no
--    sibling → bump here. Net: +1 per real call event.
--    Meeting branch (Phase 93.6 auto-check-in + Phase 93.7
--    revisit) preserved BYTE-IDENTICAL to Phase 93.7.1.
--
-- IDEMPOTENCY
-- ───────────
-- CREATE OR REPLACE FUNCTION × 3. No table mutation. Re-run safe.
--
-- SCOPE (what this file does NOT touch)
-- ──────────────────────────────────────
--   * Trigger DDL — bindings stay intact (only function bodies recreated).
--   * lead_after_insert_bump_counter — Phase 12 trigger preserved.
--   * Score triggers (Phase 34Z.66 + Phase 93.7.2) — separate concern.
--   * SLA / heat / handoff triggers — separate concern.
--   * Phase 98.G WorkV2 frontend override — already shipped.
--   * Phase 98.E2 follow-up push trigger — separate.
--   * Backfill of historical counters — already landed earlier
--     today; re-baseline query commented at bottom only.


-- ────────────────────────────────────────────────────────────────
-- 1. bump_daily_counter — optional 4th arg with IST default
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bump_daily_counter(
  p_user_id  uuid,
  p_counter  text,
  p_amount   int,
  p_for_date date DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_date date := COALESCE(
    p_for_date,
    (now() AT TIME ZONE 'Asia/Kolkata')::date
  );
BEGIN
  INSERT INTO public.work_sessions (user_id, work_date, daily_counters)
  VALUES (
    p_user_id, v_date,
    jsonb_build_object(p_counter, p_amount)
  )
  ON CONFLICT (user_id, work_date) DO UPDATE SET
    daily_counters = jsonb_set(
      COALESCE(public.work_sessions.daily_counters, '{}'::jsonb),
      ARRAY[p_counter],
      to_jsonb(
        COALESCE((public.work_sessions.daily_counters ->> p_counter)::int, 0)
        + p_amount
      ),
      true
    ),
    updated_at = now();
END;
$$;


-- ────────────────────────────────────────────────────────────────
-- 2. call_log_bump_counter — bucket by call_at IST, not insert UTC
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.call_log_bump_counter()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.bump_daily_counter(
    NEW.user_id,
    'calls',
    1,
    (COALESCE(NEW.call_at, NEW.created_at)
       AT TIME ZONE 'Asia/Kolkata')::date
  );
  RETURN NEW;
END;
$$;


-- ────────────────────────────────────────────────────────────────
-- 3. lead_activity_bump_counter
--    Call branch: 5s dedup guard against call_logs sibling.
--    Meeting branch: byte-identical to Phase 93.7.1 (auto-check-in
--    skip + revisit dedup).
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lead_activity_bump_counter()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_already_today int;
  v_sibling_call  int;
BEGIN
  -- ── Calls branch (Phase 98.H — was: bump unconditionally) ──
  -- Skip the bump if a call_logs row for the same (user, lead)
  -- already INSERTed within 5s. trg_call_log_bump_counter already
  -- fired for that sibling. Orphan paths (TC outcome-modal,
  -- LeadsV2 row-call) skip call_logs → no sibling → bump here.
  -- Net: +1 per real call event, not 2.
  IF NEW.activity_type = 'call' THEN
    SELECT count(*)
      INTO v_sibling_call
      FROM public.call_logs cl
     WHERE cl.lead_id = NEW.lead_id
       AND cl.user_id = NEW.created_by
       AND abs(extract(epoch FROM (cl.created_at - NEW.created_at))) < 5;

    IF v_sibling_call = 0 THEN
      PERFORM public.bump_daily_counter(
        NEW.created_by,
        'calls',
        1,
        (COALESCE(NEW.created_at, now())
           AT TIME ZONE 'Asia/Kolkata')::date
      );
    END IF;
    RETURN NEW;
  END IF;

  -- ── Meeting / site_visit branch — Phase 93.6 + 93.7 byte-identical ──
  IF NEW.activity_type IN ('meeting', 'site_visit') THEN
    -- Phase 93.6 — skip "I'm here · auto-check-in" companion rows.
    IF NEW.notes IS NOT NULL
       AND NEW.notes LIKE 'I''m here · auto-check-in%' THEN
      RETURN NEW;
    END IF;

    -- Phase 93.7 — revisit detection. Walk-ins (lead_id IS NULL)
    -- always bump because they can't be dedupe'd.
    IF NEW.lead_id IS NOT NULL THEN
      SELECT count(*)
        INTO v_already_today
        FROM public.lead_activities prev
       WHERE prev.created_by      = NEW.created_by
         AND prev.lead_id         = NEW.lead_id
         AND prev.activity_type   IN ('meeting', 'site_visit')
         AND prev.created_at::date = NEW.created_at::date
         AND prev.id              <> NEW.id
         AND (prev.notes IS NULL
              OR prev.notes NOT LIKE 'I''m here · auto-check-in%');

      IF v_already_today > 0 THEN
        RETURN NEW;
      END IF;
    END IF;

    PERFORM public.bump_daily_counter(NEW.created_by, 'meetings', 1);
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;


NOTIFY pgrst, 'reload schema';


-- ───────────── VERIFY ─────────────
-- Paste each query separately. Each returns the expected shape.
--
-- V1 — bump_daily_counter now takes 4 args:
--
--   SELECT pg_get_function_arguments(oid)
--     FROM pg_proc
--    WHERE proname = 'bump_daily_counter';
--   -- Expected:
--   --   p_user_id uuid, p_counter text, p_amount integer,
--   --   p_for_date date DEFAULT NULL
--
-- V2 — call_log_bump_counter passes call_at IST date:
--
--   SELECT pg_get_functiondef(oid) ILIKE '%Asia/Kolkata%' AS has_ist,
--          pg_get_functiondef(oid) ILIKE '%COALESCE(NEW.call_at%' AS has_fallback
--     FROM pg_proc
--    WHERE proname = 'call_log_bump_counter';
--   -- Expected: 1 row, both booleans true.
--
-- V3 — lead_activity_bump_counter has 5s dedup on calls,
-- meeting branch intact:
--
--   SELECT pg_get_functiondef(oid) ILIKE '%v_sibling_call%' AS has_dedup_guard,
--          pg_get_functiondef(oid) ILIKE '%v_already_today%' AS meeting_guard_intact,
--          pg_get_functiondef(oid) ILIKE '%auto-check-in%' AS p93_6_intact
--     FROM pg_proc
--    WHERE proname = 'lead_activity_bump_counter';
--   -- Expected: 1 row, all three booleans true.
--
-- V4 — Trigger DDL still bound to the 2 functions (call_logs
-- + lead_activities). Bindings untouched:
--
--   SELECT t.tgname, c.relname AS table_name, p.proname AS function
--     FROM pg_trigger t
--     JOIN pg_class c ON c.oid = t.tgrelid
--     JOIN pg_proc  p ON p.oid = t.tgfoid
--    WHERE p.proname IN ('call_log_bump_counter', 'lead_activity_bump_counter')
--      AND NOT t.tgisinternal
--    ORDER BY c.relname, t.tgname;
--   -- Expected: 2 rows. trg_call_log_bump_counter on call_logs +
--   -- trg_lead_activity_bump_counter on lead_activities.
--
-- V5 — schema reload landed:
--
--   SELECT 1;
--   -- Expected: 1.
--
-- V6 — LIVE SMOKE TEST (manual, post-deploy):
--   Pick a rep + tap Call once on /work. Wait ~5s. Then:
--
--   SELECT (daily_counters->>'calls')::int AS calls
--     FROM public.work_sessions
--    WHERE user_id = '<rep_uuid>'
--      AND work_date = (now() AT TIME ZONE 'Asia/Kolkata')::date;
--   -- Counter should bump by EXACTLY 1, not 2.


-- ───────────── OPTIONAL RE-BASELINE BACKFILL ─────────────
-- Paste ONLY if you want to refresh today's counters after the
-- trigger fix lands. Today's accidental union backfill already
-- ran once; re-running snaps every work_session.daily_counters.calls
-- to the union of (call_logs by IST call_at) + (orphan
-- lead_activities by IST created_at). Safe to re-run. NOT
-- EXECUTED by this migration.
--
-- UPDATE public.work_sessions ws
--    SET daily_counters = jsonb_set(
--      COALESCE(ws.daily_counters, '{}'::jsonb),
--      '{calls}',
--      to_jsonb((
--        SELECT count(*) FROM (
--          SELECT cl.user_id, cl.lead_id, cl.created_at
--            FROM public.call_logs cl
--           WHERE cl.user_id = ws.user_id
--             AND (COALESCE(cl.call_at, cl.created_at)
--                    AT TIME ZONE 'Asia/Kolkata')::date = ws.work_date
--          UNION
--          SELECT la.created_by, la.lead_id, la.created_at
--            FROM public.lead_activities la
--           WHERE la.created_by    = ws.user_id
--             AND la.activity_type = 'call'
--             AND (la.created_at AT TIME ZONE 'Asia/Kolkata')::date
--                   = ws.work_date
--             AND NOT EXISTS (
--               SELECT 1 FROM public.call_logs cl2
--                WHERE cl2.lead_id = la.lead_id
--                  AND cl2.user_id = la.created_by
--                  AND abs(extract(epoch FROM
--                        (cl2.created_at - la.created_at))) < 5
--             )
--        ) x
--      ))
--    )
--  WHERE ws.work_date >= '2026-05-04';


-- ───────────── ROLLBACK ─────────────
-- Re-apply only if a real regression appears. Restores Phase 12
-- bump_daily_counter (3-arg, current_date UTC), Phase 12
-- call_log_bump_counter, AND Phase 93.7.1 lead_activity_bump_
-- counter (with the original `call` branch that double-bumps).
-- Re-opens the double-bump + UTC drift bugs.
--
-- Strip the leading "-- " from each line below to execute.
--
-- CREATE OR REPLACE FUNCTION public.bump_daily_counter(
--   p_user_id uuid, p_counter text, p_amount int
-- ) RETURNS void
-- LANGUAGE plpgsql AS $$
-- BEGIN
--   INSERT INTO public.work_sessions (user_id, work_date, daily_counters)
--   VALUES (p_user_id, current_date,
--           jsonb_build_object(p_counter, p_amount))
--   ON CONFLICT (user_id, work_date) DO UPDATE SET
--     daily_counters = jsonb_set(
--       COALESCE(public.work_sessions.daily_counters, '{}'::jsonb),
--       ARRAY[p_counter],
--       to_jsonb(COALESCE((public.work_sessions.daily_counters ->> p_counter)::int, 0) + p_amount),
--       true
--     ),
--     updated_at = now();
-- END;
-- $$;
--
-- CREATE OR REPLACE FUNCTION public.call_log_bump_counter()
-- RETURNS trigger LANGUAGE plpgsql AS $$
-- BEGIN
--   PERFORM public.bump_daily_counter(NEW.user_id, 'calls', 1);
--   RETURN NEW;
-- END;
-- $$;
--
-- CREATE OR REPLACE FUNCTION public.lead_activity_bump_counter()
-- RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
-- AS $$
-- DECLARE
--   v_already_today int;
-- BEGIN
--   IF NEW.activity_type = 'call' THEN
--     PERFORM public.bump_daily_counter(NEW.created_by, 'calls', 1);
--     RETURN NEW;
--   END IF;
--   IF NEW.activity_type IN ('meeting', 'site_visit') THEN
--     IF NEW.notes IS NOT NULL
--        AND NEW.notes LIKE 'I''m here · auto-check-in%' THEN
--       RETURN NEW;
--     END IF;
--     IF NEW.lead_id IS NOT NULL THEN
--       SELECT count(*)
--         INTO v_already_today
--         FROM public.lead_activities prev
--        WHERE prev.created_by      = NEW.created_by
--          AND prev.lead_id         = NEW.lead_id
--          AND prev.activity_type   IN ('meeting', 'site_visit')
--          AND prev.created_at::date = NEW.created_at::date
--          AND prev.id              <> NEW.id
--          AND (prev.notes IS NULL
--               OR prev.notes NOT LIKE 'I''m here · auto-check-in%');
--       IF v_already_today > 0 THEN
--         RETURN NEW;
--       END IF;
--     END IF;
--     PERFORM public.bump_daily_counter(NEW.created_by, 'meetings', 1);
--     RETURN NEW;
--   END IF;
--   RETURN NEW;
-- END;
-- $$;
--
-- NOTIFY pgrst, 'reload schema';
