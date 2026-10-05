-- supabase_ops_sept_pay_prep.sql
-- Operations pay prep for SEPTEMBER 2026 + switch off the "test" operations account.
-- Written 2026-10-05. MONEY (changes the INPUT of two people's September salary). Diagnostic-first.
--
-- WHAT THIS FILE DOES (plain language)
--   Gohil Ankitkumar and Gulshan Yadav joined on 10 Sep with no stations assigned, so nothing about
--   their September work could be measured. A single stray score-0 day is counted against each of them,
--   and because of it the Salary sheet pays them ZERO variable for September. Owner decision
--   (2026-10-05): for SEPTEMBER ONLY they get the FULL variable (30% of salary) once. From October
--   the real screen uptime counts, as designed -- BUT ONLY ONCE THEY OWN STATIONS (see the OCTOBER
--   GATE section further down; this file does NOT make October safe on its own).
--   Second: the "test" operations account (salary 22,000) must not become payable -> switch it off
--   (only AFTER its stations have been handed to Gohil / Gulshan -- see the OCTOBER GATE section).
--
-- HOW THE FIX WORKS (no function is changed)
--   db/functions/monthly_score.sql counts only daily_performance rows WHERE is_excluded = false. When that
--   count is 0 it already pays the full variable cap (the "ELSIF v_days = 0" branch). Part 2(i) marks the
--   stray September days of the two named techs as excluded, so the count becomes 0 -> existing rule
--   -> full variable. Only days with NO real uptime reading behind them are marked.
--
-- SAFETY (read this)
--   * Part 2 edits ONLY daily_performance.is_excluded (plus its label excluded_reason) for the 2 named
--     techs, in ONE month (September 2026), on days with no real uptime behind them; and ONE users flag
--     (is_active) on ONE account. It touches no function, no trigger, no salary figure, no other person,
--     no other month. Nothing moves for anyone else. Fully revertible (REVERT block, one statement each).
--   * Dixita (operation head) is NOT touched. Her September variable stays whatever the whole-network
--     uptime gave (owner did not ask to change it).
--   * Part 2 is COMMENTED OUT. Pasting this whole file as-is changes NOTHING; it only shows the grid.
--   * Fail-closed guards: Part 2(i) does nothing unless the names match exactly one Gohil and one Gulshan
--     among operation_executive users; Part 2(ii) does nothing unless exactly one account is named test
--     with an untitledad.in email AND it has no salary payout rows AND it no longer owns any active
--     station (otherwise new fault tickets and alerts would keep going to a switched-off account).
--   * Preview calls monthly_score and compute_monthly_salary. Both are read-only (STABLE; they only SELECT
--     - read db/functions/monthly_score.sql and _compute_monthly_salary_base.sql). Their gate
--     _assert_self_or_admin lets Supabase Studio through: Studio has no login, auth.uid() is NULL,
--     get_my_role() is NULL, and NULL NOT IN (...) is NULL, so the gate never raises
--     (documented in supabase_phase97_2_rpc_role_gates.sql lines 60-71; the same reliance as the Phase 323
--     shadow-compare). The grid ALSO refuses to call them unless all 7 functions in the pay chain are
--     STABLE/IMMUTABLE and the caller is allowed (it then prints NOT RUN instead of erroring).
--   * Not run against a database by the author (none available). If Studio shows an error, nothing was
--     changed by that run; paste the error back.
--
-- MAP OF THIS FILE (Studio shows only the LAST result grid, so the live query is at the very bottom)
--   PART 2        (just below, COMMENTED OUT)  the two changes + the REVERT for each.
--   PART 1+PART 3 (the only live query, at the BOTTOM)  ONE read-only grid, 5 columns:
--                   step | who | item | reading | verdict
--                 It works in BOTH states: before Part 2 it is the diagnostic (Part 1: 1a test account,
--                 1b Gohil + Gulshan September rows, 1c monthly_score for Gohil, Gulshan, Dixita);
--                 after Part 2 the same grid shows the after-state checks (Part 3: 3a-3d, including the
--                 "September net before vs after" comparison). Verdict words:
--                   OK / DONE / PASS = fine      WAITING = expected until you run Part 2
--                   LOOK = read it               STOP / FAIL = do not go on, paste the grid back to Claude
--
-- OWNER STEPS
--   1. Paste this WHOLE file into Supabase Studio, Run. Read the grid (nothing changes).
--   2. Happy with it? Uncomment Part 2(i): select only those SQL lines and press Cmd+/ . Part 2(ii) (the
--      test account) comes ONLY AFTER the stations "test" owns have been reassigned (OCTOBER GATE below;
--      grid row 1a shows stations_owned and Part 2(ii) refuses to run while it is above 0).
--      Paste the WHOLE file again, Run.
--   3. The same grid now shows PASS lines. If anything says FAIL, run the REVERT and paste the grid to Claude.
--
-- OCTOBER GATE -- ASSIGN STATIONS BEFORE OCTOBER PAYROLL (money: read this)
--   Part 2(i) fixes SEPTEMBER only. It does NOT make October safe. Gohil and Gulshan own 0 stations today.
--   With 0 stations the uptime job (supabase_ops_p4_uptime_pay.sql) writes a "no screen data" day for
--   each of them every day and marks that day EXCLUDED. By the end of October they would have 0 counted
--   days, and monthly_score (db/functions/monthly_score.sql, the "ELSIF v_days = 0" branch) then pays the
--   FULL 30% variable again -- for a month in which nothing was measured. That is the opposite of the
--   owner decision "September only; from October it follows real uptime". (If a stray non-excluded
--   score-0 day shows up instead, they would get ZERO variable -- also wrong. Either way the cure is
--   the same: they must own stations.)
--   => BEFORE October payroll: give Gohil and Gulshan their stations in the Ops Head console (Screens
--      by station -> Assigned tech). Grid row 1r shows stations_owned for every tech and prints
--      "OCTOBER GATE" next to any of the two who still has 0.
--   The "test" account probably owns the stations right now (row 1a / 1r show stations_owned). Reassign
--   them to Gohil / Gulshan FIRST (that one step serves both jobs), and only then run Part 2(ii).
--   Switching "test" off while it still owns stations is NOT safe: the auto-ticket engine
--   (supabase_ops_p2_auto_tickets.sql) copies the depot's assigned tech onto every new fault ticket and
--   sends the push alert to it WITHOUT checking that the account is active, and the Ops Head "Needs you"
--   list only counts faults at depots with NO assigned tech, so those faults would not show up there.
--   That is why Part 2(ii) below refuses to run while "test" still owns an active station.
--   If you would rather have those faults show up as "unassigned" instead, tell Claude -- that is a
--   separate step, it is NOT in this file, and it needs your OK first.
--
-- Idempotent: the live query only reads; each Part 2 / REVERT statement only touches rows that still
-- need it, so re-running is a no-op.


-- ============================================================================
-- PART 2 · THE TWO CHANGES -- COMMENTED OUT ON PURPOSE.
-- *** RUN ONLY AFTER YOU READ PART 1 (the grid at the bottom of this file) ***
-- ============================================================================
-- To run a change: select ONLY its SQL lines (each starts with "-- ") and press Cmd+/ to uncomment.
-- The two changes are independent. Each prints the rows it changed.

-- ---- 2(i) Gohil + Gulshan: exclude their September days that have no real uptime behind them ---------
-- Effect: monthly_score then counts 0 days for them -> existing rule -> FULL 30% variable, September only.
-- was_excluded_reason shows what each row said before (so the REVERT can be checked).

-- WITH cand AS (
--   SELECT u.id,
--          CASE WHEN u.name ILIKE '%gohil%' THEN 'gohil' ELSE 'gulshan' END AS tag
--     FROM public.users u
--    WHERE u.role = 'operation_executive'
--      AND (u.name ILIKE '%gohil%' OR u.name ILIKE '%gulshan%')
-- ), ok AS (
--   SELECT (count(*) FILTER (WHERE tag = 'gohil') = 1
--           AND count(*) FILTER (WHERE tag = 'gulshan') = 1) AS good
--     FROM cand
-- ), before_rows AS (
--   SELECT dp.user_id, dp.work_date, dp.excluded_reason AS was_reason
--     FROM public.daily_performance dp
--     JOIN cand c ON c.id = dp.user_id
--    CROSS JOIN ok
--    WHERE ok.good
--      AND dp.work_date >= DATE '2026-09-01'
--      AND dp.work_date <  DATE '2026-10-01'
--      AND dp.is_excluded = false
--      AND NOT EXISTS (SELECT 1 FROM public.ops_uptime_daily o
--                       WHERE o.user_id = dp.user_id
--                         AND o.work_date = dp.work_date
--                         AND o.screens_total > 0)
-- )
-- UPDATE public.daily_performance dp
--    SET is_excluded     = true,
--        excluded_reason = 'ops Sept 2026: no stations assigned - owner decision 2026-10-05 (full variable once)'
--   FROM before_rows b
--  WHERE dp.user_id = b.user_id
--    AND dp.work_date = b.work_date
-- RETURNING dp.user_id, dp.work_date, dp.score_pct, b.was_reason AS was_excluded_reason, dp.is_excluded;

-- ---- 2(ii) Switch off the "test" operations account (guarded) ----------------------------------------
-- ORDER MATTERS: reassign the stations "test" owns to Gohil / Gulshan FIRST (OCTOBER GATE in the header).
-- Needs: role operation_executive, name exactly test, an untitledad.in email, exactly ONE such account,
-- NO salary payout rows, and NO active station still assigned to it (it prints nothing and changes
-- nothing until grid row 1a shows stations_owned=0). Then it only flips is_active to false (the account
-- is not deleted).

-- WITH t AS (
--   SELECT u.id
--     FROM public.users u
--    WHERE u.role = 'operation_executive'
--      AND lower(btrim(u.name)) = 'test'
--      AND lower(split_part(u.email, '@', 2)) = 'untitledad.in'
-- ), ok AS (
--   SELECT (count(*) = 1) AS good FROM t
-- )
-- UPDATE public.users u
--    SET is_active = false
--   FROM t, ok
--  WHERE u.id = t.id
--    AND ok.good
--    AND COALESCE(u.is_active, true)
--    AND NOT EXISTS (SELECT 1 FROM public.salary_payouts sp WHERE sp.user_id = u.id)
--    AND NOT EXISTS (SELECT 1 FROM public.ops_depots d WHERE d.assigned_to = u.id AND d.is_active)
-- RETURNING u.id, u.name, u.role, u.is_active, split_part(u.email, '@', 2) AS email_domain;

-- ---- REVERT (only if you want to undo; one statement each, uncomment just the one you need) -----------
-- Note: the REVERT puts excluded_reason back to blank. Before Part 2 it was blank or an empty string;
-- is_excluded and score_pct come back exactly, so pay is identical to before.

-- REVERT 2(i): count those September days again.

-- UPDATE public.daily_performance dp
--    SET is_excluded = false,
--        excluded_reason = NULL
--  WHERE dp.excluded_reason = 'ops Sept 2026: no stations assigned - owner decision 2026-10-05 (full variable once)'
--    AND dp.work_date >= DATE '2026-09-01'
--    AND dp.work_date <  DATE '2026-10-01'
-- RETURNING dp.user_id, dp.work_date, dp.score_pct, dp.is_excluded;

-- REVERT 2(ii): switch the test account back on.

-- UPDATE public.users u
--    SET is_active = true
--  WHERE u.role = 'operation_executive'
--    AND lower(btrim(u.name)) = 'test'
--    AND lower(split_part(u.email, '@', 2)) = 'untitledad.in'
--    AND u.is_active = false
-- RETURNING u.id, u.name, u.role, u.is_active;


-- ============================================================================
-- Schema reload (house rule). This file changes no schema, so this is a harmless no-op.
-- It sits BEFORE the grid because Studio shows only the last statement's result.
-- ============================================================================
NOTIFY pgrst, 'reload schema';


-- ============================================================================
-- PART 1 + PART 3 · THE STATUS GRID -- read-only, safe to run any time, before AND after Part 2.
-- Section 1x = Part 1 (what is true now). Section 3x = Part 3 (after-state checks; WAITING until Part 2).
-- ============================================================================
WITH
k AS (
  SELECT DATE '2026-09-01' AS ms,
         DATE '2026-10-01' AS me,
         'ops Sept 2026: no stations assigned - owner decision 2026-10-05 (full variable once)'::text AS marker
),
-- Safety: every function the preview calls must be read-only, and the caller must be allowed
-- (Studio = no login = allowed). If not, the salary calls are skipped and the grid prints NOT RUN.
g AS (
  SELECT (count(DISTINCT p.proname) = 7
          AND bool_and(p.provolatile IN ('s', 'i'))
          AND (public.get_my_role() IS NULL
               OR public.get_my_role() IN ('admin', 'co_owner', 'accounts'))) AS safe
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('compute_monthly_salary', '_compute_monthly_salary_base', 'monthly_score',
                       'earned_incentive_for', '_assert_self_or_admin', 'fy_for_date', 'get_my_role')
),
-- The two techs (KEEP this match IDENTICAL to Part 2(i)): operation_executive, name has gohil or gulshan.
cand AS (
  SELECT u.id, u.name, u.is_active,
         CASE WHEN u.name ILIKE '%gohil%' THEN 'gohil' ELSE 'gulshan' END AS tag
    FROM public.users u
   WHERE u.role = 'operation_executive'
     AND (u.name ILIKE '%gohil%' OR u.name ILIKE '%gulshan%')
),
gok AS (
  SELECT count(*) FILTER (WHERE tag = 'gohil')   AS n_gohil,
         count(*) FILTER (WHERE tag = 'gulshan') AS n_gulshan,
         (count(*) FILTER (WHERE tag = 'gohil') = 1
          AND count(*) FILTER (WHERE tag = 'gulshan') = 1) AS ok
    FROM cand
),
hd AS (
  SELECT u.id, u.name, u.is_active, 'head'::text AS tag
    FROM public.users u
   WHERE u.role = 'operation_head' AND u.name ILIKE '%dixita%'
),
ppl AS (
  SELECT c.id, c.name, c.is_active, c.tag FROM cand c
  UNION ALL
  SELECT h.id, h.name, h.is_active, h.tag FROM hd h
),
-- Every September daily_performance row of those people + is there a REAL uptime reading behind it?
dpx AS (
  SELECT dp.user_id, dp.work_date, dp.score_pct, dp.is_excluded, dp.excluded_reason, dp.calculated_at,
         EXISTS (SELECT 1 FROM public.ops_uptime_daily o
                  WHERE o.user_id = dp.user_id
                    AND o.work_date = dp.work_date
                    AND o.screens_total > 0) AS real_uptime,
         COALESCE(dp.excluded_reason = k.marker, false) AS is_marked,
         CASE WHEN p.tag <> 'head' THEN
           (SELECT count(*) FROM public.lead_activities la
             WHERE la.created_by = dp.user_id
               AND la.activity_type = 'meeting'
               AND la.created_at >= (dp.work_date::timestamp AT TIME ZONE 'Asia/Kolkata')
               AND la.created_at <  ((dp.work_date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'))
         END AS meeting_rows
    FROM public.daily_performance dp
    JOIN ppl p ON p.id = dp.user_id
   CROSS JOIN k
   WHERE dp.work_date >= k.ms AND dp.work_date < k.me
),
agg AS (
  SELECT p.id,
         count(x.work_date)                                                       AS n_rows,
         count(*) FILTER (WHERE x.is_excluded = false)                            AS n_counted_now,
         count(*) FILTER (WHERE x.is_marked)                                      AS n_marked,
         count(*) FILTER (WHERE x.is_excluded = false AND NOT x.real_uptime)      AS n_would_exclude,
         count(*) FILTER (WHERE x.is_excluded = false OR x.is_marked)             AS n_before,
         avg(x.score_pct) FILTER (WHERE x.is_excluded = false OR x.is_marked)     AS avg_before,
         count(*) FILTER (WHERE x.is_excluded = false AND x.real_uptime)          AS n_after,
         avg(x.score_pct) FILTER (WHERE x.is_excluded = false AND x.real_uptime)  AS avg_after
    FROM ppl p
    LEFT JOIN dpx x ON x.user_id = p.id
   GROUP BY p.id
),
base AS (
  SELECT p.id, p.name, p.is_active, p.tag,
         COALESCE(sip.monthly_salary, 0) AS sal,
         a.n_rows, a.n_counted_now, a.n_marked, a.n_would_exclude,
         a.n_before, a.avg_before, a.n_after, a.avg_after
    FROM ppl p
    JOIN agg a ON a.id = p.id
    LEFT JOIN public.staff_incentive_profiles sip ON sip.user_id = p.id
),
-- My copy of the monthly_score variable rule (db/functions/monthly_score.sql), used ONLY to rebuild the
-- BEFORE figure and to predict the AFTER figure. (Rule 1, the 3x-business override, is sales/telecaller
-- only, so it never applies to operations people.) The LIVE figures below come from the real functions.
calc AS (
  SELECT b.*,
         ROUND(CASE WHEN b.n_before = 0 THEN b.sal * 0.30
                    WHEN b.avg_before < 50 THEN 0
                    WHEN b.avg_before > 75 THEN b.sal * 0.30
                    ELSE (b.avg_before / 100.0) * b.sal * 0.30 END, 0) AS var_before,
         ROUND(CASE WHEN b.n_after = 0 THEN b.sal * 0.30
                    WHEN b.avg_after < 50 THEN 0
                    WHEN b.avg_after > 75 THEN b.sal * 0.30
                    ELSE (b.avg_after / 100.0) * b.sal * 0.30 END, 0) AS var_after
    FROM base b
),
-- LIVE figures from the real functions (read-only), skipped unless the safety check passed.
live AS (
  SELECT c.*,
         -- alias is "scr" (NOT "ms"): the CTE k has a column named ms, and Postgres would resolve a bare
         -- to_jsonb(ms) to that outer date column instead of the monthly_score row.
         CASE WHEN g.safe THEN
           (SELECT to_jsonb(scr) FROM public.monthly_score(c.id, k.ms) scr)
         END AS msj,
         CASE WHEN g.safe THEN
           public.compute_monthly_salary(c.id, extract(year FROM k.ms)::int, extract(month FROM k.ms)::int)
         END AS net
    FROM calc c
   CROSS JOIN g
   CROSS JOIN k
),
lv AS (
  SELECT l.*,
         (l.msj->>'working_days')::int         AS days_live,
         (l.msj->>'avg_score_pct')::numeric    AS avg_live,
         (l.msj->>'base_amount')::numeric      AS base_live,
         (l.msj->>'variable_cap')::numeric     AS cap_live,
         (l.msj->>'variable_earned')::numeric  AS var_live,
         (l.msj->>'total_payable')::numeric    AS total_live,
         (l.net->>'net_payable')::numeric      AS net_live
    FROM live l
),
-- The test account (KEEP the exact-match rule IDENTICAL to Part 2(ii)); near matches are shown too.
tc AS (
  SELECT u.id, u.name, u.role, u.is_active,
         lower(split_part(u.email, '@', 2)) AS dom,
         (u.created_at AT TIME ZONE 'Asia/Kolkata')::date AS created_ist,
         COALESCE(lower(btrim(u.name)) = 'test'
                  AND u.role = 'operation_executive'
                  AND lower(split_part(u.email, '@', 2)) = 'untitledad.in', false) AS is_target,
         sip.monthly_salary AS salary,
         (SELECT count(*) FROM public.ops_uptime_daily o WHERE o.user_id = u.id) AS uptime_rows,
         (SELECT count(*) FROM public.salary_payouts sp WHERE sp.user_id = u.id)  AS payout_rows,
         (SELECT count(*) FROM public.ops_depots d WHERE d.assigned_to = u.id AND d.is_active) AS stations
    FROM public.users u
    LEFT JOIN public.staff_incentive_profiles sip ON sip.user_id = u.id
   WHERE u.role = 'operation_executive'
     AND (lower(btrim(u.name)) = 'test'
          OR u.name ILIKE '%test%'
          OR split_part(u.email, '@', 1) ILIKE '%test%')
),
ros AS (
  SELECT u.id, u.name, u.role, u.is_active, sip.monthly_salary AS salary,
         (SELECT count(*) FROM public.ops_depots d WHERE d.assigned_to = u.id AND d.is_active) AS stations
    FROM public.users u
    LEFT JOIN public.staff_incentive_profiles sip ON sip.user_id = u.id
   WHERE u.role IN ('operation_executive', 'operation_head')
),
trg AS (
  SELECT c.relname::text AS tbl, string_agg(t.tgname::text, ', ' ORDER BY t.tgname) AS names
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND NOT t.tgisinternal
     AND c.relname IN ('daily_performance', 'users', 'ops_uptime_daily')
   GROUP BY c.relname
)
SELECT q.step, q.who, q.item, q.reading, q.verdict
FROM (

  -- 0 · where you are ---------------------------------------------------------------------------
  SELECT 0 AS ord, '0'::text AS sub, '0 - STATE'::text AS step, 'Sept 2026 ops pay prep'::text AS who,
         'where you are'::text AS item,
         CASE WHEN m.n_marked = 0 AND NOT t.done THEN 'BEFORE Part 2 - nothing has been changed yet'
              WHEN m.n_marked > 0 AND t.done     THEN 'AFTER Part 2 - both changes are applied'
              WHEN m.n_marked > 0                THEN 'Part 2(i) applied, Part 2(ii) not applied'
              ELSE 'Part 2(ii) applied, Part 2(i) not applied' END AS reading,
         'This grid only reads, it changes nothing. Run it before Part 2 and again after.'::text AS verdict
    FROM (SELECT COALESCE(sum(c.n_marked), 0) AS n_marked FROM calc c WHERE c.tag <> 'head') m,
         (SELECT (count(*) FILTER (WHERE x.is_target AND x.is_active IS NOT TRUE) > 0) AS done FROM tc x) t

  -- 1a · the test account -----------------------------------------------------------------------
  UNION ALL
  SELECT 10, x.id::text || 'a', '1a - test account', COALESCE(x.name, '?'), 'the account',
         format('name=%s; role=%s; %s; email_domain=%s; created=%s',
                x.name, x.role, CASE WHEN x.is_active THEN 'ACTIVE' ELSE 'inactive' END, x.dom, x.created_ist),
         CASE WHEN x.is_target THEN 'This is the account Part 2(ii) switches off'
              ELSE 'Near match only - Part 2(ii) will NOT touch it (needs name exactly test and an untitledad.in email)' END
    FROM tc x
  UNION ALL
  SELECT 10, x.id::text || 'b', '1a - test account', COALESCE(x.name, '?'), 'salary and history',
         format('salary=%s; uptime_rows_ever=%s; payout_rows_ever=%s; stations_owned=%s',
                COALESCE(x.salary::text, '(no salary row)'), x.uptime_rows, x.payout_rows, x.stations),
         CASE WHEN x.payout_rows > 0 THEN 'STOP - salary payouts exist for this account; Part 2(ii) will refuse and leave it active'
              WHEN x.is_active IS NOT TRUE AND x.stations > 0 THEN 'STOP - it is switched off but STILL owns ' || x.stations::text || ' active stations: new fault tickets and alerts are going to an inactive account and the Ops Head Needs-you list will not show them. Reassign the stations to Gohil / Gulshan now (Ops Head console -> Screens by station -> Assigned tech)'
              WHEN x.stations > 0 THEN 'STOP - it owns ' || x.stations::text || ' active stations. Reassign them to Gohil / Gulshan FIRST (Ops Head console -> Screens by station -> Assigned tech). If it is switched off while it owns them, new fault tickets and alerts keep going to an inactive account and the Ops Head Needs-you list will not show them. Part 2(ii) does nothing until this is 0'
              ELSE 'OK - no payouts, no stations' END
    FROM tc x
  UNION ALL
  SELECT 10, x.id::text || 'c', '1a - test account', COALESCE(x.name, '?'), 'Part 2(ii) status',
         CASE WHEN NOT x.is_target THEN 'not targeted'
              WHEN x.is_active IS NOT TRUE AND x.stations > 0 THEN 'already switched off BUT still owns ' || x.stations::text || ' active stations'
              WHEN x.is_active IS NOT TRUE THEN 'already switched off'
              WHEN x.payout_rows > 0 THEN 'blocked: payout rows exist'
              WHEN (SELECT count(*) FROM tc y WHERE y.is_target) <> 1 THEN 'blocked: more than one exact match'
              WHEN x.stations > 0 THEN 'blocked: still owns ' || x.stations::text || ' active stations - reassign them first'
              ELSE 'ready to switch off' END,
         CASE WHEN NOT x.is_target THEN 'OK'
              WHEN x.is_active IS NOT TRUE AND x.stations > 0 THEN 'STOP - reassign its stations to Gohil / Gulshan now; until then new fault tickets and alerts go to an inactive account'
              WHEN x.is_active IS NOT TRUE THEN 'DONE'
              WHEN x.payout_rows > 0 THEN 'STOP'
              WHEN (SELECT count(*) FROM tc y WHERE y.is_target) <> 1 THEN 'STOP'
              WHEN x.stations > 0 THEN 'STOP - reassign its stations to Gohil / Gulshan first (Ops Head console -> Screens by station -> Assigned tech), then run Part 2(ii)'
              ELSE 'WAITING - runs when you uncomment Part 2(ii)' END
    FROM tc x
  UNION ALL
  SELECT 10, 'z', '1a - test account', '(none)', 'the account',
         'no operation_executive account named like test was found',
         'LOOK - Part 2(ii) has nothing to do (already deleted or renamed?)'
   WHERE NOT EXISTS (SELECT 1 FROM tc)

  -- 1r · ops roster, names exactly as stored (so a name mismatch is obvious) ---------------------
  UNION ALL
  SELECT 15, r.role || ':' || COALESCE(r.name, ''), '1r - ops roster (names as stored)', COALESCE(r.name, '?'), r.role,
         format('%s; salary=%s; stations_owned=%s',
                CASE WHEN r.is_active THEN 'ACTIVE' ELSE 'inactive' END,
                COALESCE(r.salary::text, '(none)'), r.stations),
         CASE WHEN r.role = 'operation_executive' AND (r.name ILIKE '%gohil%' OR r.name ILIKE '%gulshan%') THEN
                'Part 2(i) target' ||
                CASE WHEN r.is_active IS NOT FALSE AND r.stations = 0
                       THEN ' | OCTOBER GATE: owns 0 stations, so October will ALSO pay the FULL variable (nothing can be measured) until stations are assigned - assign them before October payroll'
                     WHEN r.is_active IS NOT FALSE
                       THEN ' | owns ' || r.stations::text || ' stations - October follows real uptime'
                     ELSE '' END
              WHEN r.role = 'operation_executive' AND lower(btrim(r.name)) = 'test' THEN
                'Part 2(ii) target (if payout-free)' ||
                CASE WHEN r.stations > 0 AND r.is_active IS NOT FALSE
                       THEN ' | owns ' || r.stations::text || ' active stations - reassign them to Gohil / Gulshan BEFORE switching it off (Part 2(ii) will not run until then)'
                     WHEN r.stations > 0
                       THEN ' | already switched off but STILL owns ' || r.stations::text || ' active stations - reassign them to Gohil / Gulshan now'
                     ELSE '' END
              WHEN r.role = 'operation_head' AND r.name ILIKE '%dixita%' THEN 'Dixita - NOT changed by this file'
              ELSE '-' END
    FROM ros r

  -- 1b · Gohil + Gulshan, September rows --------------------------------------------------------
  UNION ALL
  SELECT 20, '0', '1b - Gohil + Gulshan, Sept 2026', '(both)', 'who matched',
         format('gohil matches=%s; gulshan matches=%s (need exactly 1 each)', n.n_gohil, n.n_gulshan),
         CASE WHEN n.ok THEN 'OK - exactly one person each, Part 2(i) is allowed to run'
              ELSE 'STOP - Part 2(i) will do nothing until each name matches exactly one operation_executive (see roster above)' END
    FROM gok n
  UNION ALL
  SELECT 20, '2' || COALESCE(p.name, '') || to_char(x.work_date, 'YYYY-MM-DD'),
         '1b - Gohil + Gulshan, Sept 2026', p.name, to_char(x.work_date, 'YYYY-MM-DD Dy'),
         format('score_pct=%s; %s; reason=%s; real_uptime_row=%s; meeting_activity_rows=%s; written_at_ist=%s',
                round(x.score_pct, 2),
                CASE WHEN x.is_excluded THEN 'EXCLUDED' ELSE 'COUNTED' END,
                COALESCE(NULLIF(x.excluded_reason, ''), '-'),
                CASE WHEN x.real_uptime THEN 'YES' ELSE 'no' END,
                COALESCE(x.meeting_rows::text, '-'),
                to_char(x.calculated_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI')),
         CASE WHEN x.is_marked THEN 'DONE - excluded by Part 2(i)'
              WHEN x.is_excluded THEN 'not touched - already excluded for another reason'
              WHEN x.real_uptime THEN 'LOOK - a real uptime reading exists for this day; Part 2(i) will NOT touch it'
              WHEN NOT n.ok THEN 'blocked - name match check failed (see who matched)'
              ELSE 'Part 2(i) will exclude this day (no real uptime behind it)' END
    FROM dpx x
    JOIN ppl p ON p.id = x.user_id
   CROSS JOIN gok n
   WHERE p.tag <> 'head'
  UNION ALL
  SELECT 20, '3' || COALESCE(c.name, ''), '1b - Gohil + Gulshan, Sept 2026', c.name, 'September summary',
         format('days_in_table=%s; counted_now=%s; excluded_by_part2=%s; part2_would_exclude=%s; would_stay_counted=%s; sept_salary_payouts_already_recorded=%s',
                c.n_rows, c.n_counted_now, c.n_marked, c.n_would_exclude, c.n_after, pp.n),
         CASE WHEN c.n_after > 0 THEN 'LOOK - days with real uptime stay counted, so Part 2(i) will NOT give the full variable; send me this grid'
              WHEN c.n_rows = 0 THEN 'OK - no rows at all, monthly_score already pays the full variable'
              ELSE 'OK - after Part 2(i) no day is counted, so the full variable applies' END
         || CASE WHEN pp.n > 0 THEN ' | LOOK - a September salary payout is already recorded for this person; the higher variable will show as a pending balance'
                 ELSE '' END
    FROM calc c
   CROSS JOIN LATERAL (SELECT count(*) AS n FROM public.salary_payouts sp
                        WHERE sp.user_id = c.id AND sp.month_year = '2026-09') pp
   WHERE c.tag <> 'head'

  -- 1c · monthly_score for September, live ------------------------------------------------------
  UNION ALL
  SELECT 30, CASE WHEN l.tag = 'head' THEN '9' ELSE '1' END || COALESCE(l.name, ''),
         '1c - monthly_score for Sept 2026 (live)', l.name, 'monthly_score(2026-09-01)',
         CASE WHEN l.msj IS NULL THEN 'NOT RUN'
              ELSE format('counted_days=%s; avg_score_pct=%s; salary=%s; base=%s; variable_cap=%s; variable_earned=%s; total=%s',
                          l.days_live, l.avg_live, l.msj->>'monthly_salary', l.base_live, l.cap_live, l.var_live, l.total_live) END,
         CASE WHEN l.msj IS NULL THEN 'NOT RUN - a pay function is not read-only, or you are signed in as a non-admin; send me this row'
              WHEN l.tag = 'head' THEN 'Dixita - scored on whole-network uptime; this file never touches her'
              WHEN l.cap_live > 0 AND l.days_live = 0 AND l.var_live = l.cap_live THEN 'FULL variable (0 counted days)'
              WHEN l.days_live > 0 AND l.avg_live < 50 THEN 'ZERO variable (average score below 50)'
              WHEN l.days_live > 0 AND l.avg_live > 75 THEN 'FULL variable (average score above 75)'
              ELSE 'proportional' END
    FROM lv l

  -- 3a · after-state: the two techs ---------------------------------------------------------------
  UNION ALL
  SELECT 60, '1' || COALESCE(l.name, ''), '3a - after-state: Sept variable', l.name, 'counted days and variable',
         CASE WHEN l.msj IS NULL THEN 'NOT RUN'
              ELSE format('marker_rows=%s; counted_days_now=%s; variable_now=%s; full_cap=%s',
                          l.n_marked, l.days_live, l.var_live, round(l.sal * 0.30)) END,
         CASE WHEN l.msj IS NULL THEN 'NOT RUN - see 1c'
              WHEN l.sal <= 0 THEN 'LOOK - no salary set for this person'
              WHEN l.days_live = 0 AND l.var_live = round(l.sal * 0.30) AND l.n_marked > 0
                THEN 'PASS - 0 counted days, variable = the full 30% cap'
              WHEN l.days_live = 0 AND l.var_live = round(l.sal * 0.30)
                THEN 'PASS - already 0 counted days and full variable (Part 2(i) had nothing to change)'
              WHEN l.n_marked = 0 THEN 'WAITING - Part 2(i) not run yet'
              ELSE 'FAIL - expected 0 counted days and the full cap; send me this grid' END
    FROM lv l
   WHERE l.tag <> 'head'

  -- 3b · after-state: Dixita untouched ------------------------------------------------------------
  UNION ALL
  SELECT 70, '1', '3b - Dixita untouched', l.name, 'marker rows and Sept score',
         format('marker_rows=%s; counted_days=%s; avg_score_pct=%s; variable_earned=%s',
                l.n_marked, l.days_live, l.avg_live, l.var_live),
         CASE WHEN l.n_marked = 0 THEN 'PASS - Part 2 has not touched her (these numbers must equal the 1c row from before Part 2)'
              ELSE 'FAIL - a Part 2 marker is on her rows; run the REVERT and send me this grid' END
    FROM lv l
   WHERE l.tag = 'head'
  UNION ALL
  SELECT 70, '0', '3b - Dixita untouched', '(none)', 'Dixita',
         'no operation_head named Dixita found', 'LOOK - check the roster above'
   WHERE NOT EXISTS (SELECT 1 FROM hd)

  -- 3c · after-state: test account switched off -----------------------------------------------------
  UNION ALL
  SELECT 75, x.id::text, '3c - test account switched off', COALESCE(x.name, '?'), 'is_active',
         CASE WHEN x.is_active IS NOT TRUE THEN 'inactive' ELSE 'ACTIVE' END || '; stations_owned=' || x.stations::text,
         CASE WHEN x.is_active IS NOT TRUE AND x.stations > 0 THEN 'FAIL - switched off but it still owns active stations: new fault tickets and alerts are going to an inactive account. Reassign the stations to Gohil / Gulshan now'
              WHEN x.is_active IS NOT TRUE THEN 'PASS - switched off and owns no stations, it will not appear on the Salary sheet'
              WHEN x.stations > 0 THEN 'WAITING - Part 2(ii) not run yet, and it will not run until its stations are reassigned'
              ELSE 'WAITING - Part 2(ii) not run yet' END
    FROM tc x
   WHERE x.is_target
  UNION ALL
  SELECT 75, 'z', '3c - test account switched off', '(none)', 'is_active',
         'no account matches name test + untitledad.in email',
         'LOOK - nothing for Part 2(ii) to switch off'
   WHERE NOT EXISTS (SELECT 1 FROM tc y WHERE y.is_target)

  -- 3d · shadow compare: September net before vs after (compute_monthly_salary, read-only) -----------
  UNION ALL
  SELECT 80, '1' || COALESCE(l.name, ''), '3d - shadow compare: Sept net before vs after', l.name, 'net_payable (rupees)',
         CASE WHEN l.net IS NULL THEN 'NOT RUN'
              ELSE format('BEFORE Part 2(i)=%s; AFTER Part 2(i) expected=%s; LIVE NOW=%s; variable %s -> %s; unchanged parts: incentive=%s, travel=%s, leave_cut=%s',
                          l.net_live - l.var_live + l.var_before,
                          l.net_live - l.var_live + l.var_after,
                          l.net_live,
                          l.var_before, l.var_after,
                          l.net->>'incentive', l.net->>'ta_da', l.net->>'unpaid_deduction') END,
         CASE WHEN l.net IS NULL THEN 'NOT RUN - see 1c'
              WHEN l.var_live = l.var_after AND l.n_marked > 0 THEN 'PASS - LIVE NOW equals the expected AFTER'
              WHEN l.var_live = l.var_after THEN 'OK - Part 2(i) would change nothing for this person (variable already at the expected level)'
              WHEN l.n_marked = 0 AND l.var_live <> l.var_before THEN 'LOOK - my copy of the pay rule gives a different BEFORE than the live function; send me this grid'
              WHEN l.n_marked = 0 THEN 'WAITING - Part 2(i) not run yet: LIVE NOW is the real BEFORE figure, compare it with AFTER expected'
              ELSE 'FAIL - LIVE NOW does not equal the expected AFTER; send me this grid' END
    FROM lv l
   WHERE l.tag <> 'head'

  -- 1e · triggers that could react to Part 2 --------------------------------------------------------
  UNION ALL
  SELECT 95, w.tbl, '1e - triggers that could react', w.tbl, 'triggers on this table',
         COALESCE(t.names, '(none)'),
         CASE WHEN w.tbl = 'daily_performance' AND t.names IS NULL THEN 'OK - nothing fires when Part 2(i) edits this table'
              WHEN w.tbl = 'daily_performance' THEN 'LOOK - read these trigger names before running Part 2(i)'
              WHEN w.tbl = 'ops_uptime_daily' THEN 'INFO - Part 2 never writes this table, so the uptime-pay trigger does not fire'
              ELSE 'INFO - Part 2(ii) only flips is_active; the four known in the repo do not react to that; any other name is one the repo does not show' END
    FROM (VALUES ('daily_performance'), ('users'), ('ops_uptime_daily')) AS w(tbl)
    LEFT JOIN trg t ON t.tbl = w.tbl

) q
ORDER BY q.ord, q.sub;

-- VERIFY: read the grid (5 columns: step | who | item | reading | verdict). Nothing to count by hand.
--   BEFORE Part 2 (first paste, everything still commented):
--     0 STATE            = "BEFORE Part 2 - nothing has been changed yet".
--     1a                 = the test account ACTIVE (salary 22000 expected). While it still owns active stations the
--                          rows say "blocked: still owns N active stations" with a STOP -- that STOP is the expected
--                          gate (reassign the stations to Gohil / Gulshan first), not an error. "ready to switch off"
--                          appears only when it has no payouts AND owns no stations.
--     1r                 = Gohil and Gulshan rows say "OCTOBER GATE: owns 0 stations ..." until stations are assigned
--                          (money: October would otherwise ALSO pay the full variable). Assign them before October payroll.
--     1b                 = "gohil matches=1; gulshan matches=1"; each tech's September days (a stray score_pct=0.00
--                          COUNTED day expected), "Part 2(i) will exclude this day"; summary would_stay_counted=0.
--     1c                 = Gohil + Gulshan: counted_days >= 1, variable_earned=0 (ZERO variable); Dixita as before.
--     3a / 3c / 3d       = WAITING. 3d shows BEFORE (the real current net) next to AFTER expected: variable
--                          0 -> 6000 for a 20000 salary, 0 -> 4800 for 16000; travel / incentive / leave cut unchanged.
--     3b                 = Dixita PASS (marker_rows=0). 1e = daily_performance "(none)".
--   AFTER Part 2 (second paste, Part 2 statements uncommented):
--     0 STATE            = "AFTER Part 2 - both changes are applied".
--     1b                 = the stray days now EXCLUDED, "DONE - excluded by Part 2(i)".
--     1c / 3a            = Gohil + Gulshan: counted_days=0, variable_earned = the full cap; 3a PASS.
--     3b                 = Dixita PASS and her 1c numbers identical to before.
--     3c                 = PASS (test account inactive AND stations_owned=0). FAIL here means it was switched off while
--                          it still owns stations -- reassign them now.
--     3d                 = PASS (LIVE NOW equals AFTER expected).
--   Any STOP / FAIL / NOT RUN row: paste the whole grid back to Claude (the "owns N active stations" STOP on the
--   test row just means: reassign first, then run Part 2(ii)). To undo: REVERT block.
