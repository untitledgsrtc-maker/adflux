-- ============================================================================
-- db/functions/ops_notify_outages.sql  -  THE CANONICAL HOME (Phase 352)
-- ============================================================================
-- Operations PUSH alerts, part 1: "screens are down" -> the technician + the head.
--
-- WHO CALLS IT: api/ops/sync.js, best-effort, right AFTER the status upsert and the two
--   ticket reconciles of every 10-minute aiadflux sync (so it always reads fresh status).
--   Nothing else calls it. WhatsApp is OUT of scope (api/ops/ticket-wa.js is untouched).
--
-- OWNER DECISIONS (locked): techs AND the operation head get alerts; pushes only inside
--   the allowed hours (public.is_push_allowed_now() = 09:00-20:59 IST); camera faults are
--   digest-only (this function never looks at cameras); ops alerts must never break the
--   sync (everything is EXCEPTION-wrapped, the function returns quietly).
--
-- WHAT "DOWN" MEANS (alertable): an ACTIVE screen with status='offline' whose
--   last_response_at is older than 20 minutes (debounces a flicker). A NULL last_response_at
--   counts as old. Screens with no depot are not counted (nobody to tell).
--
-- TECHNICIAN ALERT (per ACTIVE depot that has an ACTIVE operation_executive assigned):
--   * RISE  = alertable_down > last_alerted_down  AND  (never alerted OR last alert > 1 h ago)
--     -> the depot's baseline is moved to the new count (last_alerted_down, last_alert_at=now())
--        BEFORE the push is sent (claim-then-send: a lost write can never double-send; the
--        worst case is one missed alert, the right trade on a twice-flagged WhatsApp culture).
--   * RECOVERY = alertable_down < last_alerted_down -> the baseline is lowered silently (no
--     push) so a later rise re-alerts.
--   * ONE collapsed push per technician per run, however many of his stations rose. The text
--     is the technician's CURRENT total across all his stations (not the delta):
--     "12 સ્ક્રીન બંધ - 3 સ્ટેશન", url /ops-home, tag ops-outage-<tech uuid>-<yyyymmddHH24 IST>.
--
-- HEAD ALERT (every ACTIVE operation_head, ONE collapsed push per run, at most one per 2 h):
--   (a) a depot WITH a technician newly crossed >= 5 alertable screens down. "Newly" means the
--       head has not already been told about this outage: ops_outage_alert_state.last_head_alert_at
--       IS NULL. That flag is cleared only when the depot is back under 5 AND the flag is older
--       than 2 h (so a quick flap never re-alerts inside the 2 h window).
--   (b) an ACTIVE depot with NO active technician (assigned_to NULL / inactive / not an
--       operation_executive) has alertable screens - once per 24 h per depot via last_alert_at.
--   The head events are CONSUMED (flags stamped) only after a head push really went out, so a
--   closed 2 h gate DEFERS them to the next run instead of losing them.
--   The 2 h gate is global: max(last_head_alert_at) over the state table. Text: Gujarati
--   "N સ્ટેશનમાં 5+ સ્ક્રીન બંધ" and/or "M સ્ટેશન પર ટેક્નિશિયન નથી (K સ્ક્રીન બંધ)",
--   url /ops-command, tag ops-head-outage-<head uuid>-<yyyymmddHH24 IST>.
--
-- SAFETY
--   * SECURITY DEFINER + pinned search_path; REVOKE ALL FROM PUBLIC, anon, authenticated;
--     GRANT service_role only (sync.js calls it with the service key; pg_cron/postgres bypass).
--   * Outside the push window it returns {skipped:'quiet-hours'} without touching anything.
--   * A global advisory lock stops two overlapping runs (cron + a manual ?run=1 sync) from
--     double-alerting: the loser returns {skipped:'busy'}.
--   * The WHOLE body is one EXCEPTION block: any failure rolls the run back (state AND queued
--     pushes) and returns {error:...} with zero counts. It never raises. Each individual push
--     is also wrapped, so one bad push does not stop the others.
--   * The state table has RLS on and NO policies (definer functions only).
--   * Never touches pay: no ops_uptime_daily / daily_performance / salary logic is read or written.
--
-- RELATION TO THE LEGACY ENGINE: ops_reconcile_offline_tickets() (supabase_ops_p2_auto_tickets.sql) opens
--   the offline tickets and used to push + WhatsApp the technician itself at ticket-open. Its push is now
--   suppressed whenever THIS function is installed (it checks to_regprocedure('public.ops_notify_outages()')),
--   and its WhatsApp / fallback push only go out inside is_push_allowed_now(). So the technician gets exactly
--   one Gujarati push per outage run from here, never two. Deploy the engine change right after this file.
--
-- FIRST RUN after activation: the state table is empty, so every depot with alertable screens is
--   a rise -> each technician gets one collapsed push and the head hears about the big ones. That
--   is the intended "here is today's picture" alert (only inside 09:00-20:59 IST).
--
-- RUN ORDER: this file (and ops_digest.sql) FIRST, then supabase_phase352_ops_alerts.sql
--   (which creates ops_outage_alert_state, the triggers and the cron jobs). Until the table
--   exists the function simply returns {error:...} - harmless.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ops_notify_outages()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
SET lock_timeout TO '3s'
AS $fn$
DECLARE
  d                 record;
  h                 record;
  v_checked         int  := 0;
  v_techs_pushed    int  := 0;
  v_head_pushed     int  := 0;
  v_stamp           text := to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYYMMDDHH24');
  v_rising          uuid[] := ARRAY[]::uuid[];     -- technicians with >=1 rising depot this run
  v_tech_scr        jsonb  := '{}'::jsonb;         -- tech id -> alertable screens, all his stations
  v_tech_stn        jsonb  := '{}'::jsonb;         -- tech id -> stations with >=1 alertable screen
  v_cross_ids       uuid[] := ARRAY[]::uuid[];     -- head event (a): depots newly >= 5
  v_notech          jsonb  := '{}'::jsonb;         -- head event (b): depot id -> alertable screens
  v_head_gate_open  boolean;
  v_head_told       boolean;
  v_uid             uuid;
  v_n_scr           int;
  v_n_stn           int;
  v_nt_stn          int  := 0;
  v_nt_scr          int  := 0;
  v_parts           text[];
  k                 text;
  val               text;
BEGIN
  -- Quiet hours: only 09:00-20:59 IST. Fail closed on NULL.
  IF NOT COALESCE(public.is_push_allowed_now(), false) THEN
    RETURN jsonb_build_object('skipped', 'quiet-hours',
                              'techs_pushed', 0, 'head_pushed', 0, 'depots_checked', 0);
  END IF;

  -- One run at a time (cron sync + a manual ?run=1 sync could overlap).
  IF NOT pg_try_advisory_xact_lock(hashtext('ops_notify_outages')) THEN
    RETURN jsonb_build_object('skipped', 'busy',
                              'techs_pushed', 0, 'head_pushed', 0, 'depots_checked', 0);
  END IF;

  -- The head's global 2 h gate (decided BEFORE the loop; the loop never changes it).
  v_head_gate_open := NOT EXISTS (
    SELECT 1 FROM public.ops_outage_alert_state
     WHERE last_head_alert_at > now() - interval '2 hours');

  FOR d IN
    SELECT dp.id                                   AS depot_id,
           dp.assigned_to                          AS tech_id,
           (tu.id IS NOT NULL)                     AS has_tech,
           c.n                                     AS alertable,
           COALESCE(s.last_alerted_down, 0)        AS prev_down,
           s.last_alert_at                         AS last_alert_at,
           s.last_head_alert_at                    AS last_head_alert_at
      FROM public.ops_depots dp
      LEFT JOIN public.users tu
             ON tu.id = dp.assigned_to
            AND tu.is_active IS TRUE
            AND tu.role = 'operation_executive'
      LEFT JOIN public.ops_outage_alert_state s ON s.depot_id = dp.id
      CROSS JOIN LATERAL (
        SELECT count(*)::int AS n
          FROM public.ops_screens sc
         WHERE sc.depot_id = dp.id
           AND sc.is_active
           AND sc.status = 'offline'
           AND COALESCE(sc.last_response_at, '-infinity'::timestamptz) < now() - interval '20 minutes'
      ) c
     WHERE dp.is_active
     ORDER BY dp.id
  LOOP
    v_checked := v_checked + 1;

    -- Head "already told" flag: cleared only when the depot is back under 5 AND the flag
    -- is older than 2 h (never inside the 2 h window - that is what keeps the global gate honest).
    v_head_told := d.last_head_alert_at IS NOT NULL;
    IF d.alertable < 5 AND v_head_told AND d.last_head_alert_at < now() - interval '2 hours' THEN
      UPDATE public.ops_outage_alert_state SET last_head_alert_at = NULL WHERE depot_id = d.depot_id;
      v_head_told := false;
    END IF;

    IF d.has_tech THEN
      -- the technician's running totals (what his collapsed push will say)
      IF d.alertable > 0 THEN
        v_tech_scr := jsonb_set(v_tech_scr, ARRAY[d.tech_id::text],
                        to_jsonb(COALESCE((v_tech_scr ->> d.tech_id::text)::int, 0) + d.alertable));
        v_tech_stn := jsonb_set(v_tech_stn, ARRAY[d.tech_id::text],
                        to_jsonb(COALESCE((v_tech_stn ->> d.tech_id::text)::int, 0) + 1));
      END IF;

      IF d.alertable > d.prev_down
         AND (d.last_alert_at IS NULL OR d.last_alert_at < now() - interval '1 hour') THEN
        -- RISE: claim the baseline now, send below
        INSERT INTO public.ops_outage_alert_state (depot_id, last_alerted_down, last_alert_at)
        VALUES (d.depot_id, d.alertable, now())
        ON CONFLICT (depot_id) DO UPDATE
           SET last_alerted_down = EXCLUDED.last_alerted_down,
               last_alert_at     = EXCLUDED.last_alert_at;
        IF NOT (d.tech_id = ANY (v_rising)) THEN
          v_rising := v_rising || d.tech_id;
        END IF;
      ELSIF d.alertable < d.prev_down THEN
        -- RECOVERY: lower the baseline silently so a later rise re-alerts
        UPDATE public.ops_outage_alert_state
           SET last_alerted_down = d.alertable
         WHERE depot_id = d.depot_id;
      END IF;

      -- head event (a): newly crossed >= 5 and the head has not been told about this outage
      IF d.alertable >= 5 AND NOT v_head_told THEN
        v_cross_ids := v_cross_ids || d.depot_id;
      END IF;

    ELSE
      -- no active technician: head event (b), once per 24 h per depot
      IF d.alertable > 0 AND (d.last_alert_at IS NULL OR d.last_alert_at < now() - interval '24 hours') THEN
        v_notech := v_notech || jsonb_build_object(d.depot_id::text, d.alertable);
      ELSIF d.alertable < d.prev_down THEN
        UPDATE public.ops_outage_alert_state
           SET last_alerted_down = d.alertable
         WHERE depot_id = d.depot_id;
      END IF;
    END IF;
  END LOOP;

  -- ── ONE collapsed push per technician ─────────────────────────────────────────
  FOREACH v_uid IN ARRAY v_rising LOOP
    v_n_scr := COALESCE((v_tech_scr ->> v_uid::text)::int, 0);
    v_n_stn := COALESCE((v_tech_stn ->> v_uid::text)::int, 0);
    BEGIN
      PERFORM public.enqueue_push(
        v_uid,
        'સ્ક્રીન બંધ',
        format('%s સ્ક્રીન બંધ - %s સ્ટેશન', v_n_scr, v_n_stn),
        '/ops-home',
        'ops-outage-' || v_uid::text || '-' || v_stamp);
      v_techs_pushed := v_techs_pushed + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'ops_notify_outages: tech push failed for %: %', v_uid, SQLERRM;
    END;
  END LOOP;

  -- ── ONE collapsed push per head, at most one per 2 h ──────────────────────────
  IF v_head_gate_open
     AND (cardinality(v_cross_ids) > 0 OR v_notech <> '{}'::jsonb) THEN
    v_parts := ARRAY[]::text[];
    IF cardinality(v_cross_ids) > 0 THEN
      v_parts := v_parts || format('%s સ્ટેશનમાં 5+ સ્ક્રીન બંધ', cardinality(v_cross_ids));
    END IF;
    IF v_notech <> '{}'::jsonb THEN
      SELECT count(*)::int, COALESCE(sum(e.value::int), 0)::int
        INTO v_nt_stn, v_nt_scr
        FROM jsonb_each_text(v_notech) e;
      v_parts := v_parts || format('%s સ્ટેશન પર ટેક્નિશિયન નથી (%s સ્ક્રીન બંધ)', v_nt_stn, v_nt_scr);
    END IF;

    FOR h IN
      SELECT u.id FROM public.users u
       WHERE u.role = 'operation_head' AND u.is_active IS TRUE
       ORDER BY u.id
    LOOP
      BEGIN
        PERFORM public.enqueue_push(
          h.id,
          'નેટવર્ક ચેતવણી',
          array_to_string(v_parts, ' | '),
          '/ops-command',
          'ops-head-outage-' || h.id::text || '-' || v_stamp);
        v_head_pushed := v_head_pushed + 1;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'ops_notify_outages: head push failed for %: %', h.id, SQLERRM;
      END;
    END LOOP;

    -- consume the head events ONLY if a head push really went out
    IF v_head_pushed > 0 THEN
      IF cardinality(v_cross_ids) > 0 THEN
        INSERT INTO public.ops_outage_alert_state (depot_id, last_head_alert_at)
        SELECT x, now() FROM unnest(v_cross_ids) AS x
        ON CONFLICT (depot_id) DO UPDATE SET last_head_alert_at = EXCLUDED.last_head_alert_at;
      END IF;
      FOR k, val IN SELECT e.key, e.value FROM jsonb_each_text(v_notech) e LOOP
        INSERT INTO public.ops_outage_alert_state
               (depot_id, last_alerted_down, last_alert_at, last_head_alert_at)
        VALUES (k::uuid, val::int, now(), now())
        ON CONFLICT (depot_id) DO UPDATE
           SET last_alerted_down  = EXCLUDED.last_alerted_down,
               last_alert_at      = EXCLUDED.last_alert_at,
               last_head_alert_at = EXCLUDED.last_head_alert_at;
      END LOOP;
    END IF;
  END IF;

  RETURN jsonb_build_object('techs_pushed',   v_techs_pushed,
                            'head_pushed',    v_head_pushed,
                            'depots_checked', v_checked);
EXCEPTION WHEN OTHERS THEN
  -- never break the sync: the whole run rolls back and we report quietly
  RETURN jsonb_build_object('error', SQLERRM,
                            'techs_pushed', 0, 'head_pushed', 0, 'depots_checked', 0);
END
$fn$;

REVOKE ALL     ON FUNCTION public.ops_notify_outages() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ops_notify_outages() TO service_role;

NOTIFY pgrst, 'reload schema';

-- ===== VERIFY / TRIPWIRE (read-only; every column must be TRUE) =====
-- SELECT
--   (SELECT prosecdef FROM pg_proc WHERE proname = 'ops_notify_outages' AND pronamespace = 'public'::regnamespace) AS is_definer,
--   (SELECT pg_get_functiondef(p.oid) LIKE '%EXCEPTION WHEN OTHERS%'
--      FROM pg_proc p WHERE proname = 'ops_notify_outages' AND pronamespace = 'public'::regnamespace) AS never_raises,
--   (SELECT pg_get_functiondef(p.oid) LIKE '%is_push_allowed_now%'
--      FROM pg_proc p WHERE proname = 'ops_notify_outages' AND pronamespace = 'public'::regnamespace) AS quiet_hours_gated,
--   (SELECT pg_get_functiondef(p.oid) LIKE '%interval ''20 minutes''%'
--      FROM pg_proc p WHERE proname = 'ops_notify_outages' AND pronamespace = 'public'::regnamespace) AS debounce_20m,
--   NOT has_function_privilege('anon',          'public.ops_notify_outages()', 'EXECUTE') AS anon_locked,
--   NOT has_function_privilege('authenticated', 'public.ops_notify_outages()', 'EXECUTE') AS authenticated_locked,
--   has_function_privilege('service_role',      'public.ops_notify_outages()', 'EXECUTE') AS service_role_can_run;
