-- ============================================================================
-- db/diagnostics/ops_day_report_dryrun.sql  -  ROLLBACK-ONLY dry-run harness
-- ============================================================================
-- Proves db/functions/ops_day_report.sql on the LIVE database WITHOUT keeping
-- anything: the three functions are created inside a transaction, exercised as
-- real users, and the last statement is a RAISE EXCEPTION so the whole thing
-- rolls back. No file in this repo may add a COMMIT to this harness.
--
-- STATUS: written 2026-10-08 but NOT YET EXECUTED - the Supabase CLI on this Mac
--   was being killed on launch (exit 137: "invalid signature (code or signature
--   have been modified)"), so no live SQL could be run. Treat every claim below
--   as unproven until the output has been read.
--
-- RUN (from the adflux folder, once `supabase --version` prints a version):
--   S=<any scratch dir>
--   { echo 'BEGIN;'; cat db/functions/ops_day_report.sql; \
--     cat db/diagnostics/ops_day_report_dryrun.sql; } > "$S/ops_day_report_dryrun_full.sql"
--   supabase db query --linked -f "$S/ops_day_report_dryrun_full.sql"
--   -> the CLI prints a Go stack then an 'unexpected status 400' message. The
--      real text is the SQL error:  DRYRUN REPORT >> ...   (read that).
--
-- THEN re-check live is unchanged (all three must be true):
--   SELECT to_regprocedure('public.ops_tech_day_block(uuid,date)') IS NULL AS helper_absent,
--          to_regprocedure('public.ops_my_day_report(date)')       IS NULL AS my_absent,
--          to_regprocedure('public.ops_head_day_report(date)')     IS NULL AS head_absent;
--
-- TIME OF DAY MATTERS: between 07:00 and 21:00 IST the live fault numbers
--   (offline / camera_off / stations / network) are populated and compared.
--   Outside that window the report is "closed" and those fields are NULL by
--   design, so that branch is exercised instead (the harness says which).
--
-- Ids are resolved BEFORE the role switch: under RLS a technician cannot read
-- other users, so a lookup after SET ROLE would silently return NULL.
-- ============================================================================

DO $dry$
DECLARE
  c_gohil   constant uuid := 'd40f1d1e-94d4-46a6-9182-23875a5e7998';  -- GOHIL ANKITKUMAR (exec)
  c_gulshan constant uuid := '6ffec358-0284-4936-bd06-4ed9c1ecb947';  -- Gulshan (exec)
  c_dixita  constant uuid := 'caa6236a-844b-4097-8d93-f71d9b28ffae';  -- Dixita (operation_head)

  v_today      date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_admin      uuid;  v_admin_name text;
  v_rep        uuid;  v_rep_name   text;

  j_gohil jsonb;   j_gulshan jsonb;   j_dixita jsonb;   j_admin_head jsonb;
  j_admin_my jsonb;  j_rep_my jsonb;  j_rep_head jsonb;
  j_nojwt_my jsonb;  j_nojwt_head jsonb;  j_exec_head jsonb;  j_head_my jsonb;
  j_fut jsonb;  j_old jsonb;

  t_helper text;  t_anon_my text;  t_anon_head text;

  x_km numeric;  x_off int;  x_tot int;  x_ans int;
  x_up int;  x_down int;  x_cam int;  x_sumkm numeric;  x_nexec int;
  x_pl int;  x_pta int;

  m text := '';
BEGIN
  -- ---- 0. resolve ids as the CLI role (can read everything) -----------------
  SELECT id, name INTO v_admin, v_admin_name
    FROM public.users WHERE role = 'admin' AND is_active ORDER BY created_at LIMIT 1;
  SELECT id, name INTO v_rep, v_rep_name
    FROM public.users WHERE role IN ('sales', 'telecaller') AND is_active
   ORDER BY (name ILIKE 'dhara%') DESC, created_at LIMIT 1;

  m := m || format(E'now (IST) date=%s  | admin=%s  | non-ops rep=%s\n', v_today, v_admin_name, v_rep_name);

  -- ---- 1. technician own report (two real technicians) ----------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_gohil::text, 'role', 'authenticated')::text, true),
          set_config('request.jwt.claim.sub', c_gohil::text, true);
  SET LOCAL ROLE authenticated;
  j_gohil := public.ops_my_day_report();
  j_fut   := public.ops_my_day_report(v_today + 3);    -- clamp: future
  j_old   := public.ops_my_day_report(v_today - 30);   -- clamp: too old
  j_exec_head := public.ops_head_day_report();         -- exec calling head: must be {}
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_gulshan::text, 'role', 'authenticated')::text, true),
          set_config('request.jwt.claim.sub', c_gulshan::text, true);
  SET LOCAL ROLE authenticated;
  j_gulshan := public.ops_my_day_report();
  RESET ROLE;

  -- ---- 2. head + admin team report; head/admin calling the tech report -------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_dixita::text, 'role', 'authenticated')::text, true),
          set_config('request.jwt.claim.sub', c_dixita::text, true);
  SET LOCAL ROLE authenticated;
  j_dixita  := public.ops_head_day_report();
  j_head_my := public.ops_my_day_report();             -- head calling tech report: must be {}
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true),
          set_config('request.jwt.claim.sub', v_admin::text, true);
  SET LOCAL ROLE authenticated;
  j_admin_head := public.ops_head_day_report();
  j_admin_my   := public.ops_my_day_report();          -- admin calling tech report: must be {}
  RESET ROLE;

  -- ---- 3. a sales/telecaller rep calling both: must be {} -------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rep::text, 'role', 'authenticated')::text, true),
          set_config('request.jwt.claim.sub', v_rep::text, true);
  SET LOCAL ROLE authenticated;
  j_rep_my   := public.ops_my_day_report();
  j_rep_head := public.ops_head_day_report();
  RESET ROLE;

  -- ---- 4. logged-in role but NO JWT subject: must be {} ---------------------
  PERFORM set_config('request.jwt.claims', '', true),
          set_config('request.jwt.claim.sub', '', true);
  SET LOCAL ROLE authenticated;
  j_nojwt_my   := public.ops_my_day_report();
  j_nojwt_head := public.ops_head_day_report();
  RESET ROLE;

  -- ---- 5. grants: helper NOT callable by authenticated; anon blocked ---------
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.ops_tech_day_block(c_gohil, v_today);
    t_helper := 'CALLABLE BY AUTHENTICATED (BAD)';
  EXCEPTION WHEN insufficient_privilege THEN
    t_helper := 'denied (good): ' || SQLERRM;
  WHEN OTHERS THEN
    t_helper := 'unexpected error: ' || SQLERRM;
  END;
  RESET ROLE;

  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.ops_my_day_report();
    t_anon_my := 'CALLABLE BY ANON (BAD)';
  EXCEPTION WHEN insufficient_privilege THEN
    t_anon_my := 'denied (good): ' || SQLERRM;
  WHEN OTHERS THEN
    t_anon_my := 'unexpected error: ' || SQLERRM;
  END;
  BEGIN
    PERFORM public.ops_head_day_report();
    t_anon_head := 'CALLABLE BY ANON (BAD)';
  EXCEPTION WHEN insufficient_privilege THEN
    t_anon_head := 'denied (good): ' || SQLERRM;
  WHEN OTHERS THEN
    t_anon_head := 'unexpected error: ' || SQLERRM;
  END;
  RESET ROLE;

  -- ---- 6. access-control verdicts -------------------------------------------
  m := m || E'\n== ACCESS CONTROL ==\n';
  m := m || format(E'exec own report ok            : %s\n', CASE WHEN (j_gohil->>'ok') = 'true' AND (j_gulshan->>'ok') = 'true' THEN 'PASS' ELSE 'FAIL' END);
  m := m || format(E'head team report ok           : %s\n', CASE WHEN (j_dixita->>'ok') = 'true' THEN 'PASS' ELSE 'FAIL' END);
  m := m || format(E'admin team report ok          : %s\n', CASE WHEN (j_admin_head->>'ok') = 'true' THEN 'PASS' ELSE 'FAIL' END);
  m := m || format(E'sales/telecaller -> my {}     : %s\n', CASE WHEN j_rep_my   = '{}'::jsonb THEN 'PASS' ELSE 'FAIL' END);
  m := m || format(E'sales/telecaller -> head {}   : %s\n', CASE WHEN j_rep_head = '{}'::jsonb THEN 'PASS' ELSE 'FAIL' END);
  m := m || format(E'no JWT -> my {}               : %s\n', CASE WHEN j_nojwt_my   = '{}'::jsonb THEN 'PASS' ELSE 'FAIL' END);
  m := m || format(E'no JWT -> head {}             : %s\n', CASE WHEN j_nojwt_head = '{}'::jsonb THEN 'PASS' ELSE 'FAIL' END);
  m := m || format(E'exec -> head {}               : %s\n', CASE WHEN j_exec_head  = '{}'::jsonb THEN 'PASS' ELSE 'FAIL' END);
  m := m || format(E'head -> my {}                 : %s\n', CASE WHEN j_head_my    = '{}'::jsonb THEN 'PASS' ELSE 'FAIL' END);
  m := m || format(E'admin -> my {}                : %s\n', CASE WHEN j_admin_my   = '{}'::jsonb THEN 'PASS' ELSE 'FAIL' END);
  m := m || format(E'helper as authenticated       : %s\n', t_helper);
  m := m || format(E'my report as anon             : %s\n', t_anon_my);
  m := m || format(E'head report as anon           : %s\n', t_anon_head);

  -- ---- 7. day clamp -----------------------------------------------------------
  m := m || E'\n== DAY CLAMP ==\n';
  m := m || format(E'today+3  -> day=%s (want %s) : %s\n', j_fut->>'day', v_today, CASE WHEN (j_fut->>'day') = v_today::text THEN 'PASS' ELSE 'FAIL' END);
  m := m || format(E'today-30 -> day=%s (want %s) : %s\n', j_old->>'day', v_today - 7, CASE WHEN (j_old->>'day') = (v_today - 7)::text THEN 'PASS' ELSE 'FAIL' END);

  -- ---- 8. independent cross-checks (plain SELECTs, different query shape) ----
  m := m || E'\n== THREE NUMBERS vs INDEPENDENT SELECTS (GOHIL) ==\n';

  SELECT COALESCE(round(sum(km_traveled), 1), 0) INTO x_km
    FROM public.daily_ta WHERE user_id = c_gohil AND ta_date = v_today;
  m := m || format(E'km today              : report=%s  independent=%s  -> %s\n',
        j_gohil->>'km', x_km, CASE WHEN (j_gohil->>'km')::numeric = x_km THEN 'PASS' ELSE 'FAIL' END);

  SELECT count(*) INTO x_off
    FROM public.ops_screens s
   WHERE s.is_active AND s.status = 'offline'
     AND s.depot_id IN (SELECT d.id FROM public.ops_depots d WHERE d.assigned_to = c_gohil AND d.is_active);
  IF (j_gohil->>'closed') = 'true' THEN
    m := m || format(E'offline at his depots : report=null (closed, by design)  independent live count=%s  -> n/a (run 07:00-21:00 IST to compare)\n', x_off);
  ELSE
    m := m || format(E'offline at his depots : report=%s  independent=%s  -> %s\n',
          j_gohil#>>'{faults,offline}', x_off, CASE WHEN (j_gohil#>>'{faults,offline}')::int = x_off THEN 'PASS' ELSE 'FAIL' END);
  END IF;

  SELECT count(*), count(*) FILTER (WHERE c.duration_seconds > 0) INTO x_tot, x_ans
    FROM public.call_logs c
   WHERE c.user_id = c_gohil AND c.direction = 'outgoing'
     AND (c.call_at AT TIME ZONE 'Asia/Kolkata')::date = v_today
     AND length(regexp_replace(COALESCE(c.client_phone, ''), '\D', '', 'g')) >= 10
     AND right(regexp_replace(c.client_phone, '\D', '', 'g'), 10) IN (
           SELECT right(regexp_replace(dc.phone, '\D', '', 'g'), 10)
             FROM public.ops_depot_contacts dc
            WHERE length(regexp_replace(COALESCE(dc.phone, ''), '\D', '', 'g')) >= 10);
  m := m || format(E'depot calls (total)  : report=%s  independent=%s  -> %s\n',
        j_gohil#>>'{calls,depot_total}', x_tot, CASE WHEN (j_gohil#>>'{calls,depot_total}')::int = x_tot THEN 'PASS' ELSE 'FAIL' END);
  m := m || format(E'depot calls answered : report=%s  independent=%s  -> %s\n',
        j_gohil#>>'{calls,depot_answered}', x_ans, CASE WHEN (j_gohil#>>'{calls,depot_answered}')::int = x_ans THEN 'PASS' ELSE 'FAIL' END);

  -- head-report totals vs plain SELECTs
  m := m || E'\n== HEAD REPORT vs INDEPENDENT SELECTS ==\n';
  SELECT count(*) INTO x_nexec FROM public.users WHERE role = 'operation_executive' AND is_active;
  m := m || format(E'techs listed          : report=%s  independent=%s  -> %s\n',
        jsonb_array_length(j_dixita->'techs'), x_nexec, CASE WHEN jsonb_array_length(j_dixita->'techs') = x_nexec THEN 'PASS' ELSE 'FAIL' END);

  SELECT COALESCE(round(sum(ta.km_traveled), 1), 0) INTO x_sumkm
    FROM public.daily_ta ta
    JOIN public.users u ON u.id = ta.user_id AND u.role = 'operation_executive' AND u.is_active
   WHERE ta.ta_date = v_today;
  m := m || format(E'totals.km             : report=%s  independent=%s  -> %s\n',
        j_dixita#>>'{totals,km}', x_sumkm, CASE WHEN (j_dixita#>>'{totals,km}')::numeric = x_sumkm THEN 'PASS' ELSE 'FAIL' END);

  SELECT count(*) FILTER (WHERE status = 'online'), count(*) FILTER (WHERE status = 'offline'),
         count(*) FILTER (WHERE status = 'online' AND camera_active = false)
    INTO x_up, x_down, x_cam FROM public.ops_screens WHERE is_active;
  IF (j_dixita->>'closed') = 'true' THEN
    m := m || format(E'network (closed)      : report up/down/cam=null by design; total=%s  independent live up=%s down=%s cam=%s  -> n/a (run 07:00-21:00 IST)\n',
          j_dixita#>>'{network,total}', x_up, x_down, x_cam);
  ELSE
    m := m || format(E'network up/down/cam   : report=%s/%s/%s  independent=%s/%s/%s  -> %s\n',
          j_dixita#>>'{network,up}', j_dixita#>>'{network,down}', j_dixita#>>'{network,camera_off}', x_up, x_down, x_cam,
          CASE WHEN (j_dixita#>>'{network,up}')::int = x_up AND (j_dixita#>>'{network,down}')::int = x_down
                AND (j_dixita#>>'{network,camera_off}')::int = x_cam THEN 'PASS' ELSE 'FAIL' END);
  END IF;

  SELECT count(*) INTO x_pl FROM public.leaves l
    JOIN public.users u ON u.id = l.user_id AND u.role = 'operation_executive' AND u.is_active WHERE l.status = 'pending';
  SELECT count(*) INTO x_pta FROM public.ta_da_requests t
    JOIN public.users u ON u.id = t.user_id AND u.role = 'operation_executive' AND u.is_active WHERE t.status = 'pending';
  m := m || format(E'pending leave / TA    : report=%s/%s  independent=%s/%s  -> %s\n',
        j_dixita#>>'{needs,pending_leave}', j_dixita#>>'{needs,pending_ta}', x_pl, x_pta,
        CASE WHEN (j_dixita#>>'{needs,pending_leave}')::int = x_pl AND (j_dixita#>>'{needs,pending_ta}')::int = x_pta THEN 'PASS' ELSE 'FAIL' END);

  m := m || format(E'admin result == head result (ignoring as_of): %s\n',
        CASE WHEN (j_admin_head - 'as_of') = (j_dixita - 'as_of') THEN 'PASS' ELSE 'FAIL (may differ by seconds if a screen flipped between calls)' END);

  -- ---- 9. full JSON (nothing truncated) ---------------------------------------
  m := m || E'\n== FULL JSON: ops_my_day_report() as GOHIL ==\n'   || jsonb_pretty(j_gohil);
  m := m || E'\n\n== FULL JSON: ops_my_day_report() as GULSHAN ==\n' || jsonb_pretty(j_gulshan);
  m := m || E'\n\n== FULL JSON: ops_head_day_report() as DIXITA (head) ==\n' || jsonb_pretty(j_dixita);

  -- ---- 10. abort so nothing is kept -------------------------------------------
  RAISE EXCEPTION E'DRYRUN REPORT >>\n%', m;
END
$dry$;

-- Never reached when the DO block raises (it always does). If it somehow did not,
-- make sure the wrapping BEGIN is rolled back rather than left open.
ROLLBACK;
