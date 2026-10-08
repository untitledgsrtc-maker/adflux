-- ============================================================================
-- db/functions/ops_digest.sql  -  THE CANONICAL HOME (Phase 352)
-- ============================================================================
-- Operations PUSH alerts, part 2: the daily digests + the two ticket-event pushes.
-- Four functions live here (the triggers and the cron jobs are created in
-- supabase_phase352_ops_alerts.sql):
--
--   1. ops_morning_digest()        cron 09:30 IST, Mon-Sat  - one push per technician + per head
--   2. ops_head_evening_push()     cron 19:30 IST, Mon-Sat  - one push per head
--   3. ops_ticket_assignment_push() statement-level trigger  - "N faults assigned to you", coalesced
--   4. ops_ticket_resolved_push()  row-level trigger         - head: "a ticket awaits approval"
--                                  (taps through to /ops-dashboard, where Approve / Reject lives)
--
-- OWNER DECISIONS (locked): techs AND the operation head get alerts; pushes only inside the
--   allowed hours (public.is_push_allowed_now() = 09:00-20:59 IST); camera faults are
--   digest-only (counted in the morning digest, never a per-ticket push); everything is
--   EXCEPTION-wrapped and returns quietly - an ops alert must never break a ticket update or
--   the sync; WhatsApp is OUT of scope (api/ops/ticket-wa.js untouched).
--
-- COMMON RULES
--   * SECURITY DEFINER + pinned search_path; REVOKE ALL FROM PUBLIC, anon, authenticated.
--     (A trigger function needs no EXECUTE grant to fire - PostgreSQL checks it only at
--     CREATE TRIGGER time. The cron jobs run as postgres and bypass the revoke.)
--   * Digests skip Sundays and company holidays through the ONE helper public.is_off_day(date)
--     (Sunday OR an active row in holidays) and are gated by is_push_allowed_now().
--   * Digests are idempotent per day: tag ops-digest-<uuid>-<yyyymmdd> / ops-evening-<uuid>-
--     <yyyymmdd>, and a re-run first looks the tag up in push_log, so a second call (cron retry,
--     manual run) cannot double-send. Nothing to report -> nothing is sent (morning only).
--   * "Down" uses the same debounce as ops_notify_outages: ACTIVE screen, status='offline',
--     last_response_at older than 20 minutes (NULL counts as old). A camera fault is the p10
--     definition: screen ONLINE with camera_active = false.
--   * "No technician" = an ACTIVE depot whose assigned_to is NULL / inactive / not an
--     operation_executive.
--   * Pending approvals reuse ops_pending_approvals' JOIN boundary: a leave / TA claim counts only
--     if its user is an ACTIVE operation_executive (never a sales rep's).
--   * Never touches pay: no ops_uptime_daily / daily_performance / salary logic is read or written.
--
-- BULK HEALS: ops_tickets now has these two triggers. A one-off data heal that moves or resolves
--   many tickets should run inside `SET LOCAL session_replication_role = replica;` (as the owner/
--   postgres role) so it does not push - or accept the coalesced assignment push, which is exactly
--   what the head's depot reassignment (ops_depot_owner_change_move_tickets) now produces.
--
-- RUN ORDER: ops_notify_outages.sql and this file FIRST, then supabase_phase352_ops_alerts.sql.
-- ============================================================================


-- ── 1 · MORNING DIGEST ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ops_morning_digest()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
SET lock_timeout TO '3s'
AS $fn$
DECLARE
  e               record;
  h               record;
  v_today         date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_ymd           text := to_char((now() AT TIME ZONE 'Asia/Kolkata')::date, 'YYYYMMDD');
  v_tag           text;
  v_parts         text[];
  v_down          int;
  v_camoff        int;
  v_open          int;
  v_over48        int;
  v_dark          int;
  v_notech        int;
  v_approvals     int;
  v_execs_pushed  int := 0;
  v_heads_pushed  int := 0;
BEGIN
  IF NOT COALESCE(public.is_push_allowed_now(), false) THEN
    RETURN jsonb_build_object('skipped', 'quiet-hours', 'execs_pushed', 0, 'heads_pushed', 0);
  END IF;
  IF COALESCE(public.is_off_day(v_today), false) THEN
    RETURN jsonb_build_object('skipped', 'off-day', 'execs_pushed', 0, 'heads_pushed', 0);
  END IF;

  -- ── each active technician who owns at least one active station ──────────────
  FOR e IN
    SELECT u.id
      FROM public.users u
     WHERE u.role = 'operation_executive'
       AND u.is_active IS TRUE
       AND EXISTS (SELECT 1 FROM public.ops_depots dp
                    WHERE dp.assigned_to = u.id AND dp.is_active)
     ORDER BY u.id
  LOOP
    v_tag := 'ops-digest-' || e.id::text || '-' || v_ymd;
    IF EXISTS (SELECT 1 FROM public.push_log pl
                WHERE pl.user_id = e.id AND pl.tag = v_tag
                  AND pl.enqueued_at > now() - interval '3 days') THEN
      CONTINUE;
    END IF;

    SELECT count(*) FILTER (WHERE sc.status = 'offline'
                              AND COALESCE(sc.last_response_at, '-infinity'::timestamptz)
                                  < now() - interval '20 minutes'),
           count(*) FILTER (WHERE sc.status = 'online' AND sc.camera_active = false)
      INTO v_down, v_camoff
      FROM public.ops_screens sc
      JOIN public.ops_depots dp
        ON dp.id = sc.depot_id AND dp.is_active AND dp.assigned_to = e.id
     WHERE sc.is_active;

    SELECT count(*),
           count(*) FILTER (WHERE t.opened_at < now() - interval '48 hours')
      INTO v_open, v_over48
      FROM public.ops_tickets t
     WHERE t.assigned_to = e.id AND t.status IN ('open', 'in_progress');

    IF COALESCE(v_down, 0) = 0 AND COALESCE(v_camoff, 0) = 0
       AND COALESCE(v_open, 0) = 0 AND COALESCE(v_over48, 0) = 0 THEN
      CONTINUE;   -- nothing to report
    END IF;

    v_parts := ARRAY[]::text[];
    IF v_down   > 0 THEN v_parts := v_parts || format('%s સ્ક્રીન બંધ', v_down); END IF;
    IF v_camoff > 0 THEN v_parts := v_parts || format('%s કૅમેરા બંધ', v_camoff); END IF;
    IF v_open   > 0 THEN v_parts := v_parts || format('%s ખુલ્લી ખરાબી', v_open); END IF;
    IF v_over48 > 0 THEN v_parts := v_parts || format('%s ખરાબી 48 કલાકથી જૂની', v_over48); END IF;

    BEGIN
      PERFORM public.enqueue_push(e.id, 'સવારનો રિપોર્ટ',
                                  array_to_string(v_parts, ' · '), '/ops-home', v_tag);
      v_execs_pushed := v_execs_pushed + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'ops_morning_digest: tech push failed for %: %', e.id, SQLERRM;
    END;
  END LOOP;

  -- ── the network numbers for the head(s) - computed once ─────────────────────
  SELECT count(DISTINCT dp.id)
    INTO v_dark
    FROM public.ops_depots dp
    JOIN public.ops_screens sc ON sc.depot_id = dp.id AND sc.is_active
                              AND sc.status = 'offline'
                              AND COALESCE(sc.last_response_at, '-infinity'::timestamptz)
                                  < now() - interval '20 minutes'
   WHERE dp.is_active;

  SELECT count(*)
    INTO v_over48
    FROM public.ops_tickets t
   WHERE t.status IN ('open', 'in_progress')
     AND t.opened_at < now() - interval '48 hours';

  SELECT count(*)
    INTO v_notech
    FROM public.ops_depots dp
   WHERE dp.is_active
     AND NOT EXISTS (SELECT 1 FROM public.users u
                      WHERE u.id = dp.assigned_to AND u.is_active IS TRUE
                        AND u.role = 'operation_executive');

  -- same JOIN boundary as ops_pending_approvals: field technicians only
  SELECT (SELECT count(*) FROM public.leaves l
            JOIN public.users u ON u.id = l.user_id
                               AND u.role = 'operation_executive' AND u.is_active
           WHERE l.status = 'pending')
       + (SELECT count(*) FROM public.ta_da_requests t
            JOIN public.users u ON u.id = t.user_id
                               AND u.role = 'operation_executive' AND u.is_active
           WHERE t.status = 'pending')
    INTO v_approvals;

  IF COALESCE(v_dark, 0) > 0 OR COALESCE(v_over48, 0) > 0
     OR COALESCE(v_notech, 0) > 0 OR COALESCE(v_approvals, 0) > 0 THEN
    v_parts := ARRAY[]::text[];
    IF v_dark      > 0 THEN v_parts := v_parts || format('%s સ્ટેશન બંધ', v_dark); END IF;
    IF v_over48    > 0 THEN v_parts := v_parts || format('%s ખરાબી 48 કલાકથી જૂની', v_over48); END IF;
    IF v_notech    > 0 THEN v_parts := v_parts || format('%s સ્ટેશન પર ટેક્નિશિયન નથી', v_notech); END IF;
    IF v_approvals > 0 THEN v_parts := v_parts || format('%s મંજૂરી બાકી', v_approvals); END IF;

    FOR h IN
      SELECT u.id FROM public.users u
       WHERE u.role = 'operation_head' AND u.is_active IS TRUE
       ORDER BY u.id
    LOOP
      v_tag := 'ops-digest-' || h.id::text || '-' || v_ymd;
      IF EXISTS (SELECT 1 FROM public.push_log pl
                  WHERE pl.user_id = h.id AND pl.tag = v_tag
                    AND pl.enqueued_at > now() - interval '3 days') THEN
        CONTINUE;
      END IF;
      BEGIN
        PERFORM public.enqueue_push(h.id, 'સવારનો રિપોર્ટ',
                                    array_to_string(v_parts, ' · '), '/ops-command', v_tag);
        v_heads_pushed := v_heads_pushed + 1;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'ops_morning_digest: head push failed for %: %', h.id, SQLERRM;
      END;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('execs_pushed', v_execs_pushed, 'heads_pushed', v_heads_pushed);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error', SQLERRM, 'execs_pushed', 0, 'heads_pushed', 0);
END
$fn$;

REVOKE ALL     ON FUNCTION public.ops_morning_digest() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ops_morning_digest() TO service_role;


-- ── 2 · HEAD EVENING PUSH ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ops_head_evening_push()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
SET lock_timeout TO '3s'
AS $fn$
DECLARE
  h               record;
  v_today         date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_ymd           text := to_char((now() AT TIME ZONE 'Asia/Kolkata')::date, 'YYYYMMDD');
  v_tag           text;
  v_dark          int;
  v_pushed        int := 0;
BEGIN
  IF NOT COALESCE(public.is_push_allowed_now(), false) THEN
    RETURN jsonb_build_object('skipped', 'quiet-hours', 'heads_pushed', 0);
  END IF;
  IF COALESCE(public.is_off_day(v_today), false) THEN
    RETURN jsonb_build_object('skipped', 'off-day', 'heads_pushed', 0);
  END IF;

  -- stations dark right now
  SELECT count(DISTINCT dp.id)
    INTO v_dark
    FROM public.ops_depots dp
    JOIN public.ops_screens sc ON sc.depot_id = dp.id AND sc.is_active
                              AND sc.status = 'offline'
                              AND COALESCE(sc.last_response_at, '-infinity'::timestamptz)
                                  < now() - interval '20 minutes'
   WHERE dp.is_active;

  -- (No "technician has not checked in" line: check-in does not drive ops pay or TA, it is only a soft
  --  roster nudge, so a standing alert about it would be noise. The head sees it on /ops-command instead.)

  FOR h IN
    SELECT u.id FROM public.users u
     WHERE u.role = 'operation_head' AND u.is_active IS TRUE
     ORDER BY u.id
  LOOP
    v_tag := 'ops-evening-' || h.id::text || '-' || v_ymd;
    IF EXISTS (SELECT 1 FROM public.push_log pl
                WHERE pl.user_id = h.id AND pl.tag = v_tag
                  AND pl.enqueued_at > now() - interval '3 days') THEN
      CONTINUE;
    END IF;
    BEGIN
      PERFORM public.enqueue_push(
        h.id,
        'ઓપરેશન રિપોર્ટ તૈયાર છે',
        CASE WHEN COALESCE(v_dark, 0) > 0 THEN format('%s સ્ટેશન બંધ', v_dark)
             ELSE 'બધા સ્ટેશન ચાલુ છે' END,
        '/ops-command',
        v_tag);
      v_pushed := v_pushed + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'ops_head_evening_push: push failed for %: %', h.id, SQLERRM;
    END;
  END LOOP;

  RETURN jsonb_build_object('heads_pushed', v_pushed);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error', SQLERRM, 'heads_pushed', 0);
END
$fn$;

REVOKE ALL     ON FUNCTION public.ops_head_evening_push() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ops_head_evening_push() TO service_role;


-- ── 3 · ASSIGNMENT PUSH (statement-level, coalesced) ───────────────────────────
-- A bulk UPDATE of 57 tickets is ONE statement -> this fires ONCE and pushes ONE message per
-- technician ("તમને 57 ખરાબી સોંપાઈ"), not 57. Uses transition tables (old_t / new_t).
-- PostgreSQL does NOT allow a column list (AFTER UPDATE OF assigned_to) together with
-- REFERENCING on the same trigger, so it is a plain AFTER UPDATE and the assigned_to
-- comparison is done here; a normal single-column update (status, notes ...) matches nothing
-- and pushes nothing.
CREATE OR REPLACE FUNCTION public.ops_ticket_assignment_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $fn$
DECLARE
  r record;
BEGIN
  BEGIN
    IF NOT COALESCE(public.is_push_allowed_now(), false) THEN
      RETURN NULL;
    END IF;
    FOR r IN
      SELECT n.assigned_to AS uid, count(*)::int AS cnt
        FROM new_t n
        JOIN old_t o ON o.id = n.id
       WHERE n.assigned_to IS NOT NULL
         AND n.assigned_to IS DISTINCT FROM o.assigned_to
         AND n.status IN ('open', 'in_progress')
         AND EXISTS (SELECT 1 FROM public.users u
                      WHERE u.id = n.assigned_to AND u.is_active IS TRUE
                        AND u.role = 'operation_executive')
       GROUP BY n.assigned_to
    LOOP
      BEGIN
        PERFORM public.enqueue_push(
          r.uid,
          'નવી ખરાબી',
          format('તમને %s ખરાબી સોંપાઈ', r.cnt),
          '/ops-home',
          'ops-assign-' || r.uid::text || '-' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYYMMDDHH24MI'));
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'ops_ticket_assignment_push: push failed for %: %', r.uid, SQLERRM;
      END;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    -- a ticket update must NEVER fail because of a push
    RAISE WARNING 'ops_ticket_assignment_push: % ', SQLERRM;
  END;
  RETURN NULL;
END
$fn$;

REVOKE ALL ON FUNCTION public.ops_ticket_assignment_push() FROM PUBLIC, anon, authenticated;


-- ── 4 · RESOLVED PUSH (row-level) ───────────────────────────────────────────────
-- Fires only when a ticket's status becomes 'resolved' (the trigger's WHEN clause). Tells every
-- active operation_head - except the person who just made the change - that a ticket is waiting.
--
-- TAP TARGET = /ops-dashboard (OpsHeadV2). That page's "Awaiting approval" table lists EVERY
--   status='resolved' ticket with Approve / Reject (ops_ticket_approve / ops_ticket_reject), so the
--   push lands on the one screen that can do what its title says. It used to open /ops-command, which
--   has NO resolved-ticket row (its "Needs you" queue only has unassigned / overdue / leave / TA).
-- OPEN OWNER DECISION (not decided here): CLAUDE.md sections 244/246 say a fix needs no head sign-off,
--   yet that Awaiting-approval table is still live. If approval is dropped for good, reword this to an
--   FYI ("<station> fixed") and point it at /ops-tickets?tab=fixed instead - one title/body/url edit
--   in this function, nothing else.
-- BULK RESOLVES: this is a row-level trigger, so resolving N tickets in one statement pushes N times
--   (one tag per ticket). No app screen resolves in bulk; only a SQL heal does - run those inside
--   `SET LOCAL session_replication_role = replica;` (see BULK HEALS in the header).
CREATE OR REPLACE FUNCTION public.ops_ticket_resolved_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $fn$
DECLARE
  h        record;
  v_depot  text;
BEGIN
  BEGIN
    IF NOT COALESCE(public.is_push_allowed_now(), false) THEN
      RETURN NULL;
    END IF;
    SELECT d.name INTO v_depot FROM public.ops_depots d WHERE d.id = NEW.depot_id;
    FOR h IN
      SELECT u.id FROM public.users u
       WHERE u.role = 'operation_head' AND u.is_active IS TRUE
         AND u.id IS DISTINCT FROM auth.uid()
    LOOP
      BEGIN
        PERFORM public.enqueue_push(
          h.id,
          'ટિકિટ મંજૂરીની રાહ જુએ છે',
          COALESCE(v_depot, '') || ' - ખરાબી ઠીક થઈ, જોઈને મંજૂર કરો',
          '/ops-dashboard',
          'ops-resolved-' || NEW.id::text);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'ops_ticket_resolved_push: push failed for %: %', h.id, SQLERRM;
      END;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'ops_ticket_resolved_push: %', SQLERRM;
  END;
  RETURN NULL;
END
$fn$;

REVOKE ALL ON FUNCTION public.ops_ticket_resolved_push() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ===== VERIFY / TRIPWIRE (read-only; every column must be TRUE) =====
-- SELECT
--   (SELECT bool_and(p.prosecdef) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
--      AND p.proname IN ('ops_morning_digest','ops_head_evening_push','ops_ticket_assignment_push','ops_ticket_resolved_push')) AS all_definer,
--   (SELECT count(*) = 4 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
--      AND p.proname IN ('ops_morning_digest','ops_head_evening_push','ops_ticket_assignment_push','ops_ticket_resolved_push')) AS four_fns,
--   (SELECT bool_and(pg_get_functiondef(p.oid) LIKE '%EXCEPTION WHEN OTHERS%') FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
--      AND p.proname IN ('ops_morning_digest','ops_head_evening_push','ops_ticket_assignment_push','ops_ticket_resolved_push')) AS all_swallow_errors,
--   (SELECT bool_and(pg_get_functiondef(p.oid) LIKE '%is_push_allowed_now%') FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
--      AND p.proname IN ('ops_morning_digest','ops_head_evening_push','ops_ticket_assignment_push','ops_ticket_resolved_push')) AS all_quiet_hours_gated,
--   (SELECT bool_and(pg_get_functiondef(p.oid) LIKE '%is_off_day%') FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
--      AND p.proname IN ('ops_morning_digest','ops_head_evening_push')) AS digests_skip_off_days,
--   NOT has_function_privilege('anon',          'public.ops_morning_digest()', 'EXECUTE')
--     AND NOT has_function_privilege('authenticated', 'public.ops_morning_digest()', 'EXECUTE')
--     AND NOT has_function_privilege('authenticated', 'public.ops_head_evening_push()', 'EXECUTE') AS clients_locked_out;
