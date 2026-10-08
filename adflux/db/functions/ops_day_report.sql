-- ============================================================================
-- db/functions/ops_day_report.sql  -  THE CANONICAL HOME (section 71: ONE definition)
-- ============================================================================
-- Operations EVENING / DAY REPORT.  Three read-only functions, one file:
--
--   ops_tech_day_block(p_user uuid, p_day date)   INTERNAL helper. The ONE place a
--       technician's day is computed. Never callable by a client.
--   ops_my_day_report(p_day date DEFAULT NULL)    a technician's OWN report.
--   ops_head_day_report(p_day date DEFAULT NULL)  the team report for the operation
--       head / admin / co_owner.
--
-- WHY: the technician and the head both want a plain "how did the day go" card they
--   can also share on WhatsApp. The head's list is the same numbers as each
--   technician's own card, so both go through ONE helper - the two views cannot
--   drift apart (section 71 rule 1).
--
-- WHAT THE REPORT SHOWS (and does NOT):
--   check-in time, km travelled, screen uptime (today + month so far), live offline
--   and camera-off counts with the worst stations, tickets (logged / fixed / in
--   progress / alerts / open / older than 48 h), calls to depot contacts, and for
--   the head a "needs your attention" list.
--   NO salary, NO rupees, NO pay anywhere. This file never calls or edits
--   compute_monthly_salary / monthly_score / compute_daily_score / the ops uptime pay
--   trigger / compute_daily_ta; it only READS. All three functions are STABLE, so
--   Postgres itself refuses any write from inside them.
--
-- RETURN CONTRACT (jsonb; the screen codes to exactly this)
--   Denied, no login, or wrong role  ->  '{}'::jsonb   (the screen treats a missing
--   "ok" as denied). Success always has "ok": true.
--
--   ops_my_day_report ->
--     { ok, day 'YYYY-MM-DD', as_of 'HH24:MI' (IST now), closed bool, is_today bool,
--       tech {id,name}, checkin {at 'HH24:MI'|null}, km num (1 dp, 0 when no row),
--       uptime {up,total,pct|null,month_pct|null},
--       faults {offline,camera_off,stations[{depot_id,name,offline,oldest_hours}]},
--       tickets {logged,fixed,in_progress,alerts,open,oldest_open_days|null,over_48h},
--       calls {depot_total,depot_answered} }
--   ops_head_day_report ->
--     { ok, day, as_of, closed, is_today,
--       network {up,total,pct|null,down,camera_off},
--       techs[{id,name,checkin_at,uptime_pct,month_pct,offline,camera_off,logged,fixed,
--              open,over_48h,depot_calls,depot_answered,km}]   (worst uptime first,
--              nulls last, then name),
--       needs {not_checked_in[name],faults_no_calls[name],push_missing[name],
--              no_whatsapp[name],pending_leave,pending_ta,over_48h_total},
--       worst_stations[{depot_id,name,offline,oldest_hours}] (top 5),
--       totals {km,depot_calls,fixed} }
--
-- RULES BAKED IN (BLOCK on regress)
--   * IST day window: [(D::timestamp AT TIME ZONE 'Asia/Kolkata'), ((D+1)::timestamp
--     AT TIME ZONE 'Asia/Kolkata')). D defaults to today in IST and is clamped to
--     [today-7, today]. Never ::date on a timestamptz.
--   * Operating window 07:00-21:00 IST (src/utils/opsHours.js isOnHours, supabase_ops_p4
--     uptime night-gate, supabase_ops_p10 camera gate). Outside it - and for any PAST
--     day - the screens are timer-off or the snapshot is not that day's, so every LIVE
--     screen figure is withheld: closed = true, faults.offline / camera_off = null,
--     faults.stations = [], network.up / down / camera_off / pct = null,
--     worst_stations = []. Uptime % is NOT live: ops_uptime_daily keeps its last
--     on-hours value overnight, so the day's uptime still reads correctly when closed.
--     "closed" is the screen's single switch (the extra key is_today lets it tell a
--     night view from a past-day view).
--   * Uptime-% total counts only screens that reported online/offline ('unknown' is
--     excluded, same as the pay table). network.total follows the same rule.
--   * Fixed = status IN ('resolved','approved') AND resolved_at in the day. Never
--     resolved_at alone: cancelled rows carry a resolved_at too.
--   * Depot calls = outgoing calls whose number matches a depot contact on the last
--     10 digits, via EXISTS (a JOIN would double count the 3 numbers shared by two
--     depots). A number with fewer than 10 digits never matches (an empty string would
--     otherwise match every empty contact). Answered = duration_seconds > 0; the
--     outcome column is NOT used.
--   * Pending leave / TA counts use the exact boundary of ops_pending_approvals():
--     the request must belong to an ACTIVE operation_executive.
--   * Fail-closed on a NULL role / NULL uid (section 41): IS NULL OR NOT IN.
--   * over_48h_total is every open / in-progress ticket in the network older than 48
--     hours, whoever holds it (an unassigned one still needs the head).
--   * closed / the 07-21 window is repeated ONCE more in ops_head_day_report (the
--     network block). Keep opsHours.js, ops_uptime p4, p10 and these two in step.
--
-- SECURITY
--   All three: SECURITY DEFINER, search_path pinned to public, pg_temp, STABLE.
--   Helper: REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT to service_role only.
--     The two public functions reach it because a SECURITY DEFINER function runs as its
--     owner (same pattern as enqueue_push, section 41 / Phase 97.A2).
--   Public two: REVOKE ALL FROM PUBLIC, anon; GRANT EXECUTE TO authenticated.
--     ops_my_day_report -> operation_executive only (own data, auth.uid()).
--     ops_head_day_report -> admin / co_owner / operation_head only.
--   A tripwire at the bottom RAISES if the grants are ever wrong, and the VERIFY block
--   can be run read-only at any time.
--
-- ROLLBACK (nothing depends on these, they only read):
--   DROP FUNCTION IF EXISTS public.ops_head_day_report(date);
--   DROP FUNCTION IF EXISTS public.ops_my_day_report(date);
--   DROP FUNCTION IF EXISTS public.ops_tech_day_block(uuid, date);
--
-- Idempotent: CREATE OR REPLACE + REVOKE / GRANT. Re-runnable.
-- ============================================================================


-- ============================================================================
-- 1 . ops_tech_day_block  -  INTERNAL: one technician, one day
-- ============================================================================
CREATE OR REPLACE FUNCTION public.ops_tech_day_block(p_user uuid, p_day date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $fn$
DECLARE
  v_now_ist   timestamp := (now() AT TIME ZONE 'Asia/Kolkata');
  v_today     date      := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_hour      int       := extract(hour FROM (now() AT TIME ZONE 'Asia/Kolkata'))::int;
  v_day       date;
  v_closed    boolean;
  v_from      timestamptz;
  v_to        timestamptz;
  v_mstart    date;
  v_name      text;
  v_checkin   timestamptz;
  v_km        numeric;
  v_up        int;
  v_total     int;
  v_pct       numeric;
  v_mpct      numeric;
  v_off       int;
  v_cam       int;
  v_stations  jsonb := '[]'::jsonb;
  v_logged    int;
  v_fixed     int;
  v_inprog    int;
  v_alerts    int;
  v_open      int;
  v_min_open  timestamptz;
  v_oldest    int;
  v_o48       int;
  v_ctot      int;
  v_cans      int;
BEGIN
  -- Clamp the day to [today-7, today] (IST). NULL = today.
  v_day    := GREATEST(v_today - 7, LEAST(COALESCE(p_day, v_today), v_today));
  -- Live screen figures are only true for TODAY, inside the 07:00-21:00 IST window.
  v_closed := (v_hour < 7 OR v_hour >= 21 OR v_day < v_today);
  v_from   := (v_day::timestamp AT TIME ZONE 'Asia/Kolkata');
  v_to     := ((v_day + 1)::timestamp AT TIME ZONE 'Asia/Kolkata');
  v_mstart := v_day - (extract(day FROM v_day)::int - 1);   -- first of that month

  SELECT u.name INTO v_name FROM public.users u WHERE u.id = p_user;
  IF NOT FOUND THEN
    RETURN '{}'::jsonb;
  END IF;

  -- check-in (work_sessions: one row per user per day)
  SELECT min(ws.check_in_at) INTO v_checkin
    FROM public.work_sessions ws
   WHERE ws.user_id = p_user AND ws.work_date = v_day;

  -- km travelled that day
  SELECT COALESCE(round(sum(ta.km_traveled), 1), 0) INTO v_km
    FROM public.daily_ta ta
   WHERE ta.user_id = p_user AND ta.ta_date = v_day;

  -- uptime: that day's row (last on-hours snapshot) + month so far
  SELECT o.screens_up, o.screens_total,
         CASE WHEN o.screens_total > 0 THEN round(o.uptime_pct, 1) END
    INTO v_up, v_total, v_pct
    FROM public.ops_uptime_daily o
   WHERE o.user_id = p_user AND o.work_date = v_day;
  v_up    := COALESCE(v_up, 0);
  v_total := COALESCE(v_total, 0);

  SELECT round(avg(o.uptime_pct), 1) INTO v_mpct
    FROM public.ops_uptime_daily o
   WHERE o.user_id = p_user AND o.work_date >= v_mstart AND o.work_date <= v_day
     AND o.screens_total > 0;

  -- LIVE faults at the technician's own active stations (withheld when closed)
  IF NOT v_closed THEN
    SELECT count(*) FILTER (WHERE s.status = 'offline'),
           count(*) FILTER (WHERE s.status = 'online' AND s.camera_active = false)
      INTO v_off, v_cam
      FROM public.ops_depots d
      JOIN public.ops_screens s ON s.depot_id = d.id AND s.is_active
     WHERE d.assigned_to = p_user AND d.is_active;

    -- worst 3 stations: most offline screens first, then the longest outage
    -- (a screen that never reported counts as 9999 hours, same as opsHours.js)
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'depot_id', x.id, 'name', x.name, 'offline', x.n_off, 'oldest_hours', x.age_h)
             ORDER BY x.n_off DESC, x.age_h DESC, x.name, x.id), '[]'::jsonb)
      INTO v_stations
      FROM (
        SELECT d.id, d.name,
               count(*)::int AS n_off,
               max(CASE WHEN s.last_response_at IS NULL THEN 9999
                        ELSE GREATEST(0, floor(extract(epoch FROM (now() - s.last_response_at)) / 3600))::int
                   END) AS age_h
          FROM public.ops_depots d
          JOIN public.ops_screens s ON s.depot_id = d.id AND s.is_active AND s.status = 'offline'
         WHERE d.assigned_to = p_user AND d.is_active
         GROUP BY d.id, d.name
         ORDER BY n_off DESC, age_h DESC, d.name
         LIMIT 3
      ) x;
  END IF;

  -- tickets held by this technician
  SELECT count(*) FILTER (WHERE t.source = 'manual'
                            AND t.created_at >= v_from AND t.created_at < v_to),
         count(*) FILTER (WHERE t.status IN ('resolved', 'approved')
                            AND t.resolved_at >= v_from AND t.resolved_at < v_to),
         count(*) FILTER (WHERE t.status = 'in_progress'),
         count(*) FILTER (WHERE t.source <> 'manual'
                            AND t.opened_at >= v_from AND t.opened_at < v_to),
         count(*) FILTER (WHERE t.status IN ('open', 'in_progress')),
         min(t.opened_at) FILTER (WHERE t.status IN ('open', 'in_progress')),
         count(*) FILTER (WHERE t.status IN ('open', 'in_progress')
                            AND t.opened_at < now() - interval '48 hours')
    INTO v_logged, v_fixed, v_inprog, v_alerts, v_open, v_min_open, v_o48
    FROM public.ops_tickets t
   WHERE t.assigned_to = p_user;
  v_oldest := CASE WHEN v_min_open IS NULL THEN NULL
                   ELSE GREATEST(0, floor(extract(epoch FROM (now() - v_min_open)) / 86400))::int END;

  -- calls to depot contacts (EXISTS semi-join: never a JOIN)
  SELECT count(*), count(*) FILTER (WHERE c.duration_seconds > 0)
    INTO v_ctot, v_cans
    FROM public.call_logs c
   WHERE c.user_id = p_user
     AND c.direction = 'outgoing'
     AND c.call_at >= v_from AND c.call_at < v_to
     AND length(regexp_replace(COALESCE(c.client_phone, ''), '\D', '', 'g')) >= 10
     AND EXISTS (
           SELECT 1 FROM public.ops_depot_contacts dc
            WHERE length(regexp_replace(COALESCE(dc.phone, ''), '\D', '', 'g')) >= 10
              AND right(regexp_replace(dc.phone, '\D', '', 'g'), 10)
                = right(regexp_replace(c.client_phone, '\D', '', 'g'), 10));

  RETURN jsonb_build_object(
    'ok',       true,
    'day',      v_day,
    'as_of',    to_char(v_now_ist, 'HH24:MI'),
    'closed',   v_closed,
    'is_today', (v_day = v_today),
    'tech',     jsonb_build_object('id', p_user, 'name', v_name),
    'checkin',  jsonb_build_object('at', to_char(v_checkin AT TIME ZONE 'Asia/Kolkata', 'HH24:MI')),
    'km',       v_km,
    'uptime',   jsonb_build_object('up', v_up, 'total', v_total, 'pct', v_pct, 'month_pct', v_mpct),
    'faults',   jsonb_build_object('offline', v_off, 'camera_off', v_cam, 'stations', v_stations),
    'tickets',  jsonb_build_object(
                  'logged', v_logged, 'fixed', v_fixed, 'in_progress', v_inprog,
                  'alerts', v_alerts, 'open', v_open, 'oldest_open_days', v_oldest,
                  'over_48h', v_o48),
    'calls',    jsonb_build_object('depot_total', v_ctot, 'depot_answered', v_cans)
  );
END
$fn$;

REVOKE ALL     ON FUNCTION public.ops_tech_day_block(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ops_tech_day_block(uuid, date) TO service_role;


-- ============================================================================
-- 2 . ops_my_day_report  -  a technician's own report
-- ============================================================================
CREATE OR REPLACE FUNCTION public.ops_my_day_report(p_day date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $fn$
DECLARE
  v_uid   uuid := auth.uid();
  v_role  text;
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_day   date;
BEGIN
  -- fail-closed (section 41): no login, no role, or any role but a field technician
  IF v_uid IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;
  v_role := public.get_my_role();
  IF v_role IS NULL OR v_role <> 'operation_executive' THEN
    RETURN '{}'::jsonb;
  END IF;

  v_day := GREATEST(v_today - 7, LEAST(COALESCE(p_day, v_today), v_today));
  RETURN public.ops_tech_day_block(v_uid, v_day);
END
$fn$;

REVOKE ALL     ON FUNCTION public.ops_my_day_report(date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.ops_my_day_report(date) TO authenticated;


-- ============================================================================
-- 3 . ops_head_day_report  -  the team report (head / admin / co_owner)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.ops_head_day_report(p_day date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $fn$
DECLARE
  v_role      text;
  v_now_ist   timestamp := (now() AT TIME ZONE 'Asia/Kolkata');
  v_today     date      := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_hour      int       := extract(hour FROM (now() AT TIME ZONE 'Asia/Kolkata'))::int;
  v_day       date;
  v_closed    boolean;
  v_blocks    jsonb;
  v_net_up    int;
  v_net_down  int;
  v_net_cam   int;
  v_techs     jsonb;
  v_lists     jsonb;
  v_worst     jsonb := '[]'::jsonb;
  v_totals    jsonb;
  v_p_leave   int;
  v_p_ta      int;
  v_o48_all   int;
BEGIN
  -- fail-closed (section 41): no login / no role / not an ops manager
  IF auth.uid() IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;
  v_role := public.get_my_role();
  IF v_role IS NULL OR v_role NOT IN ('admin', 'co_owner', 'operation_head') THEN
    RETURN '{}'::jsonb;
  END IF;

  v_day    := GREATEST(v_today - 7, LEAST(COALESCE(p_day, v_today), v_today));
  v_closed := (v_hour < 7 OR v_hour >= 21 OR v_day < v_today);   -- same rule as the helper

  -- One block per ACTIVE field technician, all from the SAME helper as ops_my_day_report.
  SELECT COALESCE(jsonb_agg(public.ops_tech_day_block(u.id, v_day) ORDER BY u.name, u.id), '[]'::jsonb)
    INTO v_blocks
    FROM public.users u
   WHERE u.role = 'operation_executive' AND u.is_active;

  -- network snapshot: LIVE, every active screen (withheld when closed)
  SELECT count(*) FILTER (WHERE s.status = 'online'),
         count(*) FILTER (WHERE s.status = 'offline'),
         count(*) FILTER (WHERE s.status = 'online' AND s.camera_active = false)
    INTO v_net_up, v_net_down, v_net_cam
    FROM public.ops_screens s
   WHERE s.is_active;

  IF NOT v_closed THEN
    -- worst 5 stations network-wide: most offline first, then the longest outage
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'depot_id', x.id, 'name', x.name, 'offline', x.n_off, 'oldest_hours', x.age_h)
             ORDER BY x.n_off DESC, x.age_h DESC, x.name, x.id), '[]'::jsonb)
      INTO v_worst
      FROM (
        SELECT d.id, d.name,
               count(*)::int AS n_off,
               max(CASE WHEN s.last_response_at IS NULL THEN 9999
                        ELSE GREATEST(0, floor(extract(epoch FROM (now() - s.last_response_at)) / 3600))::int
                   END) AS age_h
          FROM public.ops_depots d
          JOIN public.ops_screens s ON s.depot_id = d.id AND s.is_active AND s.status = 'offline'
         WHERE d.is_active
         GROUP BY d.id, d.name
         ORDER BY n_off DESC, age_h DESC, d.name
         LIMIT 5
      ) x;
  END IF;

  -- techs[]: flat rows, worst uptime first (nulls last), then name
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id',             e.b #>> '{tech,id}',
           'name',           e.b #>> '{tech,name}',
           'checkin_at',     e.b #>> '{checkin,at}',
           'uptime_pct',     (e.b #>> '{uptime,pct}')::numeric,
           'month_pct',      (e.b #>> '{uptime,month_pct}')::numeric,
           'offline',        (e.b #>> '{faults,offline}')::int,
           'camera_off',     (e.b #>> '{faults,camera_off}')::int,
           'logged',         (e.b #>> '{tickets,logged}')::int,
           'fixed',          (e.b #>> '{tickets,fixed}')::int,
           'open',           (e.b #>> '{tickets,open}')::int,
           'over_48h',       (e.b #>> '{tickets,over_48h}')::int,
           'depot_calls',    (e.b #>> '{calls,depot_total}')::int,
           'depot_answered', (e.b #>> '{calls,depot_answered}')::int,
           'km',             (e.b ->> 'km')::numeric
         ) ORDER BY (e.b #>> '{uptime,pct}')::numeric ASC NULLS LAST,
                    (e.b #>> '{tech,name}'), (e.b #>> '{tech,id}')), '[]'::jsonb)
    INTO v_techs
    FROM jsonb_array_elements(v_blocks) AS e(b);

  -- needs: who to chase. Names only, never a number that looks like pay.
  SELECT jsonb_build_object(
           'not_checked_in',  COALESCE(jsonb_agg(x.name ORDER BY x.name) FILTER (WHERE x.checkin IS NULL), '[]'::jsonb),
           'faults_no_calls', COALESCE(jsonb_agg(x.name ORDER BY x.name) FILTER (WHERE COALESCE(x.n_off, 0) > 0 AND x.dcalls = 0), '[]'::jsonb),
           'push_missing',    COALESCE(jsonb_agg(x.name ORDER BY x.name) FILTER (WHERE NOT x.has_push), '[]'::jsonb),
           'no_whatsapp',     COALESCE(jsonb_agg(x.name ORDER BY x.name) FILTER (WHERE x.wa_digits < 10), '[]'::jsonb))
    INTO v_lists
    FROM (
      SELECT (e.b #>> '{tech,name}')              AS name,
             (e.b #>> '{checkin,at}')             AS checkin,
             (e.b #>> '{faults,offline}')::int    AS n_off,
             (e.b #>> '{calls,depot_total}')::int AS dcalls,
             EXISTS (SELECT 1 FROM public.push_subscriptions ps
                      WHERE ps.user_id = (e.b #>> '{tech,id}')::uuid) AS has_push,
             length(regexp_replace(COALESCE(u.whatsapp_number, ''), '\D', '', 'g')) AS wa_digits
        FROM jsonb_array_elements(v_blocks) AS e(b)
        JOIN public.users u ON u.id = (e.b #>> '{tech,id}')::uuid
    ) x;

  -- approvals waiting: the exact boundary of ops_pending_approvals()
  SELECT count(*) INTO v_p_leave
    FROM public.leaves l
    JOIN public.users u ON u.id = l.user_id AND u.role = 'operation_executive' AND u.is_active
   WHERE l.status = 'pending';
  SELECT count(*) INTO v_p_ta
    FROM public.ta_da_requests t
    JOIN public.users u ON u.id = t.user_id AND u.role = 'operation_executive' AND u.is_active
   WHERE t.status = 'pending';

  -- every open / in-progress ticket older than 48 h, whoever holds it
  SELECT count(*) INTO v_o48_all
    FROM public.ops_tickets t
   WHERE t.status IN ('open', 'in_progress')
     AND t.opened_at < now() - interval '48 hours';

  SELECT jsonb_build_object(
           'km',          COALESCE(round(sum((e.b ->> 'km')::numeric), 1), 0),
           'depot_calls', COALESCE(sum((e.b #>> '{calls,depot_total}')::int), 0)::int,
           'fixed',       COALESCE(sum((e.b #>> '{tickets,fixed}')::int), 0)::int)
    INTO v_totals
    FROM jsonb_array_elements(v_blocks) AS e(b);

  RETURN jsonb_build_object(
    'ok',       true,
    'day',      v_day,
    'as_of',    to_char(v_now_ist, 'HH24:MI'),
    'closed',   v_closed,
    'is_today', (v_day = v_today),
    'network',  jsonb_build_object(
                  'up',         CASE WHEN v_closed THEN NULL ELSE v_net_up END,
                  'total',      v_net_up + v_net_down,
                  'pct',        CASE WHEN v_closed OR (v_net_up + v_net_down) = 0 THEN NULL
                                     ELSE round(v_net_up::numeric / (v_net_up + v_net_down) * 100, 1) END,
                  'down',       CASE WHEN v_closed THEN NULL ELSE v_net_down END,
                  'camera_off', CASE WHEN v_closed THEN NULL ELSE v_net_cam END),
    'techs',    v_techs,
    'needs',    v_lists || jsonb_build_object(
                  'pending_leave', v_p_leave, 'pending_ta', v_p_ta, 'over_48h_total', v_o48_all),
    'worst_stations', v_worst,
    'totals',   v_totals
  );
END
$fn$;

REVOKE ALL     ON FUNCTION public.ops_head_day_report(date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.ops_head_day_report(date) TO authenticated;


-- ============================================================================
-- 4 . TRIPWIRE (runs on every apply; RAISES if the lock-down is ever wrong)
-- ============================================================================
DO $trip$
BEGIN
  IF to_regprocedure('public.ops_tech_day_block(uuid,date)') IS NULL
     OR to_regprocedure('public.ops_my_day_report(date)') IS NULL
     OR to_regprocedure('public.ops_head_day_report(date)') IS NULL THEN
    RAISE EXCEPTION 'ops_day_report tripwire: a function is missing';
  END IF;
  IF has_function_privilege('anon',          'public.ops_tech_day_block(uuid,date)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.ops_tech_day_block(uuid,date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ops_day_report tripwire: the internal helper is callable by a client role';
  END IF;
  IF has_function_privilege('anon', 'public.ops_my_day_report(date)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.ops_head_day_report(date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ops_day_report tripwire: anon can call a report function';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.ops_my_day_report(date)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.ops_head_day_report(date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ops_day_report tripwire: authenticated cannot call a report function';
  END IF;
END
$trip$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY (read-only; every column must be TRUE). Run any time.
-- ============================================================================
-- SELECT
--   to_regprocedure('public.ops_tech_day_block(uuid,date)')  IS NOT NULL                AS helper_present,
--   to_regprocedure('public.ops_my_day_report(date)')        IS NOT NULL                AS my_present,
--   to_regprocedure('public.ops_head_day_report(date)')      IS NOT NULL                AS head_present,
--   (SELECT bool_and(p.prosecdef AND p.provolatile = 's'
--                    AND p.proconfig::text LIKE '%search_path=public, pg_temp%')
--      FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
--       AND p.proname IN ('ops_tech_day_block','ops_my_day_report','ops_head_day_report'))
--                                                                                         AS definer_stable_pinned,
--   NOT has_function_privilege('anon',          'public.ops_tech_day_block(uuid,date)', 'EXECUTE') AS helper_not_anon,
--   NOT has_function_privilege('authenticated', 'public.ops_tech_day_block(uuid,date)', 'EXECUTE') AS helper_not_authenticated,
--   has_function_privilege('service_role',      'public.ops_tech_day_block(uuid,date)', 'EXECUTE') AS helper_service_role,
--   NOT has_function_privilege('anon',          'public.ops_my_day_report(date)',   'EXECUTE')     AS my_not_anon,
--   has_function_privilege('authenticated',     'public.ops_my_day_report(date)',   'EXECUTE')     AS my_authenticated,
--   NOT has_function_privilege('anon',          'public.ops_head_day_report(date)', 'EXECUTE')     AS head_not_anon,
--   has_function_privilege('authenticated',     'public.ops_head_day_report(date)', 'EXECUTE')     AS head_authenticated,
--   (SELECT pg_get_functiondef('public.ops_my_day_report(date)'::regprocedure)   LIKE '%v_role IS NULL OR v_role <> ''operation_executive''%')   AS my_fail_closed,
--   (SELECT pg_get_functiondef('public.ops_head_day_report(date)'::regprocedure) LIKE '%v_role IS NULL OR v_role NOT IN (''admin'', ''co_owner'', ''operation_head'')%') AS head_fail_closed,
--   (SELECT pg_get_functiondef('public.ops_tech_day_block(uuid,date)'::regprocedure) LIKE '%status IN (''resolved'', ''approved'')%') AS fixed_needs_status,
--   (SELECT pg_get_functiondef('public.ops_tech_day_block(uuid,date)'::regprocedure) LIKE '%EXISTS (%ops_depot_contacts%')              AS calls_use_exists;
--
-- As a real user (SET LOCAL ROLE authenticated + request.jwt.claims sub), expect:
--   technician : SELECT public.ops_my_day_report();     -> {"ok": true, ...}
--   technician : SELECT public.ops_head_day_report();   -> {}
--   head/admin : SELECT public.ops_head_day_report();   -> {"ok": true, ...}
--   head/admin : SELECT public.ops_my_day_report();     -> {}
--   no login   : either function                        -> {}
--   p_day = today+3 or today-30 is clamped to today / today-7.
-- ============================================================================
