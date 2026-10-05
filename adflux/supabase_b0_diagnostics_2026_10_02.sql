-- supabase_b0_diagnostics_2026_10_02.sql
--
-- B0 diagnostics: READ-ONLY. Changes nothing. Safe to run any time, any number of times.
-- Purpose: get the live facts we need before fixing salary, ops-salary, HR offers, calls and the lead Scan.
--
-- HOW TO RUN (Supabase Studio -> SQL Editor):
--   1. Pick ONE block below (from the '=====' line down to its closing semicolon).
--   2. Clear the editor, paste that one block, click Run.
--      (Studio only shows the result of the LAST statement, so one block at a time.)
--   3. Copy the result table and paste it back to Claude. Send the answers in any order, in batches.
--   4. If a block shows an ERROR instead of a table, paste the error text - do not retry. Then run the
--      three "CHECK FIRST" blocks at the bottom (Part C) and send those results too.
--
-- Part A = 14 blocks I need first.   Part B = deep-dive blocks, ONLY if I ask for them.
-- Part C = 3 existence checks, only if a block errors.
--
-- Nothing here prints phone numbers, emails, bank / PAN / Aadhaar details. Staff names and salary amounts
-- appear only where the block is about salary.

-- ##############################################################################################
-- PART A - RUN THESE FIRST (14 blocks)
-- ##############################################################################################

-- ==============================================================================================
-- BLOCK 1  [SAL1]  cost: trivial
-- WHAT: Is the old designation-to-salary auto-sync really gone, and which triggers are live on the
-- salary tables?
-- WHY: Decides whether salary can still be reset by the old Phase 64 sync, and whether anything
-- else (hidden trigger) is touching users, designations or staff_incentive_profiles; also tells if
-- the new Phase 327 recorder is installed.
-- HOW TO READ: Sections 1 and 2: every line must say 'gone (good)'. If any line says 'STILL LIVE -
-- STOP', the old auto-sync that silently resets salaries to the designation rate is back - do not
-- edit the Designation rate card and send me the line. Section 3 lists every trigger on the three
-- tables. Normal on 'users': users_auto_incentive_profile and users_agency_deactivate_incentive,
-- plus a few unrelated ones (WhatsApp, handoff etc). On staff_incentive_profiles and designations
-- the normal answer is '(no triggers on this table)' - OR, if you already ran the Phase 327 file,
-- exactly trg_salary_audit_sip and trg_salary_audit_designations (a recorder that only writes a
-- log line, it never changes pay). Any line marked 'UNEXPECTED on a salary table' is a hidden
-- automatic writer: send me that line. Section 4 says whether the Phase 327 recorder is installed;
-- 'NOT installed' means that today nothing records who changes a salary, so the next unexplained
-- salary change will again have no trail.
-- ----------------------------------------------------------------------------------------------
WITH want_trg(tgname) AS (
  VALUES ('tg_users_profile_autosync'), ('tg_designations_salary_propagate')
), want_fn(proname) AS (
  VALUES ('tg_user_profile_autosync'), ('tg_designation_propagate_salary'), ('sync_user_profile_from_designation')
), tr AS (
  SELECT c.relname::text AS tbl, t.tgname::text AS tgname, t.tgenabled::text AS enabled,
         t.tgfoid::regproc::text AS fn, pg_get_triggerdef(t.oid) AS def
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND NOT t.tgisinternal
    AND c.relname IN ('users', 'designations', 'staff_incentive_profiles')
)
SELECT '1_old_sync_trigger' AS section,
       w.tgname AS item,
       'trigger with this name, anywhere in the database' AS detail,
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger x WHERE x.tgname = w.tgname AND NOT x.tgisinternal)
            THEN 'STILL LIVE - STOP' ELSE 'gone (good)' END AS value
FROM want_trg w
UNION ALL
SELECT '2_old_sync_function', w.proname, 'function with this name in schema public',
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                         WHERE n.nspname = 'public' AND p.proname = w.proname)
            THEN 'STILL LIVE - STOP' ELSE 'gone (good)' END
FROM want_fn w
UNION ALL
SELECT '3_trigger_on_table', tb.tbl,
       COALESCE(tr.tgname, '(no triggers on this table)')
         || CASE WHEN tr.tgname IS NULL THEN ''
                 WHEN tr.tgname IN ('trg_salary_audit_sip', 'trg_salary_audit_designations')
                      THEN '  =>  recorder from Phase 327 (expected only if you ran that file)'
                 WHEN tr.tgname = 'users_auto_incentive_profile'
                      THEN '  =>  expected: makes a salary-0 profile for a new sales user'
                 WHEN tr.tgname = 'users_agency_deactivate_incentive'
                      THEN '  =>  expected: switches the profile off when a user becomes agency'
                 WHEN tb.tbl IN ('designations', 'staff_incentive_profiles')
                      THEN '  =>  UNEXPECTED on a salary table - read the definition'
                 ELSE '  =>  other trigger on users (query SAL2 shows whether its function touches salary)' END,
       CASE WHEN tr.tgname IS NULL THEN '-'
            ELSE CASE tr.enabled WHEN 'O' THEN 'enabled' WHEN 'D' THEN 'DISABLED' ELSE 'mode ' || tr.enabled END
                 || ' | runs ' || tr.fn || ' | ' || left(tr.def, 260) END
FROM (VALUES ('users'), ('designations'), ('staff_incentive_profiles')) AS tb(tbl)
LEFT JOIN tr ON tr.tbl = tb.tbl
UNION ALL
SELECT '4_phase327_recorder', 'audit table public.salary_change_audit', 'black-box log of every salary change',
       CASE WHEN to_regclass('public.salary_change_audit') IS NULL
            THEN 'NOT installed (Phase 327 file not run yet)' ELSE 'installed' END
UNION ALL
SELECT '4_phase327_recorder', 'locked backups', '_bak_sip_20261002 and _bak_designations_20261002',
       CASE WHEN to_regclass('public._bak_sip_20261002') IS NOT NULL AND to_regclass('public._bak_designations_20261002') IS NOT NULL
            THEN 'both present'
            WHEN to_regclass('public._bak_sip_20261002') IS NULL AND to_regclass('public._bak_designations_20261002') IS NULL
            THEN 'not present (Phase 327 file not run yet)'
            ELSE 'only ONE of the two is present' END
ORDER BY 1, 2, 3;

-- ==============================================================================================
-- BLOCK 2  [SAL8]  cost: light
-- WHAT: URGENT: people on zero salary who still earn incentive inside Net since September 2026
-- WHY: Decides whether payroll is already paying incentive to zero-salary or profile-less staff
-- right now (with salary 0 the 'must sell 2x salary' bar is 0, so any sale pays 5%/2% plus the Rs
-- 10,000 bonus) and so how urgently the salary-0 bug must be fixed.
-- HOW TO READ: Read the two '1_checks' lines first: both should say true (true = the payroll
-- formula really pays EARNED incentive from Sept 2026, and the helper function is the read-only
-- kind this query calls; if the second says false the query does not call it and the earned column
-- stays blank). Then the '2_summary' line: '0 people / 0 person-months' = GOOD, nobody (other than
-- agency staff, who are not paid through Net and are left out on purpose) is on zero salary with
-- sales since September. Anything above 0 means those people already get incentive inside Net even
-- though their salary is 0: 5% of new-client revenue + 2% of renewal revenue (usual settings) +
-- the flat Rs 10,000 bonus once revenue is above 0. The '3_detail' lines show who, which month,
-- revenue and 'earned_incentive' = what the live engine adds to their Net. A role ending in
-- '(inactive)' is someone who has left; lower priority. For each name decide: commission-only on
-- purpose (leave it), or a forgotten salary (fix the salary - the incentive then needs sales of 2x
-- salary to pay). The 'rate_card' column is the designation default, shown only as a hint. 'NO
-- PROFILE' = sales were booked but the person has no salary profile at all: nothing is computed
-- for them and they are invisible in Salary/Incentives. This covers the incentive part only: Net
-- also adds travel/daily-allowance claims; with salary 0 the base, variable pay and leave
-- deduction are all 0 by the formula, so Net = incentive + allowances. A manager's team-override
-- bonus is not included. If Studio says 'permission denied for function earned_incentive_for',
-- switch the role selector to postgres and re-run.
-- ----------------------------------------------------------------------------------------------
WITH chk AS (
  SELECT
    (SELECT bool_and(p.provolatile IN ('s', 'i')) FROM pg_proc p
      WHERE p.proname = 'earned_incentive_for' AND p.pronamespace = 'public'::regnamespace) AS fn_readonly,
    (SELECT bool_or(p.prosrc ILIKE '%earned_incentive_for%') FROM pg_proc p
      WHERE p.proname = '_compute_monthly_salary_base' AND p.pronamespace = 'public'::regnamespace) AS net_uses_earned
), x AS (
  SELECT u.id AS uid, u.name::text AS name,
         u.role::text || CASE WHEN COALESCE(u.is_active, true) THEN '' ELSE ' (inactive)' END AS role,
         (sip.user_id IS NOT NULL) AS has_profile,
         COALESCE(sip.monthly_salary, 0) AS salary,
         (SELECT dd.default_monthly_salary FROM public.designations dd
           WHERE lower(dd.name) = lower(btrim(u.designation)) LIMIT 1) AS rate_card,
         md.month_year::text AS month_year,
         COALESCE(md.new_client_revenue, 0) AS new_rev,
         COALESCE(md.renewal_revenue, 0) AS ren_rev,
         CASE WHEN (SELECT c.fn_readonly FROM chk c)
              THEN round(public.earned_incentive_for(u.id, md.month_year)) END AS earned
  FROM public.monthly_sales_data md
  JOIN public.users u ON u.id = md.staff_id
  LEFT JOIN public.staff_incentive_profiles sip ON sip.user_id = u.id
  WHERE md.month_year >= '2026-09'
    AND COALESCE(md.new_client_revenue, 0) + COALESCE(md.renewal_revenue, 0) > 0
    AND COALESCE(sip.monthly_salary, 0) <= 0
    AND u.role <> 'agency'
)
SELECT '1_checks' AS section,
       'live Net formula calls earned_incentive_for (Sept 2026 onward)' AS who,
       NULL::text AS role, NULL::text AS profile, NULL::numeric AS salary, NULL::numeric AS rate_card,
       NULL::text AS month_year, NULL::numeric AS new_rev, NULL::numeric AS ren_rev, NULL::numeric AS earned_incentive,
       COALESCE((SELECT c.net_uses_earned::text FROM chk c), 'function not found') AS note
UNION ALL
SELECT '1_checks', 'earned_incentive_for is read-only (stable)', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       COALESCE((SELECT c.fn_readonly::text FROM chk c), 'function not found')
UNION ALL
SELECT '2_summary',
       count(DISTINCT x.uid) || ' people / ' || count(*) || ' person-months',
       NULL, NULL, NULL, NULL, NULL, sum(x.new_rev), sum(x.ren_rev), sum(x.earned),
       'TOTAL incentive that lands in Net for non-agency people on zero salary'
FROM x
UNION ALL
SELECT '3_detail', d.name, d.role,
       CASE WHEN d.has_profile THEN 'profile, salary 0' ELSE 'NO PROFILE' END,
       d.salary, d.rate_card, d.month_year, d.new_rev, d.ren_rev, d.earned,
       CASE WHEN NOT d.has_profile THEN 'no profile: revenue booked but no base and no incentive computed'
            WHEN COALESCE(d.earned, 0) > 0 THEN 'EARNS incentive on zero salary: commission-only or a forgotten salary?'
            ELSE 'zero salary, no incentive computed' END
FROM (SELECT * FROM x ORDER BY x.month_year DESC, x.earned DESC NULLS LAST, x.name LIMIT 60) d
ORDER BY 1, 7 DESC, 10 DESC NULLS LAST, 2;

-- ==============================================================================================
-- BLOCK 3  [SAL9]  cost: trivial
-- WHAT: Active people with no salary profile, or a profile at 0, grouped by role
-- WHY: Finds who is invisible to payroll (no profile) or sitting at salary 0, and whether the
-- pattern points to the HR hire wizard dropping the typed salary for sales hires.
-- HOW TO READ: Section 1: one line per role - how many active people, how many have NO salary
-- profile row, how many have a profile but salary 0/blank. Section 2: the names behind those
-- counts (salary amounts appear only where they are 0/blank). Agency lines are normal
-- (commission-only). 'NO profile' means the person cannot be edited in Incentives and the pay
-- engine computes no base or variable pay for them - fine for people paid outside this system, a
-- gap otherwise (typical: hr, accounts, staff/ops). 'CHECK: sales/telecaller at 0' with a rate
-- card above 0 can be the sign that the salary typed in the HR hire form was lost: for a new sales
-- user the database first creates a salary-0 profile, then the form's own insert hits the same
-- person and its error is only written to the browser console. Send me every name you did not
-- expect to see.
-- ----------------------------------------------------------------------------------------------
WITH base AS (
  SELECT u.id, u.name::text AS name, u.role::text AS role, u.team_role::text AS team_role,
         u.designation::text AS designation, u.created_at,
         (sip.user_id IS NOT NULL) AS has_profile,
         sip.monthly_salary AS salary
  FROM public.users u
  LEFT JOIN public.staff_incentive_profiles sip ON sip.user_id = u.id
  WHERE u.is_active
), flagged AS (
  SELECT * FROM base WHERE NOT has_profile OR COALESCE(salary, 0) <= 0
)
SELECT '1_count_by_role' AS section,
       b.role AS who,
       'active = ' || count(*)
         || ' | no profile row = ' || count(*) FILTER (WHERE NOT b.has_profile)
         || ' | profile but salary 0/blank = ' || count(*) FILTER (WHERE b.has_profile AND COALESCE(b.salary, 0) <= 0) AS detail,
       '' AS note
FROM base b
GROUP BY b.role
UNION ALL
SELECT '2_list',
       f.name || ' (' || f.role || COALESCE(' / ' || f.team_role, '') || ')',
       'designation = ' || COALESCE(f.designation, '(none)')
         || ' | joined ' || COALESCE(f.created_at::date::text, '?')
         || ' | profile = ' || CASE WHEN f.has_profile THEN 'yes, salary ' || COALESCE(f.salary::text, 'blank') ELSE 'NONE' END
         || ' | rate card now = ' || COALESCE((SELECT dd.default_monthly_salary::text FROM public.designations dd
                                              WHERE lower(dd.name) = lower(btrim(f.designation)) LIMIT 1), 'n/a'),
       CASE WHEN f.role = 'agency' THEN 'normal: agency is commission-only'
            WHEN f.role IN ('admin', 'co_owner', 'owner') THEN 'owner-level role: may be intentional'
            WHEN NOT f.has_profile THEN 'NO profile: engine computes no base/variable for this person'
            WHEN f.role IN ('sales', 'telecaller') THEN 'CHECK: sales/telecaller at 0 - incentive pays on ANY revenue; was the salary dropped at hire?'
            ELSE 'CHECK: profile exists but salary is 0/blank' END
FROM (SELECT * FROM flagged ORDER BY has_profile, role, created_at DESC LIMIT 60) f
ORDER BY 1, 2;

-- ==============================================================================================
-- BLOCK 4  [OS2]  cost: trivial
-- WHAT: Salary sheet: which roles does the live 'list everyone' function include, and does it
-- include operations staff?
-- WHY: Decides whether the fix is to widen the role list in compute_monthly_salaries, and whether
-- the live copy even matches the repo file before anything is changed.
-- HOW TO READ: Row 'role list identical to repo' = true means the live function has exactly sales,
-- telecaller, admin, co_owner, same as the repo file; 'body mentions operation_executive' = false
-- confirms operations staff are left out of the Salary sheet by this function (that is the reason
-- they are missing). If 'identical' is false, send me the 'role filter line' row before any
-- change, because the live copy was edited by hand. Last row: the roles allowed to read anybody's
-- salary; expected admin, co_owner, accounts. If operation_head or any other role shows up there,
-- tell me.
-- ----------------------------------------------------------------------------------------------
WITH f AS (
  SELECT p.proname, pg_get_functiondef(p.oid) AS def
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('compute_monthly_salaries', '_assert_self_or_admin')
),
b AS (SELECT def FROM f WHERE proname = 'compute_monthly_salaries'),
g AS (SELECT def FROM f WHERE proname = '_assert_self_or_admin')
SELECT '1 batch RPC' AS section, 'copies found (expect 1)' AS item,
       (SELECT count(*) FROM b)::text AS value
UNION ALL
SELECT '1 batch RPC', 'role filter line in the LIVE body',
       COALESCE((SELECT string_agg(btrim(t.l), '  ||  ')
                   FROM b CROSS JOIN LATERAL regexp_split_to_table(b.def, chr(10)) AS t(l)
                  WHERE t.l ~* 'role[[:space:]]+in[[:space:]]*[(]'), '(function not found)')
UNION ALL
SELECT '1 batch RPC', 'role list identical to repo: sales, telecaller, admin, co_owner',
       COALESCE((SELECT (bool_or(regexp_replace(b.def, '[[:space:]]+', ' ', 'g')
                                 ILIKE '%role IN (''sales'', ''telecaller'', ''admin'', ''co_owner'')%'))::text
                   FROM b), 'function not found')
UNION ALL
SELECT '1 batch RPC', 'body mentions operation_executive',
       COALESCE((SELECT (bool_or(strpos(b.def, 'operation_executive') > 0))::text FROM b), 'function not found')
UNION ALL
SELECT '1 batch RPC', 'body mentions operation_head',
       COALESCE((SELECT (bool_or(strpos(b.def, 'operation_head') > 0))::text FROM b), 'function not found')
UNION ALL
SELECT '1 batch RPC', 'every role name found in the body',
       COALESCE((SELECT string_agg(t.r, ', ' ORDER BY t.r)
                   FROM b CROSS JOIN unnest(ARRAY['admin','co_owner','sales','telecaller','agency','accounts','hr',
                                                  'office_staff','staff','operation_head','operation_executive']) AS t(r)
                  WHERE strpos(b.def, '''' || t.r || '''') > 0), '(none)')
UNION ALL
SELECT '2 salary gate', 'live _assert_self_or_admin: line listing roles allowed to read anyone''s salary',
       COALESCE((SELECT string_agg(btrim(t.l), '  ||  ')
                   FROM g CROSS JOIN LATERAL regexp_split_to_table(g.def, chr(10)) AS t(l)
                  WHERE t.l ~* 'not in[[:space:]]*[(]'), '(function not found)');

-- ==============================================================================================
-- BLOCK 5  [OS8]  cost: light
-- WHAT: Test or placeholder accounts that could become payable
-- WHY: Finds test logins (for example the test operations executive) with a salary, so they can be
-- switched off before they appear on a real payroll sheet.
-- HOW TO READ: Each row is an account whose name or email contains test, dummy, demo, fake,
-- sample, placeholder or example. The email itself is not shown (only its domain and whether the
-- name or the email matched). Danger row: is_active = true AND salary above 0 AND role not on the
-- sheet today (for example an operation_executive with salary 18000): it would get a Payout button
-- once listed, so it must be deactivated or its salary set to 0 first. 'stations_owned' and
-- 'uptime_rows_last_45d' above 0 mean the test account is still attached to real screens or
-- scoring. The old test operations login had a normal-looking name (Ankit) and only its email said
-- testope1, so it shows as matched_on = email; a test login with a normal name AND normal email
-- will not be caught, so also compare against the OS5 roster. Empty result = no obvious test
-- accounts left.
-- ----------------------------------------------------------------------------------------------
WITH t AS (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS today),
p AS (SELECT '(test|dummy|demo|fake|sample|placeholder|example)'::text AS pat)
SELECT u.name, u.role, u.is_active,
       sip.monthly_salary AS salary,
       (sip.user_id IS NOT NULL) AS has_profile,
       CASE WHEN u.name ~* p.pat AND u.email ~* p.pat THEN 'name + email'
            WHEN u.name ~* p.pat THEN 'name'
            ELSE 'email' END AS matched_on,
       split_part(u.email, '@', 2) AS email_domain,
       u.created_at::date AS account_created,
       (SELECT count(*) FROM public.ops_depots d
         WHERE d.assigned_to = u.id AND d.is_active) AS stations_owned,
       (SELECT count(*) FROM public.ops_uptime_daily o
         WHERE o.user_id = u.id AND o.work_date >= t.today - 45) AS uptime_rows_last_45d,
       (SELECT count(*) FROM public.salary_payouts sp WHERE sp.user_id = u.id) AS payout_rows_ever
FROM public.users u
CROSS JOIN t
CROSS JOIN p
LEFT JOIN public.staff_incentive_profiles sip ON sip.user_id = u.id
WHERE u.name ~* p.pat OR u.email ~* p.pat
ORDER BY u.is_active DESC, COALESCE(sip.monthly_salary, 0) DESC, u.name
LIMIT 60;

-- ==============================================================================================
-- BLOCK 6  [OS9]  cost: trivial
-- WHAT: Preview of the people the Salary sheet would newly list (every active role except the 4
-- now shown and agency)
-- WHY: Gives the exact list of newly appearing people with salary status, stations owned and past
-- payout rows, so you can decide who should appear before the role list is widened.
-- HOW TO READ: This list is exactly who would be added to the Salary sheet if the role list were
-- widened to everyone except agency. Read each row: 'Rs 0 row' = harmless but cluttering; 'row
-- with salary + Payout button' = a real payable line. looks_like_test = true must be fixed first
-- (OS8). payout_rows_ever above 0 means somebody already recorded a payout for that person, so
-- tell me how they were paid before. If an operations executive shows stations_owned = 0 and a
-- salary, see OS6. Empty result = nobody is hidden.
-- ----------------------------------------------------------------------------------------------
SELECT u.name, u.role, u.designation, u.created_at::date AS account_created,
       (sip.user_id IS NOT NULL) AS has_profile,
       sip.monthly_salary AS salary,
       (SELECT count(*) FROM public.ops_depots d
         WHERE d.assigned_to = u.id AND d.is_active) AS stations_owned,
       (SELECT count(*) FROM public.salary_payouts sp WHERE sp.user_id = u.id) AS payout_rows_ever,
       (u.name ~* '(test|dummy|demo|fake|sample|placeholder|example)'
        OR u.email ~* '(test|dummy|demo|fake|sample|placeholder|example)') AS looks_like_test,
       CASE WHEN COALESCE(sip.monthly_salary, 0) = 0 THEN 'Rs 0 row (no salary set)'
            ELSE 'row with salary + Payout button' END AS sheet_would_show
FROM public.users u
LEFT JOIN public.staff_incentive_profiles sip ON sip.user_id = u.id
WHERE u.is_active
  AND u.role NOT IN ('sales','telecaller','admin','co_owner','agency')
ORDER BY (u.role LIKE 'operation%') DESC, u.role, u.name
LIMIT 60;

-- ==============================================================================================
-- BLOCK 7  [OS6]  cost: light
-- WHAT: Operations pay readiness for this month and last month: stations owned, measured days, and
-- what the 70/30 formula gives today
-- WHY: Shows who would hit the 'zero measured days pays the full 30% variable' trap, who owns no
-- stations, and what each operations person's base plus variable would be, before they are listed
-- on the Salary sheet.
-- HOW TO READ: Two rows per operations person (this month and last month). 'depots' and 'screens'
-- are today's assignment (not history); the operation_head is scored on whole-network uptime, so 0
-- stations for the head is normal. 'scored_days' = days that actually count toward pay;
-- 'uptime_days' = days with real screen data. If salary is above 0 and scored_days = 0 for LAST
-- month, the flag says TRAP: the pay formula then gives the FULL 30% variable even though nothing
-- was measured, so do not list or pay that person until real days exist. For THIS month an early
-- 'nothing scored yet' is normal (especially on the 1st-2nd). 'CHECK: no stations assigned' on a
-- field executive means their uptime would be 0 or empty. est_base_plus_variable is my copy of the
-- formula (70% base + variable by score: under 50 gives 0, over 75 gives full, between is
-- proportional); it excludes travel, incentive and leave. OS10 gives the live function's own
-- number.
-- ----------------------------------------------------------------------------------------------
WITH t AS (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS today),
m AS (
  SELECT date_trunc('month', t.today::timestamp)::date AS ms, true AS is_current FROM t
  UNION ALL
  SELECT (date_trunc('month', t.today::timestamp) - interval '1 month')::date, false FROM t
),
b AS (
  SELECT u.id, u.name, u.role, m.ms, m.is_current, COALESCE(sip.monthly_salary, 0) AS sal
  FROM public.users u
  CROSS JOIN m
  LEFT JOIN public.staff_incentive_profiles sip ON sip.user_id = u.id
  WHERE u.is_active AND u.role IN ('operation_executive', 'operation_head')
),
x AS (
  SELECT b.*,
    (SELECT count(*) FROM public.ops_depots d
      WHERE d.assigned_to = b.id AND d.is_active) AS depots,
    (SELECT count(*) FROM public.ops_screens s
       JOIN public.ops_depots d ON d.id = s.depot_id
      WHERE d.assigned_to = b.id AND d.is_active AND s.is_active) AS screens,
    (SELECT count(*) FROM public.ops_uptime_daily o
      WHERE o.user_id = b.id AND o.work_date >= b.ms
        AND o.work_date < b.ms + interval '1 month' AND o.screens_total > 0) AS uptime_days,
    (SELECT round(avg(o.uptime_pct), 1) FROM public.ops_uptime_daily o
      WHERE o.user_id = b.id AND o.work_date >= b.ms
        AND o.work_date < b.ms + interval '1 month' AND o.screens_total > 0) AS avg_uptime,
    (SELECT count(*) FROM public.daily_performance p
      WHERE p.user_id = b.id AND p.work_date >= b.ms
        AND p.work_date < b.ms + interval '1 month' AND NOT p.is_excluded) AS scored_days,
    (SELECT avg(p.score_pct) FROM public.daily_performance p
      WHERE p.user_id = b.id AND p.work_date >= b.ms
        AND p.work_date < b.ms + interval '1 month' AND NOT p.is_excluded) AS avg_score
  FROM b
)
SELECT x.name,
       replace(x.role, 'operation_', '') AS role,
       to_char(x.ms, 'YYYY-MM') AS month,
       x.sal AS salary,
       x.depots, x.screens, x.uptime_days, x.avg_uptime, x.scored_days,
       round(x.avg_score, 1) AS avg_score,
       CASE WHEN x.sal = 0 THEN 'no salary set'
            WHEN x.scored_days = 0 THEN 'FULL variable (0 scored days)'
            WHEN x.avg_score < 50 THEN 'ZERO variable'
            WHEN x.avg_score > 75 THEN 'FULL variable'
            ELSE 'proportional' END AS pay_band,
       round(x.sal * 0.70
             + CASE WHEN x.sal = 0 THEN 0
                    WHEN x.scored_days = 0 THEN x.sal * 0.30
                    WHEN x.avg_score < 50 THEN 0
                    WHEN x.avg_score > 75 THEN x.sal * 0.30
                    ELSE (x.avg_score / 100.0) * x.sal * 0.30 END, 0) AS est_base_plus_variable,
       CASE WHEN x.sal = 0 THEN 'no salary: sheet would show Rs 0'
            WHEN x.role = 'operation_executive' AND x.depots = 0 THEN 'CHECK: no stations assigned'
            WHEN x.scored_days = 0 AND x.is_current THEN 'nothing scored yet this month'
            WHEN x.scored_days = 0 THEN 'TRAP: no measured days, full variable'
            ELSE 'ok' END AS flag
FROM x
ORDER BY x.name, x.ms DESC;

-- ==============================================================================================
-- BLOCK 8  [CALLS-1]  cost: light
-- WHAT: Who is on the website (WEB) and who is on the phone app (APK), and how recently each
-- person opened the app
-- WHY: Decides whether the call-capture bugs are really 'some reps never use the APK' (a rollout
-- problem) or 'APK reps whose calls still go wrong' (a code problem).
-- HOW TO READ: channel_at_last_open is what the person's device reported the LAST time they opened
-- the app: WEB = the website, APK = the phone app. Careful: it is last-writer-wins, so a rep who
-- uses the APK all day but opens the website once on a laptop shows WEB. So never judge from that
-- column alone. Two columns prove the APK is really in use: apk_capture_rows_14d (capture-log rows
-- that only the phone app can write) and apk_ingest_rows_7d (call rows the phone scan created
-- itself). If EITHER is above 0 the APK is installed and working for that rep, whatever the chip
-- says. Note apk_ingest_rows_7d can legitimately be 0 for an APK rep who only calls from inside
-- the app, because the scan merges those calls into the rep's own tap row instead of creating a
-- new row. A rep is genuinely web-only only when the chip says WEB (or never reported) AND both
-- apk_capture_rows_14d and apk_ingest_rows_7d are 0 AND the CALLS-2 result shows only 'web' rows
-- for them; none of that rep's calls can be read from the phone. 'APK - older than latest
-- published' with app_version_code below 96018 means that phone lacks the real-time incoming-call
-- listener. hours_since_open of many days means the app has not been opened; push_last_seen_ist is
-- a second 'last seen' signal.
-- ----------------------------------------------------------------------------------------------
WITH latest AS (
  SELECT max(av.version_code) AS code
    FROM public.app_version av
   WHERE av.is_active
)
SELECT u.name AS rep,
       u.role,
       CASE WHEN u.app_version IS NULL THEN '? never reported'
            WHEN u.app_version = 'web' THEN 'WEB (browser / PWA)'
            WHEN latest.code IS NULL THEN 'APK'
            WHEN u.app_version_code >= latest.code THEN 'APK - latest published'
            ELSE 'APK - older than latest published' END AS channel_at_last_open,
       u.app_version,
       u.app_version_code,
       latest.code AS latest_published_code,
       to_char(u.app_version_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon HH24:MI') AS last_app_open_ist,
       round(extract(epoch FROM (now() - u.app_version_at)) / 3600) AS hours_since_open,
       to_char((SELECT max(ps.last_seen_at) FROM public.push_subscriptions ps WHERE ps.user_id = u.id) AT TIME ZONE 'Asia/Kolkata', 'DD Mon HH24:MI') AS push_last_seen_ist,
       (SELECT count(*) FROM public.call_logs cl
         WHERE cl.user_id = u.id AND cl.call_at >= now() - interval '7 days') AS call_rows_7d,
       (SELECT count(*) FROM public.call_logs cl
         WHERE cl.user_id = u.id AND cl.call_at >= now() - interval '7 days'
           AND cl.notes LIKE '%(Phase 56l scan)%') AS apk_ingest_rows_7d,
       (SELECT count(*) FROM public.call_capture_log cc
         WHERE cc.user_id = u.id AND cc.created_at >= now() - interval '14 days'
           AND (cc.patch_path = 'resume_sweep'
                OR cc.device_permission IN ('granted', 'denied', 'prompt', 'error'))) AS apk_capture_rows_14d
  FROM public.users u
  CROSS JOIN latest
 WHERE u.is_active
   AND u.role IN ('sales', 'telecaller', 'operation_executive', 'operation_head')
 ORDER BY channel_at_last_open, u.role, u.name;

-- ==============================================================================================
-- BLOCK 9  [CALLS-5]  cost: moderate
-- WHAT: Calls with no lead attached that SHOULD be on a lead: counts per rep only (last 14 days)
-- WHY: Tells us how much of the 'calls missing from my count' problem is the phone-number format
-- mismatch versus calls that really have no lead, so we know whether fixing lead phone storage is
-- worth doing first.
-- HOW TO READ: Each call counted here has no lead attached. The columns split them by cause (they
-- do not add up to the total because 'several leads' and 'exactly one lead' overlap with the
-- sub-columns). own_lead_but_phone_stored_in_other_format is the key number: the call matches ONE
-- lead that belongs to this very rep, but that lead's phone is saved with 91 in front, a + sign or
-- spaces, and the phone app only links when the lead's phone is exactly the 10 digits. A big
-- number there means fixing the lead phone format (or the matching) would recover those calls.
-- matchable_and_10s_plus is the part of the one-lead matches that would also count toward the
-- 10-second call rule and the hero number. lead_belongs_to_another_rep = the number is a lead
-- owned by someone else, so the call stays unlinked by design. no_lead_has_this_number = the
-- customer is not in leads at all (a fresh or personal number); nothing to fix.
-- number_blank_or_too_short = the call row has no usable number.
-- own_lead_plain_format_still_unlinked should be near 0; if not, the lead was probably created
-- after the call. Only counts are shown, no phone numbers.
-- ----------------------------------------------------------------------------------------------
WITH unl AS (
  SELECT cl.user_id,
         cl.duration_seconds,
         right(regexp_replace(COALESCE(cl.client_phone, ''), '\D', '', 'g'), 10) AS k
    FROM public.call_logs cl
    JOIN public.users u ON u.id = cl.user_id
   WHERE cl.lead_id IS NULL
     AND cl.call_at >= now() - interval '14 days'
     AND u.is_active
     AND u.role IN ('sales', 'telecaller')
),
keys AS (
  SELECT DISTINCT k FROM unl WHERE length(k) = 10
),
lk AS (
  SELECT x.k,
         count(*) AS n_leads,
         (array_agg(l.telecaller_id))[1] AS tc_owner,
         (array_agg(l.assigned_to))[1] AS as_owner,
         bool_and(l.phone ~ '^[0-9]{10}$') AS stored_plain10
    FROM public.leads l
    JOIN keys x ON x.k = right(regexp_replace(l.phone, '\D', '', 'g'), 10)
   WHERE l.phone IS NOT NULL
   GROUP BY x.k
),
j AS (
  SELECT unl.user_id,
         unl.duration_seconds,
         length(unl.k) AS k_len,
         lk.k AS lead_key,
         lk.n_leads,
         lk.stored_plain10,
         COALESCE(lk.tc_owner = unl.user_id OR lk.as_owner = unl.user_id, false) AS lead_is_this_reps
    FROM unl
    LEFT JOIN lk ON lk.k = unl.k
)
SELECT COALESCE(u.name, '** ALL REPS **') AS rep,
       count(*) AS unlinked_calls_14d,
       count(*) FILTER (WHERE j.duration_seconds >= 10) AS of_which_10s_plus,
       count(*) FILTER (WHERE j.k_len < 10) AS number_blank_or_too_short,
       count(*) FILTER (WHERE j.k_len = 10 AND j.lead_key IS NULL) AS no_lead_has_this_number,
       count(*) FILTER (WHERE j.n_leads > 1) AS number_on_several_leads,
       count(*) FILTER (WHERE j.n_leads = 1) AS number_on_exactly_one_lead,
       count(*) FILTER (WHERE j.n_leads = 1 AND j.lead_is_this_reps AND NOT j.stored_plain10) AS own_lead_but_phone_stored_in_other_format,
       count(*) FILTER (WHERE j.n_leads = 1 AND j.lead_is_this_reps AND j.stored_plain10) AS own_lead_plain_format_still_unlinked,
       count(*) FILTER (WHERE j.n_leads = 1 AND NOT j.lead_is_this_reps) AS lead_belongs_to_another_rep,
       count(*) FILTER (WHERE j.n_leads = 1 AND j.duration_seconds >= 10) AS matchable_and_10s_plus
  FROM j
  JOIN public.users u ON u.id = j.user_id
 GROUP BY GROUPING SETS ((u.id, u.name), ())
 ORDER BY GROUPING(u.id), unlinked_calls_14d DESC;

-- ==============================================================================================
-- BLOCK 10  [CALLS-7]  cost: light
-- WHAT: The 'five definitions of calls': the same rep and the same day, side by side (today IST)
-- WHY: Shows with real numbers why the hero ring, the day summary, the WhatsApp brief and the
-- incentive score disagree for one day, so we can pick ONE definition.
-- HOW TO READ: Each row is one rep for one day (today, IST, so a morning run shows a part day; to
-- see a full day change the 0 in the first line 'SELECT 0 AS days_back' to 1 for yesterday). def1
-- = every call record including taps, missed and incoming. def2 = only calls of 10 seconds or
-- more, any lead. def3 = the rule the telecaller hero ring and the day-summary card use (10
-- seconds or more, not missed, and attached to a lead). def4 = the stored daily counter that the
-- owner's WhatsApp brief and the evening scorecard print (built from ALL call records plus call
-- activities that have no call record within 5 seconds, so it should normally be at least def1; if
-- def4 is far above def1 the counter is stale or counting extras, if far below it was not
-- refreshed). def5 = call activity rows (what the rep logged), def5b = those that have an outcome
-- saved. def6 is filled only for telecallers: it is what the telecaller incentive score counts (a
-- call activity with an outcome, OR a 10-second call on the same lead); sales reps are scored on
-- meetings, so def6 is blank for them. Read the gaps: gap_all_rows_minus_screen is taps,
-- no-answers, missed and unlinked calls; if def2 is bigger than def3 the difference is real
-- 10-second calls with no lead attached (see CALLS-5); def6 bigger than def3 means pay counts
-- calls the screen does not.
-- ----------------------------------------------------------------------------------------------
WITH p AS (
  SELECT 0 AS days_back
),
d AS (
  SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date - p.days_back) AS ist_day,
         ((date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') - make_interval(days => p.days_back)) AT TIME ZONE 'Asia/Kolkata') AS t0
    FROM p
),
x AS (
  SELECT u.name AS rep,
         u.role,
         d.ist_day,
         (SELECT count(*) FROM public.call_logs c
           WHERE c.user_id = u.id
             AND c.call_at >= d.t0 AND c.call_at < d.t0 + interval '1 day') AS def1_all_call_log_rows,
         (SELECT count(*) FROM public.call_logs c
           WHERE c.user_id = u.id
             AND c.call_at >= d.t0 AND c.call_at < d.t0 + interval '1 day'
             AND c.duration_seconds >= 10) AS def2_duration_10s_plus,
         (SELECT count(*) FROM public.call_logs c
           WHERE c.user_id = u.id
             AND c.call_at >= d.t0 AND c.call_at < d.t0 + interval '1 day'
             AND c.duration_seconds >= 10
             AND (c.direction IS NULL OR c.direction <> 'missed')
             AND c.lead_id IS NOT NULL) AS def3_screen_kpi_rule,
         (SELECT CASE WHEN (ws.daily_counters ->> 'calls') ~ '^[0-9]+(\.[0-9]+)?$'
                      THEN (ws.daily_counters ->> 'calls')::numeric END
            FROM public.work_sessions ws
           WHERE ws.user_id = u.id AND ws.work_date = d.ist_day) AS def4_stored_counter,
         (SELECT count(*) FROM public.lead_activities la
           WHERE la.created_by = u.id AND la.activity_type = 'call'
             AND la.created_at >= d.t0 AND la.created_at < d.t0 + interval '1 day') AS def5_call_activity_rows,
         (SELECT count(*) FROM public.lead_activities la
           WHERE la.created_by = u.id AND la.activity_type = 'call'
             AND la.created_at >= d.t0 AND la.created_at < d.t0 + interval '1 day'
             AND la.outcome IS NOT NULL) AS def5b_activities_with_outcome,
         CASE WHEN u.role = 'telecaller' THEN
           (SELECT count(*) FROM public.lead_activities la
             WHERE la.created_by = u.id AND la.activity_type = 'call'
               AND la.created_at >= d.t0 AND la.created_at < d.t0 + interval '1 day'
               AND (la.outcome IS NOT NULL
                    OR EXISTS (SELECT 1 FROM public.call_logs c2
                                WHERE c2.user_id = u.id
                                  AND c2.lead_id = la.lead_id
                                  AND c2.call_at >= d.t0 AND c2.call_at < d.t0 + interval '1 day'
                                  AND c2.duration_seconds >= 10
                                  AND (c2.direction IS NULL OR c2.direction <> 'missed'))))
         END AS def6_telecaller_score_basis
    FROM public.users u, d
   WHERE u.is_active
     AND u.role IN ('sales', 'telecaller')
)
SELECT x.rep,
       x.role,
       x.ist_day,
       x.def1_all_call_log_rows,
       x.def2_duration_10s_plus,
       x.def3_screen_kpi_rule,
       x.def4_stored_counter,
       x.def5_call_activity_rows,
       x.def5b_activities_with_outcome,
       x.def6_telecaller_score_basis,
       x.def1_all_call_log_rows - x.def3_screen_kpi_rule AS gap_all_rows_minus_screen,
       x.def4_stored_counter - x.def3_screen_kpi_rule AS gap_stored_counter_minus_screen
  FROM x
 ORDER BY x.role, x.def1_all_call_log_rows DESC, x.rep;

-- ==============================================================================================
-- BLOCK 11  [HR2]  cost: trivial
-- WHAT: What the candidate's public offer page can actually see (live function shape and
-- permissions)
-- WHY: Decides whether the signed offer PDF made in the candidate's browser always falls back to
-- the sales letter, because the public function may not hand over the role information.
-- HOW TO READ: Find the row fetch_offer_by_token. If all four returns_designation_* columns are
-- false, the candidate page never receives the role, so the letter generated when the candidate
-- accepts is always the sales letter, even for operations, telecaller or accounts hires: the bug
-- is confirmed. If all four are true, that bug does not exist. anon_can_run must be true on
-- fetch_offer_by_token, submit_offer_acceptance and is_open_offer_token; if false, candidates
-- cannot open or submit their offer link at all (a separate, bigger problem). If
-- submit_offer_acceptance shows two rows (different arg_count), an old copy was re-run and is a
-- separate problem to report. full_return_shape is the complete list of fields the page receives
-- (field names only, no personal data).
-- ----------------------------------------------------------------------------------------------
select p.proname as function_name,
       p.pronargs as arg_count,
       p.prosecdef as security_definer,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_run,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as logged_in_can_run,
       (pg_get_function_result(p.oid) ilike '%designation_auth_role%') as returns_designation_auth_role,
       (pg_get_function_result(p.oid) ilike '%designation_team_role%') as returns_designation_team_role,
       (pg_get_function_result(p.oid) ilike '%designation_has_incentive%') as returns_designation_has_incentive,
       (pg_get_function_result(p.oid) ilike '%designation_name%') as returns_designation_name,
       pg_get_function_result(p.oid) as full_return_shape
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('fetch_offer_by_token', 'submit_offer_acceptance', 'is_open_offer_token')
order by p.proname, p.pronargs;

-- ==============================================================================================
-- BLOCK 12  [HR3]  cost: trivial
-- WHAT: Accepted and converted offers grouped by role, with the letter each should have had
-- WHY: Shows how many accepted non-sales offers were signed on the wrong (sales) letter, so we
-- know whether old signed PDFs need regenerating.
-- HOW TO READ: Each row is a group of offers. letter_it_should_have is what the app's own rule
-- says the letter should be (sales, telecaller, ops or generic). If a row says ops, telecaller or
-- generic AND HR2 showed fetch_offer_by_token does not return the role, then every offer in that
-- row was signed on the sales letter, which is wrong for that hire: those PDFs need regenerating.
-- Offers with '(none - old offer)' were made before the role feature, so the sales letter was the
-- only letter then (for these the column just says 'sales' because that is what the app falls back
-- to). accepted_since_11_sep counts only offers accepted on or after 11 Sep 2026 (IST), the date
-- the role-letter rules were decided; older ones cannot be affected by the new rules. If every row
-- says sales, nothing needs fixing here. No candidate names or contact details are shown.
-- ----------------------------------------------------------------------------------------------
with x as (
  select o.id, o."position" as position_title, o.status, o.created_at, o.accepted_terms_at, o.offer_pdf_url,
         lower(nullif(btrim(to_jsonb(o) ->> 'designation_auth_role'), '')) as auth_role,
         (to_jsonb(o) ->> 'designation_has_incentive') as has_incentive
  from public.hr_offers o
  where o.status in ('accepted', 'converted_to_user')
), y as (
  select x.*,
         case
           when auth_role in ('operation_executive', 'operation_head') then 'ops'
           when auth_role = 'telecaller' and has_incentive = 'true' then 'telecaller'
           when auth_role = 'sales' and has_incentive = 'true' then 'sales'
           when auth_role is null then 'sales'
           else 'generic'
         end as letter_it_should_have
  from x
)
select status,
       position_title,
       coalesce(auth_role, '(none - old offer)') as designation_auth_role,
       letter_it_should_have,
       count(*) as offers,
       count(*) filter (where offer_pdf_url is not null) as with_signed_pdf,
       count(*) filter (where accepted_terms_at >= timestamptz '2026-09-11 00:00:00+05:30') as accepted_since_11_sep
from y
group by status, position_title, coalesce(auth_role, '(none - old offer)'), letter_it_should_have
order by 1, 2, 3;

-- ==============================================================================================
-- BLOCK 13  [S4]  cost: trivial
-- WHAT: RUN THIS FIRST - can the card-reader result even be saved on a rep's photo? (permissions,
-- columns, newest photo)
-- WHY: Decides whether S1 and S2 are trustworthy for reps: if reps are not allowed to save the
-- reader result onto a photo row, the database can never show whether the reader worked for them.
-- HOW TO READ: Run this before S1 and S2. Section A lists the permission rules on the photo table.
-- Look at the 'detail' column, which starts with the action (SELECT, INSERT, UPDATE or ALL). If
-- you see only SELECT, INSERT and one ALL rule whose condition mentions admin / co_owner, then
-- ordinary reps and telecallers are NOT allowed to save the card-reader result onto their photo.
-- In that case S1 and S2 will show 0 saved results for reps even when the reader works perfectly,
-- so ignore the rep columns there and use only the admin columns. If you see an UPDATE (or ALL)
-- rule that also covers sales or telecaller (or the condition is just true), the rep numbers in
-- S1/S2 are meaningful. 'row security switched on?' should say yes. Section B: the lead_photos
-- line should list ocr_fields, ocr_text, is_business_card, created_by and created_at; the users
-- line should show 6; the app_version line should show 7. If any count is lower, send me that
-- line: the matching query would fail with 'column does not exist'. Section C: the date of the
-- newest photo. If it is weeks old, nobody uses the photo button on a lead page, and S1/S2 have
-- nothing to judge. Section D: for the last 45 days, per role (admin, co_owner, sales, telecaller,
-- ...), value = photos taken and detail = on how many of them the reader result was saved. GOOD:
-- sales and telecaller rows also show saved results close to the photo count. If admin/co_owner
-- rows show saved results but sales/telecaller show 'saved on 0' while having many photos, the
-- permission gap is real: the database cannot tell us if the reader works for reps, and the Edge
-- function logs plus a live tap test are the only real check. Note: none of these numbers cover
-- the Scan card button on the New Lead page, which saves nothing.
-- ----------------------------------------------------------------------------------------------
SELECT section, item, detail, value
FROM (
  SELECT 'A. who may change a saved photo row (policies on lead_photos)' AS section, 1 AS ord,
         policyname::text AS item,
         (cmd::text || ' | ' || permissive::text || ' | roles=' || COALESCE(array_to_string(roles, ','), '-')) AS detail,
         left(COALESCE(qual, '(no condition)'), 120) AS value
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'lead_photos'
  UNION ALL
  SELECT 'A. who may change a saved photo row (policies on lead_photos)', 2,
         'row security switched on?', 'relrowsecurity',
         CASE WHEN c.relrowsecurity THEN 'yes' ELSE 'NO' END
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'lead_photos'
  UNION ALL
  SELECT 'B. columns the other queries need', 3,
         'lead_photos columns found (expect ocr_fields, ocr_text, is_business_card, created_by, created_at among them)',
         string_agg(column_name::text, ', ' ORDER BY ordinal_position),
         count(*)::text
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'lead_photos'
  UNION ALL
  SELECT 'B. columns the other queries need', 4,
         'users columns found (expect 6: app_version, app_version_code, app_version_at, role, is_active, name)',
         string_agg(column_name::text, ', ' ORDER BY column_name),
         count(*)::text
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'users'
     AND column_name IN ('app_version', 'app_version_code', 'app_version_at', 'role', 'is_active', 'name')
  UNION ALL
  SELECT 'B. columns the other queries need', 5,
         'app_version table columns found (expect 7)',
         string_agg(column_name::text, ', ' ORDER BY column_name),
         count(*)::text
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'app_version'
     AND column_name IN ('version_code', 'version_name', 'apk_url', 'changelog', 'mandatory', 'is_active', 'created_at')
  UNION ALL
  SELECT 'C. whole lead_photos table', 6,
         'total photo rows ever, with oldest and newest (IST)',
         'oldest ' || COALESCE(to_char(min(created_at) AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY'), '-')
           || ' | newest ' || COALESCE(to_char(max(created_at) AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY HH24:MI'), '-'),
         count(*)::text
    FROM public.lead_photos
  UNION ALL
  SELECT 'D. last 45 days: photos by who took them', 7,
         COALESCE(u.role::text, '(uploader unknown)'),
         'reader result saved on ' || (count(*) FILTER (WHERE lp.ocr_fields IS NOT NULL))::text || ' of them',
         count(*)::text
    FROM public.lead_photos lp
    LEFT JOIN public.users u ON u.id = lp.created_by
   WHERE lp.created_at >= now() - interval '45 days'
   GROUP BY u.role
) s
ORDER BY section, ord, item
LIMIT 60;

-- ==============================================================================================
-- BLOCK 14  [S3]  cost: trivial
-- WHAT: Which app build is each active person on, can the next build (96019) reach them, and what
-- the in-app updater is offering
-- WHY: Answers who is on 96018 vs older vs web vs never reported, whether a 96019 release would
-- reach them through the in-app Update banner, and what APK row is actually published.
-- HOW TO READ: Section A: one row per app build, with the names of the active people on it and, in
-- brackets, how many days ago each last opened the app (the app reports its build every time it
-- opens, so 'web (3d)' means last seen on web 3 days ago; an old number may just mean a
-- long-absent person). value = how many people. Section B treats 96019 as the next release (even
-- if it is not published yet) and sorts people into: 1 already on it or newer; 2 on 96014+ -> will
-- see the yellow Update banner and install in two taps; 3 older than 96014 -> banner shows but
-- Update only opens a browser download; 4 web/PWA -> never needs the APK; 5 NEVER REPORTED -> we
-- cannot tell, they have not opened the app since version reporting went live (6 Jul 2026) or
-- their app cannot read its own version - chase these personally; 6 unreadable. Section C: the APK
-- rows in the update table, newest first, plus a line 'LATEST ACTIVE' showing the number the
-- banner compares against. The banner only appears when the highest ACTIVE code is above the
-- phone's installed code. If 96019 is not listed as ACTIVE in section C, nothing will reach anyone
-- yet and section B is a what-if. An old row such as 96014 still marked ACTIVE is harmless (the
-- banner uses the highest ACTIVE number). Watch for a big group in 5 or 3: those are the people a
-- new release will not reach cleanly. Run S4 first if this query errors with 'column does not
-- exist'.
-- ----------------------------------------------------------------------------------------------
WITH nxt AS (SELECT 96019 AS next_code),
latest AS (SELECT max(version_code) AS code FROM public.app_version WHERE is_active),
act AS (
  SELECT u.name, u.app_version, u.app_version_code, u.app_version_at,
         CASE WHEN u.app_version_at IS NULL THEN '?'
              ELSE floor(extract(epoch FROM (now() - u.app_version_at)) / 86400)::int::text || 'd' END AS seen_ago,
         CASE
           WHEN u.app_version IS NULL THEN '5 NEVER REPORTED - cannot confirm which build'
           WHEN u.app_version = 'web' THEN '4 web / PWA - no banner, updates via Vercel on reload'
           WHEN COALESCE(u.app_version_code, 0) <= 0 THEN '6 APK build number unreadable (code 0)'
           WHEN u.app_version_code >= (SELECT next_code FROM nxt) THEN '1 APK already on the next build or newer'
           WHEN u.app_version_code >= 96014 THEN '2 APK 96014+ - sees banner, in-app 2-tap install'
           ELSE '3 APK older than 96014 - sees banner, Update = browser download only'
         END AS reach
    FROM public.users u
   WHERE u.is_active
)
SELECT section, item, detail, value
FROM (
  SELECT 'A. build each active user last reported' AS section,
         (- COALESCE(app_version_code, 0))::bigint AS ord,
         COALESCE(app_version, '(never reported)') || COALESCE(' / code ' || app_version_code::text, '') AS item,
         string_agg(name || ' (' || seen_ago || ')', ', ' ORDER BY name) AS detail,
         count(*)::text AS value
    FROM act
   GROUP BY app_version, app_version_code
  UNION ALL
  SELECT 'B. can the NEXT build (96019) reach them', left(reach, 1)::bigint, substr(reach, 3),
         string_agg(name, ', ' ORDER BY name), count(*)::text
    FROM act
   GROUP BY reach
  UNION ALL
  SELECT 'C. APK rows the in-app updater reads (app_version table)', (- version_code)::bigint,
         'code ' || version_code || ' / ' || version_name,
         left(apk_url, 70) || ' | created ' || to_char(created_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY')
           || CASE WHEN mandatory THEN ' | MANDATORY' ELSE '' END
           || COALESCE(' | ' || left(changelog, 60), ''),
         CASE WHEN is_active THEN 'ACTIVE' ELSE 'inactive' END
    FROM public.app_version
  UNION ALL
  SELECT 'C. APK rows the in-app updater reads (app_version table)', -999999999::bigint,
         'LATEST ACTIVE code (what the banner compares against)',
         'banner shows only to APK users whose installed code is lower than this',
         COALESCE((SELECT code::text FROM latest), 'NONE - banner never shows')
) s
ORDER BY section, ord, item
LIMIT 60;

-- ##############################################################################################
-- PART B - DEEP DIVE (run only when Claude asks for a specific block id)
-- ##############################################################################################

-- ==============================================================================================
-- BLOCK 15  [SAL2]  cost: light
-- WHAT: Which database functions can write a salary profile or read the designation rate card?
-- WHY: Finds any function (including ones pasted by hand in Studio that the repo never saw) that
-- could change a salary automatically, and shows whether it runs by itself from a trigger.
-- HOW TO READ: One line per function that can edit staff_incentive_profiles, mentions the
-- designation rate-card column, or carries one of the three old sync names. The 'verdict' column
-- does the judging. Normal answer: auto_create_incentive_profile and
-- deactivate_incentive_on_agency_flip (neither touches the salary amount), plus log_salary_change
-- if you ran Phase 327 (it only writes the audit log; it shows up as 'reads designations rate
-- card' because it copies the old/new value into the log). A line saying 'NOT KNOWN' is a function
-- nobody told us about that touches salaries - send me its name. A line saying 'STOP' means the
-- old auto-sync is installed. 'fires_automatically_from_trigger' shows a table.trigger name when
-- the function runs by itself on every edit, and '-' when it only runs if someone calls it.
-- 'volatile (can write)' vs 'stable (read-only)' is the database's own label. The search is for
-- words in the function text, so a function that builds its SQL from pieces could be missed; the
-- 'builds SQL text' flag catches only the ones that also name the table. If Studio shows a
-- 'potential issue' pop-up anyway, it is a false alarm - this query only reads; click Run.
-- ----------------------------------------------------------------------------------------------
WITH f AS (
  SELECT n.nspname::text AS sch, p.proname::text AS proname,
         pg_get_function_identity_arguments(p.oid) AS args,
         p.prosecdef, p.provolatile::text AS vol, p.oid AS fn_oid,
         (p.prosrc ~* '(ins[e]rt[[:space:]]+into|upd[a]te|del[e]te[[:space:]]+from|mer[g]e[[:space:]]+into|trunc[a]te)[[:space:]]+(table[[:space:]]+)?(only[[:space:]]+)?(public[.])?.?staff_incentive_profiles') AS writes_profile,
         (p.prosrc ILIKE '%default_monthly_salary%') AS reads_rate_card,
         (p.proname IN ('sync_user_profile_from_designation', 'tg_user_profile_autosync', 'tg_designation_propagate_salary')) AS old_sync_name,
         (p.prosrc ILIKE '%staff_incentive_profiles%' AND p.prosrc ~* 'ex[e]cute[[:space:]]') AS dynamic_sql_mentions_profile
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND p.prokind IN ('f', 'p')
)
SELECT 'function' AS kind,
       f.sch || '.' || f.proname || '(' || f.args || ')' AS name,
       concat_ws(', ',
         CASE WHEN f.writes_profile THEN 'WRITES staff_incentive_profiles' END,
         CASE WHEN f.reads_rate_card THEN 'reads designations rate card' END,
         CASE WHEN f.old_sync_name THEN 'OLD SYNC NAME - should be gone' END,
         CASE WHEN f.dynamic_sql_mentions_profile THEN 'mentions profile table + builds SQL text (review)' END) AS what_it_does,
       CASE WHEN f.prosecdef THEN 'security definer' ELSE 'invoker' END AS runs_as,
       CASE f.vol WHEN 'v' THEN 'volatile (can write)' WHEN 's' THEN 'stable (read-only)' ELSE 'immutable' END AS volatility,
       COALESCE((SELECT string_agg(DISTINCT c.relname::text || '.' || t.tgname::text
                                   || CASE WHEN t.tgenabled::text = 'D' THEN ' (DISABLED)' ELSE '' END, ', ')
                 FROM pg_trigger t
                 JOIN pg_class c ON c.oid = t.tgrelid
                 WHERE t.tgfoid = f.fn_oid AND NOT t.tgisinternal), '-') AS fires_automatically_from_trigger,
       CASE WHEN f.old_sync_name THEN 'STOP: the old auto-sync is still installed'
            WHEN f.proname = 'auto_create_incentive_profile' THEN 'expected: adds a salary-0 profile for a new sales user'
            WHEN f.proname = 'deactivate_incentive_on_agency_flip' THEN 'expected: only switches the profile off when a user becomes agency'
            WHEN f.proname = 'log_salary_change' THEN 'expected only if Phase 327 was run: writes the audit log, never the salary'
            ELSE 'NOT KNOWN - send me this name' END AS verdict
FROM f
WHERE f.writes_profile OR f.reads_rate_card OR f.old_sync_name OR f.dynamic_sql_mentions_profile
UNION ALL
SELECT 'view', v.schemaname::text || '.' || v.viewname::text,
       'definition mentions staff_incentive_profiles or default_monthly_salary', '-', '-', '-',
       'a view cannot change salary by itself - check only if it has an edit rule/trigger'
FROM pg_views v
WHERE v.schemaname NOT IN ('pg_catalog', 'information_schema')
  AND (v.definition ILIKE '%staff_incentive_profiles%' OR v.definition ILIKE '%default_monthly_salary%')
ORDER BY 1, 2
LIMIT 60;

-- ==============================================================================================
-- BLOCK 16  [SAL3]  cost: trivial
-- WHAT: Event triggers, and is scheduled-jobs (pg_cron) available?
-- WHY: Answers whether any database-level hook other than normal triggers exists, and tells you
-- whether the cron query (SAL4) can be run safely.
-- HOW TO READ: Event triggers: Supabase installs several of its own (names like pgrst_ddl_watch,
-- pgrst_drop_watch, graphql..., issue_...). They only react when someone changes the database
-- STRUCTURE, never when a salary row is edited, so they cannot be what changes a salary; only a
-- name you do not recognise is worth sending me. The pg_cron lines say yes/NO. If 'table cron.job
-- visible?' says NO, skip query SAL4 (it would error) and tell me - scheduled jobs then cannot be
-- inspected from Studio. If it says yes, run SAL4.
-- ----------------------------------------------------------------------------------------------
SELECT '1_event_trigger' AS section,
       e.evtname::text AS item,
       'fires on ' || e.evtevent::text || ' (runs on schema/login events, never on row edits)' AS detail,
       CASE e.evtenabled::text WHEN 'D' THEN 'DISABLED' ELSE 'enabled' END || ' | runs ' || e.evtfoid::regproc::text AS value
FROM pg_event_trigger e
UNION ALL
SELECT '2_pg_cron', 'extension pg_cron installed?', '-',
       CASE WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN 'yes' ELSE 'NO' END
UNION ALL
SELECT '2_pg_cron', 'table cron.job visible?', '-',
       CASE WHEN to_regclass('cron.job') IS NULL THEN 'NO - skip query SAL4' ELSE 'yes - run query SAL4' END
ORDER BY 1, 2;

-- ==============================================================================================
-- BLOCK 17  [SAL4]  cost: trivial
-- WHAT: List every scheduled job (secrets hidden) and flag any that mention salary
-- WHY: A scheduled job is the classic way something 'changes salary at the same time every day
-- with no one logged in'; this shows whether any job could.
-- HOW TO READ: Run this only if SAL3 said cron.job is visible. One line per scheduled job. Two
-- True/False columns matter: mentions_salary_words = true means the job's text contains salary /
-- incentive / designation / payout - send me that job. has_direct_write_words = true means the job
-- contains raw edit statements instead of just calling a named function: normal for clean-up jobs,
-- suspicious only if the same job also mentions salary. first_function_called shows what it runs
-- (a follow-up or push dispatcher is harmless). 'active' = true means the job is switched on. Good
-- result: no job has mentions_salary_words = true. The job text itself is NOT printed on purpose,
-- because some jobs carry service keys. If Studio shows a 'potential issue' pop-up, it is a false
-- alarm - the query only reads.
-- ----------------------------------------------------------------------------------------------
SELECT j.jobid,
       j.jobname,
       j.schedule,
       to_jsonb(j) ->> 'active' AS active,
       COALESCE(substring(j.command from '(?i)select[[:space:]]+(?:[a-z_0-9]+[.])?([a-z_0-9]+)'), '(not a plain call)') AS first_function_called,
       ((COALESCE(j.jobname, '') || ' ' || j.command) ~* '(salary|incentive|designation|payout)') AS mentions_salary_words,
       (j.command ~* '(ins[e]rt|upd[a]te|del[e]te)[[:space:]]') AS has_direct_write_words
FROM cron.job j
ORDER BY j.jobid
LIMIT 100;

-- ==============================================================================================
-- BLOCK 18  [SAL5]  cost: trivial
-- WHAT: Who is allowed to change salaries and the designation rate card (row security rules)?
-- WHY: Shows exactly which roles can write staff_incentive_profiles and designations in the live
-- database, so we can see whether a role (co_owner, hr, accounts) or a re-pasted old policy is
-- opening a write path.
-- HOW TO READ: Section 1: row security must say 'true' for both tables (false = the API could
-- read/write everything). Section 2: Supabase hands every table full privileges to 'anon' and
-- 'authenticated' by default, so seeing INSERT/UPDATE/DELETE there is NORMAL - row security
-- (section 3) is the real gate. Section 3 lists every rule. Expected on staff_incentive_profiles:
-- sip_admin_all (admin only), sip_hr_write (hr; the words admin/co_owner appear only because HR is
-- BLOCKED from those rows - read the USING text), staff_incentive_profiles_accounts_all
-- (accounts), and two 'read only' rules (sip_sales_own, sip_sales_read_own) limited to the
-- person's own row. Expected on designations: des_read_all (read only, everyone logged in) and
-- des_admin_write (admin, co_owner, hr can write the rate card). Red flags: a write rule on
-- staff_incentive_profiles that names owner or co_owner as allowed (an old re-pasted policy), a
-- rule name not listed here, or a rule with no role words and no auth.uid() - send me that line.
-- Note the repo shows co_owner can edit the rate card but NOT individual salaries; if the live
-- result differs, that is a finding.
-- ----------------------------------------------------------------------------------------------
SELECT '1_row_security_switch' AS section,
       c.relname::text AS item,
       'row security on = ' || c.relrowsecurity::text || ' | forced even for table owner = ' || c.relforcerowsecurity::text AS detail,
       '-' AS value
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('staff_incentive_profiles', 'designations')
UNION ALL
SELECT '2_table_grants',
       tp.grantee::text || ' on ' || tp.table_name::text,
       string_agg(tp.privilege_type::text, ', ' ORDER BY tp.privilege_type::text),
       '(row policies below still decide which rows)'
FROM information_schema.table_privileges tp
WHERE tp.table_schema = 'public'
  AND tp.table_name IN ('staff_incentive_profiles', 'designations')
  AND tp.grantee IN ('anon', 'authenticated', 'PUBLIC')
GROUP BY tp.grantee, tp.table_name
UNION ALL
SELECT '3_policy',
       p.tablename::text || ' / ' || p.policyname::text,
       p.cmd::text || ' | for ' || p.roles::text || ' | USING ' || COALESCE(p.qual, '-') || ' | CHECK ' || COALESCE(p.with_check, '-'),
       CASE WHEN p.cmd = 'SELECT' THEN 'read only'
            ELSE 'CAN WRITE - role words in rule: '
                 || COALESCE(NULLIF(concat_ws(', ',
                      CASE WHEN x.e ILIKE '%''admin''%' THEN 'admin' END,
                      CASE WHEN x.e ILIKE '%''co_owner''%' THEN 'co_owner' END,
                      CASE WHEN x.e ILIKE '%''owner''%' THEN 'owner' END,
                      CASE WHEN x.e ILIKE '%''hr''%' THEN 'hr' END,
                      CASE WHEN x.e ILIKE '%''accounts''%' THEN 'accounts' END,
                      CASE WHEN x.e ILIKE '%''sales''%' THEN 'sales' END,
                      CASE WHEN x.e ILIKE '%''sales_manager''%' THEN 'sales_manager' END,
                      CASE WHEN x.e ILIKE '%''telecaller''%' THEN 'telecaller' END,
                      CASE WHEN x.e ILIKE '%''agency''%' THEN 'agency' END,
                      CASE WHEN x.e ILIKE '%auth.uid()%' THEN 'own row only' END), ''),
                    'none named - read the USING text')
       END
FROM pg_policies p
CROSS JOIN LATERAL (SELECT COALESCE(p.qual, '') || ' ' || COALESCE(p.with_check, '') AS e) x
WHERE p.schemaname = 'public' AND p.tablename IN ('staff_incentive_profiles', 'designations')
ORDER BY 1, 2;

-- ==============================================================================================
-- BLOCK 19  [SAL6]  cost: trivial
-- WHAT: Salary table columns, defaults, and is there any change history at all?
-- WHY: Confirms the default values new rows get (salary 0), whether any 'last changed' column
-- exists, and which other tables hold a salary-like value or could hold history.
-- HOW TO READ: Section 1: every column of the two tables with its default. Expected:
-- staff_incentive_profiles.monthly_salary default 0 (so any code path that creates a profile
-- without a salary leaves 0), designations.default_monthly_salary default 0. Section 2 answers
-- 'does anything remember when a salary changed?': the repo says staff_incentive_profiles has NO
-- updated_at and NO updated_by (only join_date and last_increment_date); if section 2 shows 'no'
-- for both, there is no way today to tell when or by whom a salary was edited. Section 3: other
-- tables with a salary-like column. Expected: hr_offers.fixed_salary_monthly (and perhaps ops
-- tables). A salary column on 'users' or on a table you do not recognise = another place pay can
-- come from; send me it. Section 4: tables that could hold history. salary_payouts, salary_policy,
-- incentive_payouts, incentive_settings and staff_incentive_profiles are normal;
-- salary_change_audit, _bak_sip_20261002 and _bak_designations_20261002 appear ONLY if the Phase
-- 327 file has been run.
-- ----------------------------------------------------------------------------------------------
SELECT '1_columns' AS section,
       c.table_name::text || '.' || c.column_name::text AS item,
       c.data_type::text || ' | default ' || COALESCE(c.column_default::text, '(none)') || ' | nullable ' || c.is_nullable::text AS detail
FROM information_schema.columns c
WHERE c.table_schema = 'public' AND c.table_name IN ('staff_incentive_profiles', 'designations')
UNION ALL
SELECT '2_history_columns_present', t.tbl,
       'updated_at: ' || CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns c
                                           WHERE c.table_schema = 'public' AND c.table_name = t.tbl AND c.column_name = 'updated_at')
                              THEN 'YES' ELSE 'no' END
       || ' | updated_by: ' || CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns c
                                                 WHERE c.table_schema = 'public' AND c.table_name = t.tbl AND c.column_name = 'updated_by')
                                    THEN 'YES' ELSE 'no' END
       || ' | created_at: ' || CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns c
                                                 WHERE c.table_schema = 'public' AND c.table_name = t.tbl AND c.column_name = 'created_at')
                                    THEN 'YES' ELSE 'no' END
FROM (VALUES ('staff_incentive_profiles'), ('designations')) AS t(tbl)
UNION ALL
SELECT '3_other_salary_like_columns',
       c.table_name::text || '.' || c.column_name::text,
       c.data_type::text || ' | default ' || COALESCE(c.column_default::text, '(none)')
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.column_name ~* '(salary|ctc|wage)'
  AND c.table_name NOT IN ('staff_incentive_profiles', 'designations')
UNION ALL
SELECT '4_tables_that_could_hold_history', t.table_name::text, t.table_type::text
FROM information_schema.tables t
WHERE t.table_schema = 'public'
  AND t.table_name ~* '(audit|history|revision|salary|payout|incentive|^_bak_)'
ORDER BY 1, 2
LIMIT 120;

-- ==============================================================================================
-- BLOCK 20  [SAL7]  cost: trivial
-- WHAT: Current designation rate-card salaries and how many active people use each designation
-- WHY: Shows the numbers that pre-fill the HR hire form and offer-letter form, so we can see which
-- rate-card values are wrong or 0 before fixing the pre-fill.
-- HOW TO READ: This is the rate card, about 15 rows. It is only a PRE-FILL: the HR hire form and
-- the offer-letter form copy it into the salary box when HR picks a designation. Since Phase 213
-- nothing copies it onto an existing person. Compare each number with what you really pay for that
-- job. A rate_card_salary of 0 means the pre-fill gives nothing.
-- 'active_people_with_this_designation' counts active staff whose designation text matches that
-- row; 0 means the row is unused. If you see two near-identical names (different spelling or
-- capital letters), people typed with the wrong spelling will not match - tell me.
-- ----------------------------------------------------------------------------------------------
SELECT d.display_order,
       d.name,
       d.auth_role,
       d.team_role,
       d.default_monthly_salary AS rate_card_salary,
       d.has_incentive,
       d.is_active,
       (SELECT count(*) FROM public.users u
         WHERE u.is_active AND lower(btrim(u.designation)) = lower(btrim(d.name))) AS active_people_with_this_designation
FROM public.designations d
ORDER BY d.display_order, d.name;

-- ==============================================================================================
-- BLOCK 21  [SAL10]  cost: trivial
-- WHAT: How many people's salary is exactly their designation rate card (rate-card pre-fill
-- spread)
-- WHY: People whose salary equals the rate card to the rupee are the ones who took the pre-fill,
-- and the only ones the old auto-sync could have silently reverted; shows how widely the rate card
-- drives real pay.
-- HOW TO READ: Section 1 counts active people with a salary profile by bucket: equals_rate_card
-- (salary exactly the designation default), below_rate_card, above_rate_card, salary_zero,
-- no_designation_match (their designation text matches no rate-card row so they cannot be
-- compared). Section 2 is the same split per designation, with the rate-card amount (no individual
-- salaries). Section 3 names the people whose salary equals the rate card exactly (no amount
-- printed; the amount is the rate card shown in section 2) - check each name against what you
-- agreed with that person; if you remember agreeing a different number, the old auto-sync (or the
-- pre-fill) overwrote it. If most people are in this bucket, the rate card is effectively driving
-- payroll. Section 4 names people whose designation text matches nothing (for example a blank
-- designation). This is deliberately not a payroll dump.
-- ----------------------------------------------------------------------------------------------
WITH j AS (
  SELECT u.name::text AS name, u.role::text AS role, u.designation::text AS designation,
         sip.monthly_salary AS salary, d.name AS d_name, COALESCE(d.default_monthly_salary, 0) AS rate_card
  FROM public.users u
  JOIN public.staff_incentive_profiles sip ON sip.user_id = u.id
  LEFT JOIN LATERAL (
    SELECT dd.name::text AS name, dd.default_monthly_salary
    FROM public.designations dd
    WHERE lower(dd.name) = lower(btrim(u.designation))
    ORDER BY dd.is_active DESC, dd.name
    LIMIT 1
  ) d ON true
  WHERE u.is_active
), tagged AS (
  SELECT j.*,
         CASE WHEN j.d_name IS NULL THEN 'no_designation_match'
              WHEN COALESCE(j.salary, 0) = 0 THEN 'salary_zero'
              WHEN j.salary = j.rate_card THEN 'equals_rate_card'
              WHEN j.salary < j.rate_card THEN 'below_rate_card'
              ELSE 'above_rate_card' END AS bucket
  FROM j
)
SELECT '1_totals' AS section, t.bucket AS item, count(*) AS n, '' AS detail
FROM tagged t
GROUP BY t.bucket
UNION ALL
SELECT '2_by_designation', t.d_name, count(*),
       'rate card ' || max(t.rate_card)::text
         || ' | equal ' || count(*) FILTER (WHERE t.bucket = 'equals_rate_card')
         || ' | below ' || count(*) FILTER (WHERE t.bucket = 'below_rate_card')
         || ' | above ' || count(*) FILTER (WHERE t.bucket = 'above_rate_card')
         || ' | zero ' || count(*) FILTER (WHERE t.bucket = 'salary_zero')
FROM tagged t
WHERE t.d_name IS NOT NULL
GROUP BY t.d_name
UNION ALL
SELECT '3_salary_equals_rate_card', t.name, NULL::bigint,
       t.role || ' | ' || t.d_name || ' | salary equals the rate card exactly'
FROM tagged t
WHERE t.bucket = 'equals_rate_card'
UNION ALL
SELECT '4_designation_text_matches_nothing', t.name, NULL::bigint,
       t.role || ' | designation text: ' || COALESCE(t.designation, '(blank)')
FROM tagged t
WHERE t.bucket = 'no_designation_match'
ORDER BY 1, 2
LIMIT 100;

-- ==============================================================================================
-- BLOCK 22  [SAL11]  cost: trivial
-- WHAT: Forensics: which salary rows were written together, and when (only if the database kept
-- it)
-- WHY: Without any audit trail this is the only way to see whether many salary rows were changed
-- in ONE bulk write (the fingerprint of an automatic writer) or one by one by hand.
-- HOW TO READ: Section 1: how many times the two salary tables were written since the database's
-- counters were last reset (a restart or crash resets them, so treat it as a hint). An 'edits'
-- number far above the number of times you remember editing salaries suggests something is writing
-- automatically. Section 2: whether Postgres records commit times at all (setting
-- track_commit_timestamp). Section 3: each salary profile grouped by the single database
-- transaction that last wrote it. If many names share ONE transaction line, they were changed
-- together by one bulk statement (a script, a mass update, a trigger) - that is the fingerprint of
-- an automatic change, so tell me the time and the names. If every person sits in their own
-- transaction, they were edited one by one by hand. When the setting is 'on' each line shows its
-- time in Indian time; when 'off' it says 'time unknown' and only the grouping is useful. No
-- salary amounts are printed.
-- ----------------------------------------------------------------------------------------------
WITH s AS (
  SELECT current_setting('track_commit_timestamp', true) AS tct
), w AS (
  SELECT sip.xmin::text AS xid_txt, u.name::text AS name,
         CASE WHEN (SELECT s.tct FROM s) = 'on' THEN pg_xact_commit_timestamp(sip.xmin) END AS committed_at
  FROM public.staff_incentive_profiles sip
  JOIN public.users u ON u.id = sip.user_id
)
SELECT '1_table_counters_since_stats_reset' AS section,
       st.relname::text AS item,
       'new rows ' || st.n_tup_ins || ' | edits ' || st.n_tup_upd || ' | removed rows ' || st.n_tup_del || ' | live rows ' || st.n_live_tup AS detail
FROM pg_stat_user_tables st
WHERE st.schemaname = 'public' AND st.relname IN ('staff_incentive_profiles', 'designations')
UNION ALL
SELECT '2_commit_timestamps', 'track_commit_timestamp',
       COALESCE((SELECT s.tct FROM s), '(unknown)')
       || CASE WHEN (SELECT s.tct FROM s) = 'on'
               THEN ' - write times below are real, but only for writes made AFTER it was switched on'
               ELSE ' - OFF: Postgres keeps no record of WHEN salary rows were last written (batches below still show WHICH rows were written together)' END
UNION ALL
SELECT '3_profile_rows_by_last_write',
       COALESCE(to_char(max(w.committed_at) AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI'), 'time unknown') || ' (transaction ' || w.xid_txt || ')',
       count(*) || ' profile row(s) last written together: ' || left(string_agg(w.name, ', ' ORDER BY w.name), 220)
FROM w
GROUP BY w.xid_txt
ORDER BY 1, 2 DESC
LIMIT 60;

-- ==============================================================================================
-- BLOCK 23  [SAL12]  cost: trivial
-- WHAT: HR offer salary versus live salary, for people created from an offer
-- WHY: Tests the idea that the salary written in the signed offer never reached (or later drifted
-- from) the live salary profile, which is another way a salary can be wrong or look like it
-- changed itself.
-- HOW TO READ: The summary line comes first: how many active people were created through an HR
-- offer, how many have a live salary different from the offer, how many have no profile. The list
-- shows name, offer salary and live salary. 'live salary is 0 although the offer had a salary' or
-- 'no profile row at all' = a salary that never reached payroll (a bug, fix by hand). 'live is
-- LOWER than the offer' = either an agreed change or the old auto-sync reverting it - confirm with
-- the person. 'higher' is normally an increment. A difference is NOT automatically a bug, because
-- salaries change after hiring. This only covers people created with the offer 'convert to user'
-- button; people created through the HR New User wizard are not linked to an offer.
-- ----------------------------------------------------------------------------------------------
WITH conv AS (
  SELECT u.name::text AS name, o.status::text AS offer_status,
         o.fixed_salary_monthly AS offer_salary,
         sip.monthly_salary AS live_salary,
         (sip.user_id IS NOT NULL) AS has_profile,
         (o.converted_at AT TIME ZONE 'Asia/Kolkata')::date AS converted_on
  FROM public.hr_offers o
  JOIN public.users u ON u.id = o.converted_user_id
  LEFT JOIN public.staff_incentive_profiles sip ON sip.user_id = u.id
  WHERE u.is_active
)
SELECT '1_summary' AS section,
       count(*)::text || ' active people were created from an HR offer' AS who,
       NULL::text AS offer_status, NULL::numeric AS offer_salary, NULL::numeric AS live_salary, NULL::date AS converted_on,
       'live salary differs from offer: ' || count(*) FILTER (WHERE has_profile AND COALESCE(live_salary, 0) <> offer_salary)
         || ' | no profile at all: ' || count(*) FILTER (WHERE NOT has_profile) AS note
FROM conv
UNION ALL
SELECT '2_differs', c.name, c.offer_status, c.offer_salary, c.live_salary, c.converted_on,
       CASE WHEN NOT c.has_profile THEN 'no profile row at all'
            WHEN COALESCE(c.live_salary, 0) = 0 THEN 'live salary is 0 although the offer had a salary'
            WHEN c.live_salary < c.offer_salary THEN 'live is LOWER than the offer'
            ELSE 'live is higher than the offer (increment?)' END
FROM conv c
WHERE NOT c.has_profile OR COALESCE(c.live_salary, 0) <> c.offer_salary
ORDER BY 1, 6 DESC, 2
LIMIT 60;

-- ==============================================================================================
-- BLOCK 24  [SAL13]  cost: light
-- WHAT: Read the Phase 327 salary audit log (works whether or not that file was run)
-- WHY: If the Phase 327 recorder is installed, this shows the last 45 days of salary changes with
-- who/how, which directly answers 'who changed the salary with no reason'; if it is not installed
-- it says so instead of erroring.
-- HOW TO READ: The first line says whether the Phase 327 audit is installed. 'NOT INSTALLED' =
-- nothing to read; changes made before that file is run are never recorded, so the first
-- unexplained change after you run it will finally have a trail. If installed, each line is one
-- recorded change, newest first: when (Indian time), what (UPDATE/INSERT/DELETE on
-- staff_incentive_profiles or designations), whose salary, old and new amount, who did it, and
-- how. done_by shows a person's name and role when a logged-in person saved it from the app. 'no
-- app login - postgres' means Supabase Studio, a pasted SQL or a scheduled job; 'no app login -
-- authenticator' means the app/API without a login token. 'depth 2' or higher means ANOTHER
-- trigger caused the change (an automatic writer). Lines with the same txid were one save. A
-- change with nobody logged in and depth 2 is the 'salary changed by itself' case - send me those
-- lines. If it is installed but there are no lines, no salary has changed since installation. If
-- Studio reports an XML error, tell me and skip it (run it only after SAL1 section 4 says
-- 'installed').
-- ----------------------------------------------------------------------------------------------
SELECT '0_status' AS section,
       NULL::text AS when_ist,
       CASE WHEN to_regclass('public.salary_change_audit') IS NULL
            THEN 'NOT INSTALLED: the Phase 327 audit file has not been run, so there is no salary history to read yet'
            ELSE 'installed: rows below are the salary changes recorded since it was installed (last 45 days, newest first)' END AS what,
       NULL::text AS whose,
       NULL::text AS old_salary,
       NULL::text AS new_salary,
       NULL::text AS done_by,
       NULL::text AS how
UNION ALL
SELECT '1_audit_row', r.when_ist, r.what, r.whose, r.old_salary, r.new_salary, r.done_by, r.how
FROM xmltable(
  '/table/row'
  PASSING (
    CASE WHEN to_regclass('public.salary_change_audit') IS NOT NULL THEN
      query_to_xml($q$
        SELECT a.id,
               to_char(a.changed_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS') AS when_ist,
               a.op || ' on ' || a.source_table AS what,
               COALESCE((SELECT u.name FROM public.users u WHERE u.id = a.target_user_id),
                        (SELECT d.name FROM public.designations d WHERE d.id = a.target_designation_id),
                        '(row no longer exists)') AS whose,
               a.old_salary::text AS old_salary,
               a.new_salary::text AS new_salary,
               COALESCE((SELECT u.name || ' (' || COALESCE(a.actor_role, '?') || ')' FROM public.users u WHERE u.id = a.actor_uid),
                        'no app login - ' || COALESCE(a.db_user, '?')) AS done_by,
               'jwt ' || COALESCE(a.jwt_role, '-') || ' | app ' || COALESCE(a.app_name, '-')
                 || ' | depth ' || COALESCE(a.trigger_depth::text, '-')
                 || COALESCE(' | tag ' || a.source, '') || ' | txid ' || COALESCE(a.txid::text, '-') AS how
        FROM public.salary_change_audit a
        WHERE a.changed_at >= now() - interval '45 days'
        ORDER BY a.id DESC
        LIMIT 60
      $q$, false, false, '')
    END
  )
  COLUMNS
    when_ist   text PATH 'when_ist',
    what       text PATH 'what',
    whose      text PATH 'whose',
    old_salary text PATH 'old_salary',
    new_salary text PATH 'new_salary',
    done_by    text PATH 'done_by',
    how        text PATH 'how'
) AS r
ORDER BY 1, 2 DESC NULLS LAST;

-- ==============================================================================================
-- BLOCK 25  [OS3]  cost: trivial
-- WHAT: Safety check: are all the salary calculation functions read-only in the live database?
-- WHY: Proves that calling the salary functions for the hidden roles (OS10) cannot change any
-- data; OS10 refuses to run its calculation unless this is clean.
-- HOW TO READ: Good: 8 rows, every row exists_live = true, volatility says STABLE or IMMUTABLE
-- (read-only), and write_statements_in_body = 0. Bad: any row says VOLATILE, MISSING, or has a
-- number above 0 in the last column. Then send me the table and do not trust OS10 (it will print
-- 'NOT RUN' by itself in that case). A small number in the last column can also be just a comment
-- in the code, so send it to me rather than guessing.
-- ----------------------------------------------------------------------------------------------
SELECT w.fname AS function_name,
       (p.oid IS NOT NULL) AS exists_live,
       CASE p.provolatile WHEN 'i' THEN 'IMMUTABLE (read-only)'
                          WHEN 's' THEN 'STABLE (read-only)'
                          WHEN 'v' THEN 'VOLATILE (CAN WRITE)'
                          ELSE 'MISSING' END AS volatility,
       p.prosecdef AS security_definer,
       (SELECT count(*) FROM regexp_matches(p.prosrc,
          '(^|[^[:alnum:]_])(ins' || 'ert[[:space:]]+into|del' || 'ete[[:space:]]+from|trunc' || 'ate($|[^[:alnum:]_])|upd' || 'ate[[:space:]]+[a-z_.]+[[:space:]]+set)', 'gi')) AS write_statements_in_body
FROM (VALUES ('compute_monthly_salaries'), ('compute_monthly_salary'), ('_compute_monthly_salary_base'),
             ('monthly_score'), ('earned_incentive_for'), ('_assert_self_or_admin'),
             ('fy_for_date'), ('get_my_role')) AS w(fname)
LEFT JOIN pg_proc p ON p.proname = w.fname AND p.pronamespace = 'public'::regnamespace
ORDER BY w.fname;

-- ==============================================================================================
-- BLOCK 26  [OS4]  cost: trivial
-- WHAT: Every role in the system: how many active people, how many have a salary profile, and
-- which are hidden from the Salary sheet
-- WHY: Shows in one small table which roles (operations, hr, accounts, office_staff, staff) have
-- salaried people who the Salary sheet silently skips, and confirms the role names the database
-- allows.
-- HOW TO READ: One row per role (about 11 rows, operations roles on top). Rows marked 'OPS -
-- hidden today' or 'hidden today' with active_users above 0 are people the Salary sheet does not
-- show. 'with_salary_above_0' tells how many of them have a real salary number; those are the ones
-- that would suddenly get a Payout button once listed. 'with_salary_profile' lower than
-- 'active_users' means some people have no salary row at all (they would show Rs 0).
-- 'allowed_by_users_role_check' should be 'yes' for all 11 roles; a 'NO' means that role name is
-- not accepted by the database and we must not use it.
-- ----------------------------------------------------------------------------------------------
WITH chk AS (
  SELECT pg_get_constraintdef(c.oid) AS def
  FROM pg_constraint c
  WHERE c.conname = 'users_role_check' AND c.conrelid = 'public.users'::regclass
),
roles AS (
  SELECT t.x AS role
  FROM unnest(ARRAY['operation_head','operation_executive','sales','telecaller','admin','co_owner',
                    'agency','accounts','hr','office_staff','staff']) AS t(x)
  UNION
  SELECT DISTINCT u.role FROM public.users u
),
agg AS (
  SELECT u.role,
         count(*) AS active_users,
         count(*) FILTER (WHERE sip.user_id IS NOT NULL) AS with_profile,
         count(*) FILTER (WHERE COALESCE(sip.monthly_salary, 0) > 0) AS with_salary,
         COALESCE(sum(sip.monthly_salary), 0) AS total_monthly_salary,
         left(string_agg(u.name, ', ' ORDER BY u.name), 200) AS names
  FROM public.users u
  LEFT JOIN public.staff_incentive_profiles sip ON sip.user_id = u.id
  WHERE u.is_active
  GROUP BY u.role
)
SELECT r.role,
       CASE WHEN r.role IN ('sales','telecaller','admin','co_owner') THEN 'on sheet today'
            WHEN r.role = 'agency' THEN 'agency - commission only, stays off'
            WHEN r.role LIKE 'operation%' THEN 'OPS - hidden today'
            ELSE 'hidden today' END AS salary_sheet_status,
       CASE WHEN NOT EXISTS (SELECT 1 FROM chk) THEN 'no role check found'
            WHEN EXISTS (SELECT 1 FROM chk WHERE strpos(chk.def, '''' || r.role || '''') > 0) THEN 'yes'
            ELSE 'NO' END AS allowed_by_users_role_check,
       COALESCE(a.active_users, 0) AS active_users,
       COALESCE(a.with_profile, 0) AS with_salary_profile,
       COALESCE(a.with_salary, 0) AS with_salary_above_0,
       COALESCE(a.total_monthly_salary, 0) AS total_monthly_salary,
       a.names
FROM roles r
LEFT JOIN agg a ON a.role = r.role
ORDER BY (r.role LIKE 'operation%') DESC, COALESCE(a.active_users, 0) DESC, r.role;

-- ==============================================================================================
-- BLOCK 27  [OS5]  cost: trivial
-- WHAT: Roster of every active person: role, designation, salary profile and salary (operations
-- first)
-- WHY: Lets you see by name who is on the Salary sheet today, who is hidden, and who has no salary
-- profile, so we know exactly what will change when hidden roles are listed.
-- HOW TO READ: About 22 rows. Top block = operations people (hidden today), then other hidden
-- roles, then the normal sheet people, then agency. For hidden people: has_profile = false or
-- monthly_salary empty/0 means the sheet would show a Rs 0 row for them; a real salary number
-- means a real payable row would appear. Anyone whose name looks like a test account with a salary
-- above 0 is a risk (see OS8).
-- ----------------------------------------------------------------------------------------------
SELECT x.name, x.role, x.sheet_status, x.team_role, x.designation,
       x.has_profile, x.monthly_salary, x.profile_active
FROM (
  SELECT u.name, u.role, u.team_role, u.designation,
         CASE WHEN u.role IN ('operation_executive','operation_head') THEN 'OPS - hidden today'
              WHEN u.role IN ('sales','telecaller','admin','co_owner') THEN 'on sheet today'
              WHEN u.role = 'agency' THEN 'agency - stays off'
              ELSE 'other role - hidden today' END AS sheet_status,
         CASE WHEN u.role IN ('operation_executive','operation_head') THEN 1
              WHEN u.role IN ('sales','telecaller','admin','co_owner') THEN 3
              WHEN u.role = 'agency' THEN 4
              ELSE 2 END AS ord,
         (sip.user_id IS NOT NULL) AS has_profile,
         sip.monthly_salary,
         sip.is_active AS profile_active
  FROM public.users u
  LEFT JOIN public.staff_incentive_profiles sip ON sip.user_id = u.id
  WHERE u.is_active
) x
ORDER BY x.ord, x.role, x.name
LIMIT 60;

-- ==============================================================================================
-- BLOCK 28  [OS7]  cost: trivial
-- WHAT: Operations staff: last 7 days of screen uptime and the score it produced
-- WHY: Shows whether real daily uptime rows are landing for each operations person and whether
-- those days count (scored) or are skipped, which decides if it is safe to turn on their salary.
-- HOW TO READ: One row per person per day, last 7 days, newest day first for each person. Healthy:
-- screens_total above 0, uptime_pct a sensible number, is_excluded = false on working days (true
-- with reason 'off day' on Sundays and holidays is normal). Bad: is_excluded = true with reason
-- 'no screen data' on working days, or screens_total = 0, or no rows at all for a person: it means
-- their days are not being measured, so their pay would not reflect real work. An empty result
-- means no operations person has any uptime row in 7 days. If the list stops partway through the
-- alphabet (60-row cap), tell me and I will narrow it.
-- ----------------------------------------------------------------------------------------------
WITH t AS (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS today)
SELECT u.name,
       o.work_date,
       to_char(o.work_date, 'Dy') AS day_of_week,
       o.screens_total, o.screens_up, o.uptime_pct,
       p.score_pct, p.is_excluded, p.excluded_reason
FROM public.users u
CROSS JOIN t
JOIN public.ops_uptime_daily o ON o.user_id = u.id AND o.work_date >= t.today - 6
LEFT JOIN public.daily_performance p ON p.user_id = o.user_id AND p.work_date = o.work_date
WHERE u.is_active AND u.role IN ('operation_executive', 'operation_head')
ORDER BY u.name, o.work_date DESC
LIMIT 60;

-- ==============================================================================================
-- BLOCK 29  [OS10]  cost: light
-- WHAT: Dry run: what the live salary function returns for the currently hidden people, this month
-- and last month
-- WHY: Shows the exact sheet row (score, base, variable, incentive, travel, leave cut, net
-- payable) each hidden person would display, using the real payroll calculation, and exposes the
-- 'no measured days = full variable' overpay.
-- HOW TO READ: Two rows per hidden person (this month, last month); these are the exact numbers
-- the Salary sheet would show. Flag 'FULL-CAP TRAP' on LAST month = scored_days is 0 but variable
-- (the 30% part) is being paid: that happens for any role with no daily score (hr, accounts,
-- office_staff, staff, and operations people with no measured days), so the sheet would suggest
-- paying full variable for no measurement; do not pay these until we decide the rule. For THIS
-- month, 'nothing scored yet' is normal early in the month and is not a problem yet. 'no salary
-- set' = Rs 0 row. 'NOT RUN' means the safety check inside the query found a salary function that
-- is not read-only, so nothing was calculated: send me OS3. Empty result = no hidden people. This
-- only reads data; it does not change anything. If Studio shows a 'Restricted' permission error,
-- send me the message and skip this query.
-- ----------------------------------------------------------------------------------------------
WITH g AS (
  SELECT (count(DISTINCT p.proname) = 7 AND bool_and(p.provolatile IN ('s', 'i'))) AS safe
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('compute_monthly_salary', '_compute_monthly_salary_base', 'monthly_score',
                      'earned_incentive_for', '_assert_self_or_admin', 'fy_for_date', 'get_my_role')
),
t AS (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS today),
m AS (
  SELECT date_trunc('month', t.today::timestamp)::date AS ms, true AS is_current FROM t
  UNION ALL
  SELECT (date_trunc('month', t.today::timestamp) - interval '1 month')::date, false FROM t
),
who AS (
  SELECT u.id, u.name, u.role, m.ms, m.is_current
  FROM public.users u
  CROSS JOIN m
  WHERE u.is_active AND u.role NOT IN ('sales', 'telecaller', 'admin', 'co_owner', 'agency')
),
calc AS (
  SELECT w.name, w.role, w.ms, w.is_current, g.safe,
         CASE WHEN g.safe
              THEN public.compute_monthly_salary(w.id, extract(year FROM w.ms)::int, extract(month FROM w.ms)::int)
         END AS r
  FROM who w
  CROSS JOIN g
)
SELECT c.name,
       replace(c.role, 'operation_', 'ops_') AS role,
       to_char(c.ms, 'YYYY-MM') AS month,
       c.r->>'monthly_salary' AS salary,
       c.r->>'score_pct' AS score_pct,
       c.r->>'working_days' AS scored_days,
       c.r->>'base' AS base,
       c.r->>'variable' AS variable,
       c.r->>'incentive' AS incentive,
       c.r->>'ta_da' AS ta_da,
       c.r->>'unpaid_deduction' AS leave_cut,
       c.r->>'net_payable' AS net_payable,
       CASE WHEN c.safe IS NOT TRUE THEN 'NOT RUN - run OS3 first, a salary function is not read-only'
            WHEN COALESCE((c.r->>'monthly_salary')::numeric, 0) = 0 THEN 'no salary set: row shows Rs 0'
            WHEN (c.r->>'working_days')::int = 0 AND (c.r->>'variable')::numeric > 0 AND c.is_current
              THEN 'nothing scored yet this month: full variable shows until days land'
            WHEN (c.r->>'working_days')::int = 0 AND (c.r->>'variable')::numeric > 0
              THEN 'FULL-CAP TRAP: no scored days but variable is paid'
            ELSE 'check' END AS flag
FROM calc c
ORDER BY (c.role LIKE 'operation%') DESC, c.name, c.ms DESC
LIMIT 60;

-- ==============================================================================================
-- BLOCK 30  [CALLS-2]  cost: light
-- WHAT: Call-capture diagnostic log, last 14 days: per person, web versus phone app versus
-- permission denied
-- WHY: Shows which reps' call attempts are being recorded from a real phone (APK) versus from a
-- browser, and whether anyone has refused the call-log permission.
-- HOW TO READ: Last line of the result ('** ALL REPS **') is the total. For each person: web_rows
-- high and apk_* all 0 = a genuine browser user (their calls are never read from the phone).
-- apk_permission_granted or apk_resume_sweep_rows above 0 = they are on the APK. A person with
-- BOTH web_rows and apk rows uses both, and their browser-side calls are the ones that cannot be
-- captured. apk_permission_denied above 0 = that rep refused the call-log permission on the phone,
-- so durations can never be read. A person with capture_rows_14d = 0 made no recorded capture
-- attempts in 14 days (no saved call outcomes). Compare last_web_row_ist with last_apk_row_ist to
-- see which one they used most recently. The blank-permission 'resume sweep' rows only exist on
-- the APK, which is why they are counted as APK.
-- ----------------------------------------------------------------------------------------------
SELECT COALESCE(u.name, '** ALL REPS **') AS rep,
       u.role,
       count(c.id) AS capture_rows_14d,
       count(c.id) FILTER (WHERE c.device_permission = 'web') AS web_rows,
       count(c.id) FILTER (WHERE c.device_permission = 'granted') AS apk_permission_granted,
       count(c.id) FILTER (WHERE c.device_permission = 'denied') AS apk_permission_denied,
       count(c.id) FILTER (WHERE c.device_permission IN ('prompt', 'error')) AS apk_permission_not_asked_or_error,
       count(c.id) FILTER (WHERE c.device_permission IS NULL AND c.patch_path = 'resume_sweep') AS apk_resume_sweep_rows,
       count(c.id) FILTER (WHERE c.device_permission IS NOT NULL
                             AND c.device_permission NOT IN ('web', 'granted', 'denied', 'prompt', 'error')) AS unexpected_value_rows,
       to_char((max(c.created_at) FILTER (WHERE c.device_permission = 'web')) AT TIME ZONE 'Asia/Kolkata', 'DD Mon HH24:MI') AS last_web_row_ist,
       to_char((max(c.created_at) FILTER (WHERE c.device_permission IN ('granted', 'denied', 'prompt', 'error')
                                             OR c.patch_path = 'resume_sweep')) AT TIME ZONE 'Asia/Kolkata', 'DD Mon HH24:MI') AS last_apk_row_ist
  FROM public.users u
  LEFT JOIN public.call_capture_log c
         ON c.user_id = u.id
        AND c.created_at >= now() - interval '14 days'
 WHERE u.is_active
   AND u.role IN ('sales', 'telecaller', 'operation_executive', 'operation_head')
 GROUP BY GROUPING SETS ((u.id, u.name, u.role), ())
 ORDER BY GROUPING(u.id), web_rows DESC, capture_rows_14d DESC, u.name;

-- ==============================================================================================
-- BLOCK 31  [CALLS-3]  cost: trivial
-- WHAT: Does duration capture work? Capture log grouped by capture path and web/phone, last 14
-- days
-- WHY: Shows how often the phone actually hands back the call length and how often we save a
-- blank, separately for the three capture moments (at save, 60 seconds later, and the later resume
-- sweep), so we can see whether the timing fix worked.
-- HOW TO READ: One row per (capture path, web-or-phone). Web rows: phone_returned_a_row should be
-- 0 and pct_saved_null high, because a browser cannot read the phone's call log, so those calls
-- stay blank. For the two APK rows modal_save (when the rep saves the outcome) and auto60 (60
-- seconds after the tap): compare phone_returned_a_row with phone_row_had_seconds. If the phone
-- returned a row almost every time but that row had no seconds yet, the early reads fire before
-- Android finishes writing the call length (timing, not permission). IMPORTANT: the resume_sweep
-- line only records the cases where the later sweep SUCCEEDED (the phone gave at least 1 second
-- and it was written), so its saved_null is always 0 by design and its attempts number simply
-- equals how many blank calls the sweep rescued in 14 days. A big resume_sweep attempts number
-- next to a high saved_null on modal_save/auto60 means early reads miss and the sweep is doing the
-- real work. A small resume_sweep number with a high saved_null elsewhere means blanks are not
-- being rescued. A high saved_1_to_9 count means very short calls, not a capture failure.
-- ----------------------------------------------------------------------------------------------
SELECT COALESCE(c.patch_path, '(none)') AS capture_path,
       CASE WHEN c.device_permission = 'web' THEN 'web (browser, no phone log)'
            WHEN c.device_permission IS NULL AND c.patch_path = 'resume_sweep' THEN 'APK (resume sweep rows carry no permission value)'
            WHEN c.device_permission IS NULL THEN '(blank permission, source unknown)'
            ELSE 'APK: ' || c.device_permission END AS device_class,
       count(*) AS attempts,
       count(DISTINCT c.user_id) AS reps,
       count(*) FILTER (WHERE c.device_read_found) AS phone_returned_a_row,
       count(*) FILTER (WHERE c.device_read_found AND COALESCE(c.device_read_seconds, 0) > 0) AS phone_row_had_seconds,
       count(*) FILTER (WHERE c.final_seconds IS NULL) AS saved_null,
       count(*) FILTER (WHERE c.final_seconds = 0) AS saved_0,
       count(*) FILTER (WHERE c.final_seconds BETWEEN 1 AND 9) AS saved_1_to_9,
       count(*) FILTER (WHERE c.final_seconds >= 10) AS saved_10_plus,
       round(100.0 * count(*) FILTER (WHERE c.final_seconds IS NULL) / count(*), 1) AS pct_saved_null
  FROM public.call_capture_log c
 WHERE c.created_at >= now() - interval '14 days'
 GROUP BY 1, 2
 ORDER BY 1, 2;

-- ==============================================================================================
-- BLOCK 32  [CALLS-4]  cost: light
-- WHAT: Call records per person, last 7 days: blank durations, direction, no-lead rows and how
-- many came from the phone app
-- WHY: Shows, for each rep, whether the phone app is writing any rows at all, how many calls have
-- no length saved, and how many 10-second-plus calls are not tied to a lead.
-- HOW TO READ: Last line is the total for everyone. tap_rows = the app's own record made when a
-- rep taps Call (it keeps that label even after the phone scan fills in its length).
-- apk_ingest_rows = rows the phone scan CREATED itself after reading the phone's call log; this
-- includes the real-time incoming listener because both use the same writer. Calls the rep started
-- from the in-app Call button are merged into the tap row instead of making a new row, so a rep
-- who only calls from the app can have apk_ingest_rows = 0 and still be on a working APK (check
-- CALLS-1/CALLS-2). What apk_ingest_rows, incoming and missed are good for: a heavy caller with
-- apk_ingest_rows = 0, incoming = 0 and missed = 0 is getting nothing created from the phone side
-- (no dialer calls, no inbound), which fits a website user or a broken scan. tap_rows_still_blank
-- high = taps that never got a length. pct_outgoing_blank includes calls that really were not
-- answered, so judge it together with duration_10s_plus. ten_s_plus_no_lead high = real calls that
-- did not get attached to a lead (see CALLS-5). Operations people (role operation_*) log ticket
-- calls with no lead by design, so ignore no_lead for them.
-- ----------------------------------------------------------------------------------------------
SELECT COALESCE(u.name, '** ALL REPS **') AS rep,
       u.role,
       count(cl.id) AS rows_7d,
       count(cl.id) FILTER (WHERE cl.direction = 'outgoing') AS outgoing,
       count(cl.id) FILTER (WHERE cl.direction = 'incoming') AS incoming,
       count(cl.id) FILTER (WHERE cl.direction = 'missed') AS missed,
       count(cl.id) FILTER (WHERE cl.duration_seconds IS NULL) AS duration_null,
       count(cl.id) FILTER (WHERE cl.duration_seconds = 0) AS duration_zero,
       count(cl.id) FILTER (WHERE cl.duration_seconds >= 10) AS duration_10s_plus,
       count(cl.id) FILTER (WHERE cl.lead_id IS NULL) AS no_lead_rows,
       count(cl.id) FILTER (WHERE cl.duration_seconds >= 10 AND cl.lead_id IS NULL) AS ten_s_plus_no_lead,
       count(cl.id) FILTER (WHERE cl.notes LIKE 'tel-tap audit%') AS tap_rows,
       count(cl.id) FILTER (WHERE cl.notes LIKE 'tel-tap audit%' AND COALESCE(cl.duration_seconds, 0) = 0) AS tap_rows_still_blank,
       count(cl.id) FILTER (WHERE cl.notes LIKE '%(Phase 56l scan)%') AS apk_ingest_rows,
       round(100.0 * count(cl.id) FILTER (WHERE cl.direction = 'outgoing' AND COALESCE(cl.duration_seconds, 0) = 0)
             / NULLIF(count(cl.id) FILTER (WHERE cl.direction = 'outgoing'), 0), 1) AS pct_outgoing_blank
  FROM public.users u
  LEFT JOIN public.call_logs cl
         ON cl.user_id = u.id
        AND cl.call_at >= now() - interval '7 days'
 WHERE u.is_active
   AND u.role IN ('sales', 'telecaller', 'operation_executive', 'operation_head')
 GROUP BY GROUPING SETS ((u.id, u.name, u.role), ())
 ORDER BY GROUPING(u.id), rows_7d DESC, u.name;

-- ==============================================================================================
-- BLOCK 33  [CALLS-6]  cost: light
-- WHAT: How are lead phone numbers stored, by lead source? (counts only, no numbers shown)
-- WHY: Proves which lead sources save phone numbers in a shape that the phone app cannot match (91
-- prefix, + sign, spaces), which tells us whether to fix the intake or the matching.
-- HOW TO READ: The FIRST row is the total across all sources, then one row per source, biggest
-- first. Only the plain_10_digits column can be linked by the phone app's scan. Every other column
-- (91 prefix, + sign, spaces, 11 digits, odd lengths) is a lead whose calls will NOT attach unless
-- the call was a tap from inside the app. pct_not_plain_10 is the share of leads (that have a
-- phone) that the scan cannot match. A source with a high percentage (for example WhatsApp-style
-- 91 numbers) is where the intake should normalise the number; a low percentage everywhere means
-- format is not the main cause and CALLS-5 should show a small
-- own_lead_but_phone_stored_in_other_format. Covers leads created in the last 180 days only (older
-- leads are not in this count).
-- ----------------------------------------------------------------------------------------------
WITH s AS (
  SELECT COALESCE(NULLIF(btrim(l.source), ''), '(blank)') AS src,
         CASE WHEN l.phone IS NULL OR btrim(l.phone) = '' THEN 'no_phone'
              WHEN l.phone ~ '^[0-9]{10}$' THEN 'plain_10_digits'
              WHEN l.phone ~ '^91[0-9]{10}$' THEN 'digits_91_prefix_12'
              WHEN l.phone ~ '^\+' THEN 'plus_prefixed'
              WHEN l.phone ~ '[^0-9]' THEN 'has_space_dash_or_symbol'
              WHEN l.phone ~ '^0[0-9]{10}$' THEN 'leading_zero_11'
              ELSE 'other_digit_count' END AS shape
    FROM public.leads l
   WHERE l.created_at >= now() - interval '180 days'
)
SELECT COALESCE(s.src, '** ALL SOURCES **') AS lead_source,
       count(*) AS leads_180d,
       count(*) FILTER (WHERE s.shape = 'plain_10_digits') AS plain_10_digits,
       count(*) FILTER (WHERE s.shape = 'digits_91_prefix_12') AS digits_91_prefix_12,
       count(*) FILTER (WHERE s.shape = 'plus_prefixed') AS plus_prefixed,
       count(*) FILTER (WHERE s.shape = 'has_space_dash_or_symbol') AS has_space_dash_or_symbol,
       count(*) FILTER (WHERE s.shape = 'leading_zero_11') AS leading_zero_11,
       count(*) FILTER (WHERE s.shape = 'other_digit_count') AS other_digit_count,
       count(*) FILTER (WHERE s.shape = 'no_phone') AS no_phone,
       round(100.0 * count(*) FILTER (WHERE s.shape NOT IN ('plain_10_digits', 'no_phone'))
             / NULLIF(count(*) FILTER (WHERE s.shape <> 'no_phone'), 0), 1) AS pct_not_plain_10
  FROM s
 GROUP BY GROUPING SETS ((s.src), ())
 ORDER BY GROUPING(s.src) DESC, leads_180d DESC
 LIMIT 41;

-- ==============================================================================================
-- BLOCK 34  [CALLS-8]  cost: light
-- WHAT: Is incoming and missed ever recorded? Weekly count by direction, last 4 weeks
-- WHY: Answers whether inbound call capture is alive fleet-wide now (weeks well after the 14 July
-- real-time listener and APK 96018) or still dead, and how many incoming rows have no length.
-- HOW TO READ: Two lines per week (sales, telecaller); the newest week is partial. incoming and
-- missed above 0 in recent weeks = inbound capture works at least for some reps. Compare
-- reps_with_any_inbound_row with reps_with_any_row: if only a few of the reps who made calls have
-- any inbound row, inbound capture is not reaching the rest (CALLS-9 names them).
-- pct_incoming_zero_duration near 100 means answered incoming calls are being saved with no
-- length; the real-time listener is supposed to bring that down on APK 96018 and newer. Zero
-- incoming and zero missed in every week = inbound capture is not working at all.
-- ----------------------------------------------------------------------------------------------
SELECT date_trunc('week', cl.call_at AT TIME ZONE 'Asia/Kolkata')::date AS week_starting_monday_ist,
       u.role,
       count(*) AS call_rows,
       count(*) FILTER (WHERE cl.direction = 'outgoing') AS outgoing,
       count(*) FILTER (WHERE cl.direction = 'incoming') AS incoming,
       count(*) FILTER (WHERE cl.direction = 'missed') AS missed,
       count(*) FILTER (WHERE cl.direction = 'incoming' AND COALESCE(cl.duration_seconds, 0) = 0) AS incoming_zero_or_null_duration,
       round(100.0 * count(*) FILTER (WHERE cl.direction = 'incoming' AND COALESCE(cl.duration_seconds, 0) = 0)
             / NULLIF(count(*) FILTER (WHERE cl.direction = 'incoming'), 0), 1) AS pct_incoming_zero_duration,
       count(DISTINCT cl.user_id) AS reps_with_any_row,
       count(DISTINCT cl.user_id) FILTER (WHERE cl.direction IN ('incoming', 'missed')) AS reps_with_any_inbound_row
  FROM public.call_logs cl
  JOIN public.users u ON u.id = cl.user_id
 WHERE cl.call_at >= ((date_trunc('week', now() AT TIME ZONE 'Asia/Kolkata') - interval '3 weeks') AT TIME ZONE 'Asia/Kolkata')
   AND u.role IN ('sales', 'telecaller')
 GROUP BY 1, 2
 ORDER BY 1, 2;

-- ==============================================================================================
-- BLOCK 35  [CALLS-9]  cost: light
-- WHAT: Inbound capture per person: incoming and missed counts, whether they are on APK 96018 or
-- newer, and any incoming since 14 July
-- WHY: Pins down WHICH reps have no inbound capture and whether the cause is 'the phone does not
-- have the listener APK' or 'the listener APK is installed but delivering nothing'.
-- HOW TO READ: One row per rep. If on_96018_or_newer is false (or blank) the rep's last-opened
-- device does not have the real-time incoming listener, so no incoming capture is expected: a
-- rollout/update problem. If on_96018_or_newer is true but outgoing_28d is large and incoming_28d
-- plus missed_28d are both 0 and incoming_rows_since_14_jul is 0, the listener is installed but
-- delivering nothing for that phone (permission, battery or auto-start setting on that device, or
-- the rep is on the website right now): a listener-delivery problem, not a brand or call-type
-- problem. incoming_zero_duration_28d close to incoming_28d means answered calls are saved without
-- a length. A rep whose app_version says 'web' (see CALLS-1) shows as not on 96018 only because
-- the last open was on the website; check CALLS-1/CALLS-2 before concluding. Rows are limited to
-- the last 28 days, except the two 'since' columns which look back to 14 July / 1 June.
-- ----------------------------------------------------------------------------------------------
SELECT u.name AS rep,
       u.role,
       u.app_version,
       u.app_version_code,
       (u.app_version_code >= 96018) AS on_96018_or_newer,
       count(cl.id) FILTER (WHERE cl.direction = 'outgoing') AS outgoing_28d,
       count(cl.id) FILTER (WHERE cl.direction = 'incoming') AS incoming_28d,
       count(cl.id) FILTER (WHERE cl.direction = 'incoming' AND COALESCE(cl.duration_seconds, 0) = 0) AS incoming_zero_duration_28d,
       count(cl.id) FILTER (WHERE cl.direction = 'missed') AS missed_28d,
       (SELECT count(*) FROM public.call_logs x
         WHERE x.user_id = u.id
           AND x.direction = 'incoming'
           AND x.call_at >= timestamptz '2026-07-14 00:00:00+05:30') AS incoming_rows_since_14_jul,
       to_char((SELECT max(x.call_at) FROM public.call_logs x
                 WHERE x.user_id = u.id
                   AND x.direction = 'incoming'
                   AND x.call_at >= timestamptz '2026-06-01 00:00:00+05:30') AT TIME ZONE 'Asia/Kolkata', 'DD Mon HH24:MI') AS last_incoming_row_ist
  FROM public.users u
  LEFT JOIN public.call_logs cl
         ON cl.user_id = u.id
        AND cl.call_at >= now() - interval '28 days'
 WHERE u.is_active
   AND u.role IN ('sales', 'telecaller')
 GROUP BY u.id, u.name, u.role, u.app_version, u.app_version_code
 ORDER BY u.role, incoming_28d DESC, u.name;

-- ==============================================================================================
-- BLOCK 36  [CALLS-10]  cost: trivial
-- WHAT: Check the live call-duplicate guard (trigger) is still the correct version
-- WHY: Confirms nobody re-ran an old SQL file that would silently bring back the 'merges real
-- repeat calls' bug, and gives the fingerprint (md5) of the live function to compare with the repo
-- file.
-- HOW TO READ: The result lists every trigger on the call_logs table. Find the row called
-- trg_call_logs_dedupe: state must say 'enabled', and all six flag columns (folds_only_into_tap
-- through unpatched_target_only) must be true. md5_matches_repo_file = true means the live
-- function text is byte-identical to db/functions/call_logs_dedupe_before_insert.sql (the expected
-- fingerprint 76cfb2bbbd106860b064066fb50f00a5 was calculated from the text between the two
-- $function$ markers of that file; body_characters should read 2476). A false there only means the
-- text differs (for example whitespace); the six flags then say whether the logic still matches.
-- If any flag is false, an older call SQL file was re-run and the canonical file should be re-run.
-- A missing trg_call_logs_dedupe row means duplicates are no longer folded at all. The other
-- triggers listed (the counter bump and the delete-heal) are shown for completeness; just send us
-- the whole result.
-- ----------------------------------------------------------------------------------------------
SELECT t.tgname AS trigger_name,
       CASE t.tgenabled WHEN 'O' THEN 'enabled'
                        WHEN 'D' THEN 'DISABLED'
                        WHEN 'R' THEN 'replica only'
                        WHEN 'A' THEN 'always'
                        ELSE t.tgenabled::text END AS state,
       p.proname AS function_name,
       md5(p.prosrc) AS function_body_md5,
       length(p.prosrc) AS body_characters,
       CASE WHEN p.proname = 'call_logs_dedupe_before_insert'
            THEN (md5(p.prosrc) = '76cfb2bbbd106860b064066fb50f00a5') END AS md5_matches_repo_file,
       CASE WHEN p.proname = 'call_logs_dedupe_before_insert'
            THEN (p.prosrc LIKE '%tel-tap audit%') END AS folds_only_into_tap,
       CASE WHEN p.proname = 'call_logs_dedupe_before_insert'
            THEN (p.prosrc LIKE '%NEW.direction = ''outgoing''%') END AS only_outgoing_folds,
       CASE WHEN p.proname = 'call_logs_dedupe_before_insert'
            THEN (p.prosrc LIKE '%NEW.direction = ''missed''%') END AS missed_branch_present,
       CASE WHEN p.proname = 'call_logs_dedupe_before_insert'
            THEN (p.prosrc LIKE '%60 seconds%') END AS phone_window_60s,
       CASE WHEN p.proname = 'call_logs_dedupe_before_insert'
            THEN (p.prosrc LIKE '%5 minutes%') END AS lead_window_5min,
       CASE WHEN p.proname = 'call_logs_dedupe_before_insert'
            THEN (p.prosrc LIKE '%duration_seconds = 0%') END AS unpatched_target_only,
       pg_get_triggerdef(t.oid) AS trigger_definition
  FROM pg_trigger t
  JOIN pg_proc p ON p.oid = t.tgfoid
 WHERE t.tgrelid = to_regclass('public.call_logs')
   AND NOT t.tgisinternal
 ORDER BY t.tgname;

-- ==============================================================================================
-- BLOCK 37  [HR4]  cost: trivial
-- WHAT: Each accepted or converted offer: role, correct letter, dates (no names)
-- WHY: Gives the exact offers whose signed PDF may be the wrong letter, so HR knows which ones to
-- regenerate.
-- HOW TO READ: One row per offer, newest first, no personal data. Rows where
-- non_sales_letter_expected is true AND HR2 showed that the public page does not return the role:
-- that offer's signed PDF was made as the sales letter although the hire is not sales; regenerate
-- it. If HR2 showed the role IS returned, ignore that column. position_title is shown so you can
-- also spot old offers (designation_auth_role '(none - old offer)') whose position is clearly not
-- a sales job: those were always the sales letter by design and also need a look.
-- ----------------------------------------------------------------------------------------------
with x as (
  select o.id, o."position" as position_title, o.status, o.created_at, o.accepted_terms_at, o.offer_pdf_url,
         lower(nullif(btrim(to_jsonb(o) ->> 'designation_auth_role'), '')) as auth_role,
         (to_jsonb(o) ->> 'designation_has_incentive') as has_incentive
  from public.hr_offers o
  where o.status in ('accepted', 'converted_to_user')
), y as (
  select x.*,
         case
           when auth_role in ('operation_executive', 'operation_head') then 'ops'
           when auth_role = 'telecaller' and has_incentive = 'true' then 'telecaller'
           when auth_role = 'sales' and has_incentive = 'true' then 'sales'
           when auth_role is null then 'sales'
           else 'generic'
         end as letter_it_should_have
  from x
)
select left(id::text, 8) as offer_short_id,
       position_title,
       coalesce(auth_role, '(none - old offer)') as designation_auth_role,
       has_incentive,
       status,
       (created_at at time zone 'Asia/Kolkata')::date as created_on,
       (accepted_terms_at at time zone 'Asia/Kolkata')::date as accepted_on,
       (offer_pdf_url is not null) as has_signed_pdf,
       letter_it_should_have,
       (letter_it_should_have <> 'sales') as non_sales_letter_expected
from y
order by created_at desc
limit 60;

-- ==============================================================================================
-- BLOCK 38  [HR5]  cost: light
-- WHAT: Hires made since 1 June 2026: money, targets and expense permissions that were or were not
-- set
-- WHY: Shows which setup steps the offer Convert button and the recruit Create-login button skip,
-- so we know what the Convert fix must copy over.
-- HOW TO READ: One row per hire. For rows made by the offer Convert button: allow_ta, allow_da,
-- allow_hotel all false (and allow_other true) means the travel, daily-allowance and hotel
-- permissions were never copied from the role's defaults; the code search found no screen in the
-- app that edits these four flags after the person is created, so someone would have to fix them
-- in the database. has_salary_row false, or salary_row_amount 0 / empty while offer_salary is
-- above 0, means the salary in the signed offer did not reach the salary sheet. For a non-sales
-- role (operations, accounts, designer) made by Convert, has_salary_row false means that person
-- never appears on the Salary sheet (Convert skips the salary row for flat-salary roles).
-- incentive_multiplier of 5 is just the column default and shows on almost every row, so do not
-- read it as proof of a wrong incentive profile. For a hire with role sales made by 'candidate
-- card (Create login)': salary_row_amount 0 while the form salary was higher means the salary
-- insert collided with the automatic sales profile and was dropped (the code only logs a warning).
-- has_active_daily_target false / active_target_min_calls empty means no daily call target exists
-- (the Convert button never creates one). Compare with rows made by 'candidate card (Create
-- login)' to see what that path does better.
-- ----------------------------------------------------------------------------------------------
with src as (
  select o.converted_user_id as user_id, true as via_offer, false as via_card, o.fixed_salary_monthly as offered_salary
  from public.hr_offers o
  where o.converted_user_id is not null and o.converted_at >= date '2026-06-01'
  union all
  select c.converted_user_id, false, true, null::numeric
  from public.hr_candidates c
  where c.converted_user_id is not null and c.updated_at >= date '2026-06-01'
), agg as (
  select user_id, bool_or(via_offer) as via_offer, bool_or(via_card) as via_card, max(offered_salary) as offered_salary
  from src
  group by user_id
)
select u.name, u.role, u.team_role,
       case when a.via_offer and a.via_card then 'offer + candidate card'
            when a.via_offer then 'offer (Convert button)'
            else 'candidate card (Create login)' end as created_via,
       (u.created_at at time zone 'Asia/Kolkata')::date as user_created_on,
       u.is_active,
       u.allow_ta, u.allow_da, u.allow_hotel, u.allow_other,
       a.offered_salary as offer_salary,
       (sip.user_id is not null) as has_salary_row,
       sip.monthly_salary as salary_row_amount,
       sip.sales_multiplier as incentive_multiplier,
       exists (select 1 from public.daily_targets dt where dt.user_id = u.id and dt.effective_to is null) as has_active_daily_target,
       (select dt.min_calls from public.daily_targets dt where dt.user_id = u.id and dt.effective_to is null limit 1) as active_target_min_calls
from agg a
join public.users u on u.id = a.user_id
left join public.staff_incentive_profiles sip on sip.user_id = u.id
order by u.created_at desc
limit 60;

-- ==============================================================================================
-- BLOCK 39  [HR6]  cost: light
-- WHAT: Same hires: contact details set and whether they ever logged in (yes/no only)
-- WHY: Decides whether a one-time login link or set-password mail is possible for new hires, and
-- whether the Convert button skips the contact fields.
-- HOW TO READ: Only yes/no flags, no email or phone is shown. has_contact_email false together
-- with login_email_is_untitledad_alias true means this person's login address is a send-only
-- alias, so a password-reset or login mail sent to it would never arrive (the app has a separate
-- real-inbox field, contact_email, for this; neither hire path fills it). For hires made by the
-- offer Convert button the login address is the candidate's own email, so
-- login_email_is_untitledad_alias is normally false there. has_signature_mobile false means no
-- mobile reached the user record. has_signature_mobile true but has_whatsapp_number false means
-- the WhatsApp assistant link was skipped (fewer than 10 digits, or that number is already used by
-- another user). has_ever_signed_in false = that hire has never opened the app, so a one-time
-- first-login link would be safe to send; true = they already have a working password.
-- ----------------------------------------------------------------------------------------------
with src as (
  select o.converted_user_id as user_id, true as via_offer, false as via_card
  from public.hr_offers o
  where o.converted_user_id is not null and o.converted_at >= date '2026-06-01'
  union all
  select c.converted_user_id, false, true
  from public.hr_candidates c
  where c.converted_user_id is not null and c.updated_at >= date '2026-06-01'
), agg as (
  select user_id, bool_or(via_offer) as via_offer, bool_or(via_card) as via_card
  from src
  group by user_id
)
select u.name, u.role,
       case when a.via_offer and a.via_card then 'offer + candidate card'
            when a.via_offer then 'offer (Convert button)'
            else 'candidate card (Create login)' end as created_via,
       (nullif(btrim(to_jsonb(u) ->> 'contact_email'), '') is not null) as has_contact_email,
       (nullif(btrim(u.signature_mobile), '') is not null) as has_signature_mobile,
       (nullif(btrim(to_jsonb(u) ->> 'whatsapp_number'), '') is not null) as has_whatsapp_number,
       (lower(u.email) like '%@untitledad.in') as login_email_is_untitledad_alias,
       ((to_jsonb(au) ->> 'last_sign_in_at') is not null) as has_ever_signed_in,
       left(to_jsonb(au) ->> 'last_sign_in_at', 10) as last_sign_in_date_utc
from agg a
join public.users u on u.id = a.user_id
left join auth.users au on au.id = u.id
order by u.created_at desc
limit 60;

-- ==============================================================================================
-- BLOCK 40  [HR7]  cost: light
-- WHAT: Same hires: did onboarding start for them
-- WHY: Shows whether the offer Convert button skips starting the new-hire onboarding checklist,
-- and whether a checklist even exists for the role.
-- HOW TO READ: has_onboarding_run false on a row made by the offer Convert button = Convert never
-- starts onboarding (only the Create-login button does). active_templates_for_this_role = 0 means
-- no checklist is set up for that role, so even the Create-login button would start nothing for
-- them. steps_done 0 of steps_total N for an old hire means they never touched their checklist. If
-- this query errors with 'relation onboarding_runs does not exist', HR1 will have shown that table
-- as missing: the onboarding SQL was never run, which is itself the answer.
-- ----------------------------------------------------------------------------------------------
with src as (
  select o.converted_user_id as user_id, true as via_offer, false as via_card
  from public.hr_offers o
  where o.converted_user_id is not null and o.converted_at >= date '2026-06-01'
  union all
  select c.converted_user_id, false, true
  from public.hr_candidates c
  where c.converted_user_id is not null and c.updated_at >= date '2026-06-01'
), agg as (
  select user_id, bool_or(via_offer) as via_offer, bool_or(via_card) as via_card
  from src
  group by user_id
)
select u.name, u.role,
       case when a.via_offer and a.via_card then 'offer + candidate card'
            when a.via_offer then 'offer (Convert button)'
            else 'candidate card (Create login)' end as created_via,
       (select count(*) from public.onboarding_templates t where t.role = u.role and t.is_active) as active_templates_for_this_role,
       (r.id is not null) as has_onboarding_run,
       r.status as run_status,
       (r.started_at at time zone 'Asia/Kolkata')::date as run_started_on,
       (select count(*) from public.onboarding_progress p where p.run_id = r.id) as steps_total,
       (select count(*) from public.onboarding_progress p where p.run_id = r.id and p.status = 'done') as steps_done
from agg a
join public.users u on u.id = a.user_id
left join public.onboarding_runs r on r.user_id = u.id
order by u.created_at desc
limit 60;

-- ==============================================================================================
-- BLOCK 41  [HR8]  cost: trivial
-- WHAT: Recruit candidates by stage: how many have a login and how many have an offer
-- WHY: Shows how many candidates are stuck between 'hired', 'Send offer' and 'Create login'
-- because candidates and offers are not linked.
-- HOW TO READ: Each row is a count of candidates. The row stage = hired, login_created = false is
-- the stuck group: they are marked hired but nobody has made their login yet. If
-- has_offer_with_same_email is false for them, no offer was found for them, so the card still
-- shows both 'Send offer' and 'Create login'. If it is true, an offer exists (matched only by
-- email, because offers have no candidate link) while the card still thinks no login exists. A
-- candidate with a blank email, or an offer made with a different email than the card, always
-- counts as 'no offer' here. Rows with login_created = true are fine. Rows at stages applied,
-- shortlisted, interview or rejected are normal and not stuck.
-- ----------------------------------------------------------------------------------------------
select stage, login_created, has_offer_with_same_email, count(*) as candidates
from (
  select c.stage,
         (c.converted_user_id is not null) as login_created,
         exists (select 1 from public.hr_offers o
                 where lower(btrim(o.candidate_email)) = lower(btrim(c.email))) as has_offer_with_same_email
  from public.hr_candidates c
) t
group by stage, login_created, has_offer_with_same_email
order by 1, 2, 3;

-- ==============================================================================================
-- BLOCK 42  [HR9]  cost: trivial
-- WHAT: The candidates who are hired (or already have an offer login) but their card shows no
-- login
-- WHY: Gives the names to fix by hand and shows the duplicate-login risk where an offer already
-- made a login but the candidate card still says 'Create login'.
-- HOW TO READ: One row per stuck candidate (name and role only, no phone or email shown).
-- offers_with_same_email = 0 means no offer was found for them: they are stuck at 'Send offer'.
-- latest_offer_status = accepted means they signed but nobody has pressed Convert yet.
-- offer_already_made_a_login = true is the dangerous row: the person already has a login from the
-- offer Convert button, but the candidate card still offers 'Create login'; pressing it would try
-- to create the same person twice, so someone must link them by hand. A candidate whose offer used
-- a different email than the candidate card will show 0 offers here even if one exists (matching
-- is by email only).
-- ----------------------------------------------------------------------------------------------
select c.name, c.stage, c.role_applied,
       (c.created_at at time zone 'Asia/Kolkata')::date as added_on,
       (c.updated_at at time zone 'Asia/Kolkata')::date as last_changed_on,
       (select count(*) from public.hr_offers o
         where lower(btrim(o.candidate_email)) = lower(btrim(c.email))) as offers_with_same_email,
       (select o.status from public.hr_offers o
         where lower(btrim(o.candidate_email)) = lower(btrim(c.email))
         order by o.created_at desc limit 1) as latest_offer_status,
       exists (select 1 from public.hr_offers o
                where lower(btrim(o.candidate_email)) = lower(btrim(c.email))
                  and o.converted_user_id is not null) as offer_already_made_a_login
from public.hr_candidates c
where c.converted_user_id is null
  and (c.stage = 'hired'
       or exists (select 1 from public.hr_offers o
                   where lower(btrim(o.candidate_email)) = lower(btrim(c.email))
                     and o.converted_user_id is not null))
order by c.updated_at desc
limit 60;

-- ==============================================================================================
-- BLOCK 43  [HR10]  cost: trivial
-- WHAT: Does the email log exist, and has the app ever logged an offer or login email
-- WHY: Decides whether an email-based first-login link can be tracked, and whether offer mails are
-- really going out today.
-- HOW TO READ: Answer starting with MISSING = the email_log table was never created in the live
-- database (supabase_email_log.sql was never run). The send endpoint writes to that log best-effort,
-- so mail may still be going out but nothing is recorded. Answer with a number = the table exists
-- and holds that many rows; then ask Claude for the by-kind breakdown. (First version of this block
-- read the table directly and stopped with error 42P01 because the table is missing - this version
-- checks first and cannot fail.)
-- ----------------------------------------------------------------------------------------------
select case
         when to_regclass('public.email_log') is null
           then 'MISSING - table email_log does not exist in the live database'
         else (xpath('/row/c/text()',
                     query_to_xml('select count(*) as c from public.email_log', false, true, '')))[1]::text
              || ' rows logged in total'
       end as email_log_status;

-- ==============================================================================================
-- BLOCK 44  [HR11]  cost: trivial
-- WHAT: Designation master: the role strings and default permissions the Convert fix would copy
-- WHY: Shows the exact role names and default expense permissions per designation, so we can see
-- what the Convert button should copy and which default salaries would silently pre-fill.
-- HOW TO READ: auth_role must be the exact role words the app understands (sales, telecaller,
-- operation_executive, operation_head, accounts, hr, and so on); a typo here makes the offer
-- letter pick the generic letter. The default_allow_* columns are what the Create-login page
-- copies onto a new person; the offer Convert button copies none of them (see HR5).
-- default_monthly_salary above 0 is what pre-fills the salary box on the Create-login page;
-- flat-salary roles with has_incentive = false and a non-zero default are the ones that matter
-- most for the salary sheet.
-- ----------------------------------------------------------------------------------------------
select d.name as designation, d.auth_role, d.team_role, d.has_incentive,
       d.default_monthly_salary,
       d.default_allow_ta, d.default_allow_da, d.default_allow_hotel, d.default_allow_other,
       d.is_active
from public.designations d
where d.is_active
order by d.display_order, d.name
limit 60;

-- ==============================================================================================
-- BLOCK 45  [S1]  cost: trivial
-- WHAT: Lead-page photos per week and per day: how many got the card-reader result saved (reps vs
-- admins)
-- WHY: Finds the date photos or the card reader (OCR) stopped working, if it did: a sudden drop in
-- saved results or photo count on one day or week marks the backend or app regression date.
-- HOW TO READ: Run S4 first. IMPORTANT 1: this table only holds photos taken from the LEAD PAGE
-- (photo button on an existing lead). The Scan card button on the New Lead page and inside Log
-- Meeting saves NOTHING, so those scans are invisible here. IMPORTANT 2: 'saved' means the reader
-- answered AND its result was written onto the photo row. Reps may not be allowed to write that
-- second step (see S4 section A), in which case rep_ocr_saved is 0 in every row even when the
-- reader works, and only the admin columns tell you anything. Top rows are weeks (Monday start),
-- bottom rows are the last 30 days, newest first. A day with no row means zero photos that day.
-- Columns: photos = all photos; uploaders = how many different people took them; rep_photos /
-- rep_ocr_saved = photos by sales/telecaller/other staff and how many have a saved reader result;
-- admin_photos / admin_ocr_saved = the same for admin and co_owner; usable_fields = photos where
-- the reader found at least one of name, phone, email or company; classed_as_card = photos the
-- reader judged to be a business card. GOOD: admin_ocr_saved is close to admin_photos in every
-- recent row (and rep_ocr_saved too, if S4 says reps are allowed). BAD: a week or day where
-- admin_photos is 3 or more but admin_ocr_saved is 0 while earlier rows were fine: the reader
-- stopped answering on that date (Edge function, Anthropic key or credit); then check S2 to see if
-- only one app group is affected. If saved results stay normal but usable_fields drops to nearly
-- 0, the reader answers but sees nothing readable (blank, tiny or dark photos, a camera hand-off
-- problem). A drop in 'photos' itself with no change in saved results means people stopped using
-- the button (or the upload step fails before the reader runs). Fewer than 3 photos in a row
-- proves nothing. If photos is 0 for recent days, the lead-page photo button is unused and this
-- query cannot judge the New Lead scan: rely on the live tap test and the Edge log steps listed
-- under manual checks.
-- ----------------------------------------------------------------------------------------------
WITH p AS (
  SELECT (lp.created_at AT TIME ZONE 'Asia/Kolkata')::date AS d,
         date_trunc('week', lp.created_at AT TIME ZONE 'Asia/Kolkata')::date AS wk,
         (lp.ocr_fields IS NOT NULL) AS ocr_ran,
         (btrim(concat_ws('', lp.ocr_fields->>'name', lp.ocr_fields->>'phone',
                          lp.ocr_fields->>'email', lp.ocr_fields->>'company')) <> '') AS usable,
         COALESCE(lp.is_business_card, false) AS is_card,
         COALESCE(u.role IN ('admin', 'co_owner'), false) AS is_admin,
         lp.created_by
    FROM public.lead_photos lp
    LEFT JOIN public.users u ON u.id = lp.created_by
   WHERE lp.created_at >= (date_trunc('week', now() AT TIME ZONE 'Asia/Kolkata') - interval '9 weeks') AT TIME ZONE 'Asia/Kolkata'
)
SELECT grain, bucket, photos, uploaders, rep_photos, rep_ocr_saved, admin_photos, admin_ocr_saved, usable_fields, classed_as_card
FROM (
  SELECT 'week (Mon start)' AS grain, wk::text AS bucket,
         count(*) AS photos,
         count(DISTINCT created_by) AS uploaders,
         count(*) FILTER (WHERE NOT is_admin) AS rep_photos,
         count(*) FILTER (WHERE NOT is_admin AND ocr_ran) AS rep_ocr_saved,
         count(*) FILTER (WHERE is_admin) AS admin_photos,
         count(*) FILTER (WHERE is_admin AND ocr_ran) AS admin_ocr_saved,
         count(*) FILTER (WHERE usable) AS usable_fields,
         count(*) FILTER (WHERE is_card) AS classed_as_card
    FROM p
   GROUP BY wk
  UNION ALL
  SELECT 'day', d::text,
         count(*),
         count(DISTINCT created_by),
         count(*) FILTER (WHERE NOT is_admin),
         count(*) FILTER (WHERE NOT is_admin AND ocr_ran),
         count(*) FILTER (WHERE is_admin),
         count(*) FILTER (WHERE is_admin AND ocr_ran),
         count(*) FILTER (WHERE usable),
         count(*) FILTER (WHERE is_card)
    FROM p
   WHERE d >= (now() AT TIME ZONE 'Asia/Kolkata')::date - 29
   GROUP BY d
) x
ORDER BY grain DESC, bucket DESC
LIMIT 60;

-- ==============================================================================================
-- BLOCK 46  [S2]  cost: trivial
-- WHAT: Same photo/reader results, split by the type of app the person uses now (new phone app,
-- older phone app, web)
-- WHY: Tells whether a problem hits web users and phone-app users alike (backend) or only the
-- phone app (camera/app), and which app group it started in.
-- HOW TO READ: Run S4 first (it tells you whether the 'saved' columns mean anything for reps). One
-- row per week per app type, newest week first. The app type is what the person runs NOW (their
-- last app-open), not what they ran when they took the photo - someone who updated yesterday shows
-- as '96018 or newer' even for older photos, so treat it as a rough guide. Columns are the same as
-- S1: photos, and for reps / for admin-co_owner the number of photos with a saved reader result.
-- If S4 says reps cannot save the result, ignore rep_ocr_saved here and judge only by the photos
-- column (do photos still arrive in every app group?) and the admin columns. GOOD: every group
-- with 3 or more photos shows a similar share of saved results. If the phone-app groups (1 and 2)
-- fail but web (3) is fine, the problem is in the phone app (camera, permission, upload), not the
-- reader. If web fails too from the same week, the reader or backend itself broke that week -
-- match the week to S1. A group with only 1-3 photos is noise. Same blind spot as S1: only
-- lead-page photos are counted, not the New Lead scan.
-- ----------------------------------------------------------------------------------------------
WITH base AS (
  SELECT date_trunc('week', lp.created_at AT TIME ZONE 'Asia/Kolkata')::date AS wk,
         CASE
           WHEN u.id IS NULL THEN '5 uploader not found'
           WHEN u.app_version IS NULL THEN '4 never reported a version'
           WHEN u.app_version = 'web' THEN '3 web / PWA'
           WHEN COALESCE(u.app_version_code, 0) >= 96018 THEN '1 APK 96018 or newer'
           WHEN COALESCE(u.app_version_code, 0) > 0 THEN '2 APK older than 96018'
           ELSE '6 APK version unreadable'
         END AS build_now,
         COALESCE(u.role IN ('admin', 'co_owner'), false) AS is_admin,
         (lp.ocr_fields IS NOT NULL) AS ocr_ran,
         (btrim(concat_ws('', lp.ocr_fields->>'name', lp.ocr_fields->>'phone',
                          lp.ocr_fields->>'email', lp.ocr_fields->>'company')) <> '') AS usable
    FROM public.lead_photos lp
    LEFT JOIN public.users u ON u.id = lp.created_by
   WHERE lp.created_at >= (date_trunc('week', now() AT TIME ZONE 'Asia/Kolkata') - interval '7 weeks') AT TIME ZONE 'Asia/Kolkata'
)
SELECT wk AS week_starting, build_now,
       count(*) AS photos,
       count(*) FILTER (WHERE NOT is_admin) AS rep_photos,
       count(*) FILTER (WHERE NOT is_admin AND ocr_ran) AS rep_ocr_saved,
       count(*) FILTER (WHERE is_admin) AS admin_photos,
       count(*) FILTER (WHERE is_admin AND ocr_ran) AS admin_ocr_saved,
       count(*) FILTER (WHERE usable) AS usable_fields
  FROM base
 GROUP BY wk, build_now
 ORDER BY wk DESC, build_now
 LIMIT 60;

-- ##############################################################################################
-- PART C - CHECK FIRST (only if a block above gave an error)
-- ##############################################################################################

-- ==============================================================================================
-- BLOCK 47  [OS1]  cost: trivial
-- WHAT: Pre-flight: do all the tables, columns and functions these queries use exist in the live
-- database?
-- WHY: Decides whether OS2 to OS10 can run without a 'column does not exist' error, because the
-- live database can differ from the repo files.
-- HOW TO READ: Run this first. You should see two summary rows: 'columns checked / missing' = 30 /
-- 0 and 'functions checked / missing' = 8 / 0, and nothing else. If any row says MISSING, that
-- table, column or function is not in your live database: do not run the other queries, send me
-- those rows first because the later queries would stop with an error.
-- ----------------------------------------------------------------------------------------------
WITH want(tbl, col) AS (
  VALUES
    ('users','id'),('users','name'),('users','email'),('users','role'),('users','team_role'),
    ('users','designation'),('users','is_active'),('users','created_at'),
    ('staff_incentive_profiles','user_id'),('staff_incentive_profiles','monthly_salary'),
    ('staff_incentive_profiles','is_active'),
    ('ops_depots','id'),('ops_depots','assigned_to'),('ops_depots','is_active'),
    ('ops_screens','depot_id'),('ops_screens','is_active'),('ops_screens','status'),
    ('ops_uptime_daily','user_id'),('ops_uptime_daily','work_date'),('ops_uptime_daily','screens_total'),
    ('ops_uptime_daily','screens_up'),('ops_uptime_daily','uptime_pct'),
    ('daily_performance','user_id'),('daily_performance','work_date'),('daily_performance','score_pct'),
    ('daily_performance','is_excluded'),('daily_performance','excluded_reason'),
    ('salary_payouts','user_id'),('salary_payouts','month_year'),('salary_payouts','amount_paid')
),
fn(fname) AS (
  VALUES ('compute_monthly_salaries'),('compute_monthly_salary'),('_compute_monthly_salary_base'),
         ('monthly_score'),('earned_incentive_for'),('_assert_self_or_admin'),('fy_for_date'),('get_my_role')
),
chk AS (
  SELECT w.tbl, w.col, (c.column_name IS NOT NULL) AS present
  FROM want w
  LEFT JOIN information_schema.columns c
    ON c.table_schema = 'public' AND c.table_name = w.tbl AND c.column_name = w.col
),
fchk AS (
  SELECT fn.fname,
         EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.pronamespace = 'public'::regnamespace AND p.proname = fn.fname) AS present
  FROM fn
)
SELECT 'summary' AS section, 'columns checked / missing' AS item,
       count(*)::text || ' / ' || (count(*) FILTER (WHERE NOT present))::text AS value
FROM chk
UNION ALL
SELECT 'summary', 'functions checked / missing',
       count(*)::text || ' / ' || (count(*) FILTER (WHERE NOT present))::text
FROM fchk
UNION ALL
SELECT 'MISSING column', tbl || '.' || col, 'not in live DB' FROM chk WHERE NOT present
UNION ALL
SELECT 'MISSING function', fname, 'not in live DB' FROM fchk WHERE NOT present;

-- ==============================================================================================
-- BLOCK 48  [CALLS-0]  cost: trivial
-- WHAT: Safety check first: do all the tables and columns these queries use really exist in your
-- live database?
-- WHY: Tells us in one run whether any of the other 10 call queries would error (a missing column
-- or a missing trigger), so nothing wastes your time.
-- HOW TO READ: Rows with present_in_live_db = false are listed first. If NO row says false,
-- everything else is safe to run. If some row says false, tell us which one before running the
-- query that uses it (for example users.app_version false = the Phase 208 SQL was never run, so
-- CALLS-1 and CALLS-9 would error; call_capture_log columns false = CALLS-1, CALLS-2 and CALLS-3
-- would error). The trigger and function rows should both be true.
-- ----------------------------------------------------------------------------------------------
SELECT z.kind, z.item, z.present_in_live_db
FROM (
  SELECT 'column' AS kind,
         (e.tbl || '.' || e.col) AS item,
         (ic.column_name IS NOT NULL) AS present_in_live_db
    FROM (VALUES
      ('users','app_version'),('users','app_version_code'),('users','app_version_at'),
      ('users','is_active'),('users','role'),('users','name'),
      ('call_logs','id'),('call_logs','user_id'),('call_logs','lead_id'),('call_logs','client_phone'),
      ('call_logs','call_at'),('call_logs','duration_seconds'),('call_logs','direction'),
      ('call_logs','notes'),('call_logs','outcome'),
      ('call_capture_log','id'),('call_capture_log','user_id'),('call_capture_log','created_at'),
      ('call_capture_log','device_permission'),('call_capture_log','patch_path'),
      ('call_capture_log','device_read_found'),('call_capture_log','device_read_seconds'),
      ('call_capture_log','final_seconds'),('call_capture_log','counted'),
      ('call_capture_log','bg_signal'),
      ('work_sessions','user_id'),('work_sessions','work_date'),('work_sessions','daily_counters'),
      ('lead_activities','created_by'),('lead_activities','lead_id'),
      ('lead_activities','activity_type'),('lead_activities','outcome'),('lead_activities','created_at'),
      ('leads','phone'),('leads','source'),('leads','telecaller_id'),
      ('leads','assigned_to'),('leads','created_at'),
      ('push_subscriptions','user_id'),('push_subscriptions','last_seen_at'),
      ('app_version','version_code'),('app_version','is_active')
    ) AS e(tbl, col)
    LEFT JOIN information_schema.columns ic
           ON ic.table_schema = 'public'
          AND ic.table_name::text = e.tbl
          AND ic.column_name::text = e.col
  UNION ALL
  SELECT 'trigger', 'call_logs.trg_call_logs_dedupe',
         EXISTS (SELECT 1 FROM pg_trigger t
                  WHERE t.tgrelid = to_regclass('public.call_logs')
                    AND t.tgname = 'trg_call_logs_dedupe'
                    AND NOT t.tgisinternal)
  UNION ALL
  SELECT 'function', 'public.call_logs_dedupe_before_insert()',
         EXISTS (SELECT 1 FROM pg_proc p
                   JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public'
                    AND p.proname = 'call_logs_dedupe_before_insert')
) z
ORDER BY z.present_in_live_db, z.kind, z.item;

-- ==============================================================================================
-- BLOCK 49  [HR1]  cost: trivial
-- WHAT: Which offer/HR columns and tables really exist in the live database
-- WHY: Tells us in one run whether offers have any link to recruit candidates and whether the
-- role-signal SQL (phase 285) and the onboarding/recruit tables were ever run, so we know which
-- later checks are safe to trust.
-- HOW TO READ: Look at the 'present' column. hr_offers.candidate_id: false means an offer has no
-- link to the recruit candidate card (expected today, so the two can only be matched by email).
-- The four hr_offers.designation_* rows must all be true; if any is false, the phase 285 SQL was
-- never run, so offers carry no role information and every letter is the sales letter. Rows saying
-- '(whole table exists)' = false mean that table is missing: skip HR5 to HR9 if hr_candidates is
-- missing, and skip HR7 if onboarding_runs is missing.
-- ----------------------------------------------------------------------------------------------
select v.tbl as table_name, v.col as column_name,
       exists (select 1 from information_schema.columns c
               where c.table_schema = 'public' and c.table_name = v.tbl and c.column_name = v.col) as present
from (values
  ('hr_offers','candidate_id'),
  ('hr_offers','designation_auth_role'),
  ('hr_offers','designation_team_role'),
  ('hr_offers','designation_has_incentive'),
  ('hr_offers','designation_name'),
  ('hr_offers','converted_user_id'),
  ('hr_offers','converted_at'),
  ('hr_offers','offer_pdf_url'),
  ('users','contact_email'),
  ('users','whatsapp_number'),
  ('users','signature_mobile'),
  ('users','allow_ta'),
  ('users','allow_da'),
  ('users','allow_hotel'),
  ('users','allow_other'),
  ('designations','default_allow_ta'),
  ('designations','default_allow_other'),
  ('designations','default_monthly_salary'),
  ('hr_candidates','converted_user_id'),
  ('hr_candidates','email'),
  ('email_log','kind')
) as v(tbl, col)
union all
select t.tbl, '(whole table exists)', to_regclass('public.' || t.tbl) is not null
from (values ('hr_candidates'),('onboarding_runs'),('onboarding_templates'),('onboarding_progress'),('email_log'),('staff_incentive_profiles'),('daily_targets'),('designations')) as t(tbl)
order by 1, 2;

-- ##############################################################################################
-- WHAT THIS FILE CANNOT TELL US (manual steps / limits)
-- ##############################################################################################
--
-- [salary]
-- - Studio SQL editor runs as the postgres owner role. SAL8 relies on this (earned_incentive_for
-- is REVOKEd from anon/authenticated and only owner-callable), and SAL3/SAL4/SAL5 rely on it for
-- pg_event_trigger and cron.job. If SAL8 errors with 'permission denied for function
-- earned_incentive_for', switch the role selector to postgres.
-- - The live database matches the repo for earned_incentive_for(uuid, text) (CLAUDE.md section
-- 290: owner ran supabase_hr_d1_earned_incentive_shadow.sql and the engine flip on 2026-09-14). If
-- it was dropped, SAL8 errors 'function ... does not exist' at parse time, before the CASE guard
-- can help.
-- - Whether the Phase 327 audit file (supabase_phase327_salary_change_audit.sql, dated 2026-10-02)
-- has been run is unknown; CLAUDE.md has no section for it yet. SAL1 section 4, SAL6 section 4 and
-- SAL13 report either state, and SAL1/SAL2 expectations mention both.
-- - users.designation is the free-text link to designations.name (no designation_id on users in
-- any repo SQL; the HR wizard writes the designation NAME). SAL7/8/9/10 match case-insensitively
-- on trimmed name; a person with a differently-spelled designation shows as 'no match'.
-- - SAL4 reads cron.job.active via to_jsonb(j) ->> 'active' so a missing column gives NULL rather
-- than an error. cron.job columns jobid, jobname, schedule, command are proven by the owner's own
-- VERIFY blocks; SAL3 tells you first whether cron.job exists.
-- - SAL13 uses query_to_xml and xmltable to read a table that may not exist without a parse error.
-- Both need Postgres built with XML support, which Supabase normally has but nothing in the repo
-- proves; if Studio says 'unsupported XML feature' or an XML error, skip SAL13 and ask for a plain
-- version once SAL1 section 4 says the audit table is installed.
-- - SAL11: track_commit_timestamp is probably OFF on Supabase (unverified); the query handles both
-- states. Counters in pg_stat_user_tables reset on a crash or manual stats reset, so they are
-- hints only. xmin changes on ANY update of a profile row (including is_active flips), so a shared
-- transaction means 'written together', not necessarily 'salary changed'.
-- - The live DB can differ from the repo (a column or policy added or dropped by hand in Studio).
-- Columns used from designations (name, auth_role, team_role, default_monthly_salary,
-- has_incentive, display_order, is_active) come from supabase_phase50_designations_master.sql;
-- hr_offers.converted_user_id/converted_at/fixed_salary_monthly/status from supabase_hr_module.sql
-- (SAL12 only). If SAL7 or SAL12 errors with 'column does not exist', send me the error; the
-- column probe in SAL6 section 1 shows the real columns.
-- - SAL2 only sees salary writes that appear as plain words in a function body (insert into /
-- update / delete from / merge / truncate naming staff_incentive_profiles). A function that
-- assembles the table name from pieces would be missed; the 'builds SQL text' flag only catches
-- ones that also name the table. SAL11 and SAL13 are the backstop for such cases.
-- - SAL5's 'role words in rule' is a text heuristic over the policy expression; for sip_hr_write
-- the words admin/co_owner appear because they are BLOCKED. Read the USING text for the actual
-- meaning. SAL5 section 2 will show full table privileges to anon/authenticated, which is the
-- Supabase default and relies on row security (section 1 must say true).
-- - SAL8 measures the incentive part of Net only (earned_incentive_for from monthly_sales_data)
-- and excludes agency staff on purpose. The sales_manager team-override bonus
-- (staff_incentive_profiles.incentive_override_pct) and travel/daily-allowance claims are not
-- included; for a zero-salary person base, variable and leave deduction are zero by the formula in
-- monthly_score / _compute_monthly_salary_base.
-- - SAL1 reports triggers only in schema public on the three requested tables. Triggers on
-- auth.users or on other tables whose function updates salary are covered by SAL2 (function
-- search), not SAL1.
-- - I read the SQL by hand against the repo and did not execute anything (no local Postgres run,
-- per the read-only rule). Type and syntax checks are mental execution only.
--
-- [ops salary]
-- - I could not run any SQL (read-only job, no database access, no local engine used), so syntax
-- and types were checked by reading only. The riskiest constructs are the POSIX regex classes in
-- OS2/OS3 ([[:space:]], [^[:alnum:]_]), which are standard Postgres, and the CASE WHEN g.safe
-- guard around compute_monthly_salary in OS10.
-- - The live function bodies may differ from the repo copies (db/functions/*.sql are captures
-- dated 2026-06-23 plus later owner changes: Phase 184, Phase 270, HR D1 earned incentive). OS2
-- and OS3 read the live definitions; OS6's pay band is a copy of the repo formula, so OS10 (the
-- live function) is the authoritative number.
-- - OS10 assumes the Supabase Studio SQL editor runs with no login claim so auth.uid() and
-- get_my_role() are NULL and _assert_self_or_admin does not raise. The repo documents this
-- behaviour (supabase_phase97_2_rpc_role_gates.sql:60-71) and the Phase 323 shadow-compare relies
-- on it. If Studio raises 'Restricted: cannot access another user's data', OS10 simply errors (it
-- writes nothing) and the other queries still answer the question.
-- - OS3's write-statement count is a text scan of the function source, not proof by itself; the
-- real proof is the STABLE/IMMUTABLE column. A STABLE function can in theory call a VOLATILE one,
-- which is why OS10 checks all 7 functions in the chain, but helper objects outside this list
-- (daily_ta, leaves, salary_policy, incentive_settings reads; auth.uid()) were only checked in the
-- repo, not live.
-- - Depot/screen assignment in OS6 and OS8 is today's assignment (ops_depots.assigned_to), not
-- what it was in the previous month; last month's depots/screens counts may not reflect who owned
-- stations then.
-- - The test-account detection in OS8 and OS9 is a name/email text match (test, dummy, demo, fake,
-- sample, placeholder, example). A test login whose name and email both look normal is not caught;
-- the OS5 roster and the owner's own knowledge are the backstop. Whether testope1 (Ankit) was
-- already deleted or deactivated cannot be known from files; OS8 shows the live state.
-- - The current date is taken from the database clock in IST. If the owner runs these on the 1st
-- or 2nd of a month, 'this month' shows 0 scored days for everyone; OS6 labels it 'nothing scored
-- yet' and OS10 labels it 'nothing scored yet this month' (not a trap). Read the last-month rows
-- for the real picture.
-- - The 60-row cap in OS7 assumes about 8 or fewer operations people; with more, later names
-- alphabetically are cut off.
-- - users_role_check is assumed to be the version in supabase_ops_p0_foundation.sql (the latest in
-- the repo). OS4 reads the live constraint, so any difference shows up there as 'NO' or 'no role
-- check found'.
--
-- [calls]
-- - The live database may differ from the repo (a column or SQL file never run). CALLS-0 is the
-- guard: run it first and send any 'false' row before the others.
-- - Web versus APK is inferred from users.app_version, which is last-writer-wins (overwritten on
-- every app open from any device). CALLS-1 pairs it with apk_capture_rows_14d and
-- apk_ingest_rows_7d, but a rep who uses both cannot be classified perfectly.
-- - call_capture_log rows with device_permission NULL are assumed to be resume_sweep rows from the
-- APK (callResumeSync.js inserts them without a permission value and only runs on native). If
-- another writer exists in a build not in this repo, those rows could be mislabelled.
-- - The ' (Phase 56l scan)' marker is assumed to be written on every row the APK scan or real-time
-- listener CREATES (callHistoryIngest.js:552). Calls merged into an existing tap row keep the tap
-- note, so apk_ingest_rows undercounts APK activity.
-- - APK 96018 as 'has the real-time incoming listener' is taken from CLAUDE.md section 94; the
-- app_version table and users.app_version_code are assumed to hold the Android versionCode
-- (AppUpdateBanner.jsx reports Android build number).
-- - The expected md5 76cfb2bbbd106860b064066fb50f00a5 was computed from the repo file and matches
-- the live function only if the live body is byte-identical (file header says it was captured from
-- the live DB on 2026-06-23); a mismatch does not by itself mean a bug, the six true/false flags
-- decide.
-- - CALLS-5 and CALLS-6 scan the leads table once with a regex over phone; this is assumed to be
-- tens of thousands of rows (light), which could not be confirmed without running SQL.
-- - Operations people (operation_executive / operation_head) are included in CALLS-1, CALLS-2 and
-- CALLS-4 only; their ticket calls legitimately have no lead, so their no-lead counts are not a
-- bug.
-- - Supabase Studio is assumed to run with standard_conforming_strings on (the default), so the
-- regex escapes written with a single backslash (backslash-D, backslash-plus, backslash-dot)
-- behave as written; the same escape is already used in the repo's own dedupe function.
-- - All day and week boundaries are built explicitly in Asia/Kolkata, but the TelecallerV2 screen
-- itself builds its day start as a bare 'YYYY-MM-DDT00:00:00' string (TelecallerV2.jsx:147), which
-- Postgres reads in the session time zone (normally UTC, i.e. 05:30 IST). This only matters for
-- calls made between 00:00 and 05:30 IST, so CALLS-7 def3 can differ from the on-screen ring only
-- for those hours.
-- - 'Today' in CALLS-7 is a part day if run in the morning (change days_back to 1 for yesterday).
--
-- [HR/offers (hrflow)]
-- - The live database may differ from the repo SQL files. Phase 285 columns on hr_offers are read
-- through to_jsonb(row) in HR3 and HR4, so those two cannot error if the phase 285 file was never
-- run; they would simply show '(none - old offer)'.
-- - HR5 to HR9 assume public.hr_candidates exists (supabase_hr_recruit_p1.sql). HR1 shows this
-- first; HR7 additionally assumes onboarding_runs / onboarding_templates / onboarding_progress
-- exist (supabase_hr_onboard_p1.sql). If a table is missing the dependent query will error with
-- 'relation ... does not exist', which is the answer itself. HR5 and HR11 also assume the phase 57
-- allow_* / default_allow_* columns exist (admin_create_user inserts them, so they almost
-- certainly do; HR1 confirms).
-- - The 11 Sep 2026 cut-off in HR3 comes from the owner-decision date written in
-- src/utils/offerTemplate.js; the real deploy date of the role-letter feature was not found in the
-- repo.
-- - Offers and candidates are matched only by lower-cased trimmed email (no candidate_id exists on
-- hr_offers in the repo). A candidate whose offer used a different email, or who has no email,
-- will show as having no offer in HR8 and HR9.
-- - 'Since 1 June 2026' uses hr_offers.converted_at and hr_candidates.updated_at; updated_at also
-- moves when a candidate card is edited later, so a few older converted candidates could appear or
-- be missed at the boundary.
-- - HR6 reads auth.users (Supabase Studio runs as postgres, so this is allowed) through
-- to_jsonb(au) so it cannot error on a column difference; last_sign_in_date_utc is a UTC date
-- prefix, not IST.
-- - email_log rows are written best-effort by the send endpoint using the service key; a missing
-- row proves 'logged nothing', not strictly 'sent nothing', if the logging call ever failed.
-- - The HR5 note that Create-login drops the salary for sales hires is inferred from reading the
-- code (an AFTER INSERT trigger creates a salary-0 profile row, then HRNewUserV2 does a plain
-- insert on a UNIQUE user_id); the query result is what confirms or refutes it.
-- - No SQL was executed and no local Postgres was available, so syntax was verified by careful
-- reading against the repo schema only; every query is a single SELECT / WITH...SELECT.
--
-- [scan + app versions]
-- - MANUAL STEP - Edge Function logs cannot be read by SQL. In the Supabase dashboard: Edge
-- Functions -> ocr-business-card -> Invocations / Logs tab (or Logs & Analytics -> Edge Functions
-- logs, filter function = ocr-business-card). While the owner taps Scan card on /leads/new from
-- one phone, watch for a new request. NO new log line at all = the request never left the phone
-- (camera/picker/app problem, or the image could not be resized). Status 200 = backend fine. 401 =
-- login token rejected by the Supabase gateway (no supabase/config.toml in the repo, so JWT
-- verification is on by default). 404 = function not deployed. 400 = the phone sent an empty image
-- or bad JSON. 500 = ANTHROPIC_API_KEY missing (Edge Functions -> Secrets). 502 = Anthropic error
-- or non-JSON reply (key, credit or model). Also check the function's last-deployed date in the
-- Edge Functions list and that the ANTHROPIC_API_KEY secret exists.
-- - BLIND SPOT: the failing path (Scan card / Upload on the New Lead page, and Scan card inside
-- Log Meeting) is scan-only - PhotoCapture.jsx skips the upload and the lead_photos insert when no
-- lead id is passed, and the ocr-business-card function writes no table. So the New Lead scan
-- leaves NO trace in the database at all. S1/S2 only measure photos attached on an existing lead's
-- page (same reader, same camera input), a rough health gauge for the reader but not proof the New
-- Lead scan works. If photos are few or zero in recent weeks they say little - the live tap test
-- plus the Edge log steps above are the real test.
-- - PERMISSION GAP (inferred from the repo, not yet seen on the live DB): lead_photos has only
-- lp_read (SELECT), lp_insert (INSERT) and lp_admin (ALL, admin/co_owner). The card-reader result
-- is saved with an UPDATE (PhotoCapture.jsx:88-100). For a non-admin that UPDATE changes 0 rows
-- and returns no error, so ocr_fields would stay NULL for every rep photo regardless of reader
-- health. The live DB could differ (someone may have added a policy by hand), which is exactly
-- what S4 section A and D show. Until S4 is read, treat rep_ocr_saved in S1/S2 as unproven. A side
-- effect worth a ticket later (not part of this read-only job): rep photos never get their OCR
-- text stored for audit.
-- - SQL was NOT executed (no Postgres available in the review environment, and the job is
-- read-only). The earlier author reported a pglast parse check; I re-checked every statement by
-- hand for types, grouping, union shapes and operator precedence, but a typo only a real run would
-- catch is still possible. If any query errors in Studio, paste the error text and the failing id.
-- - users.app_version / app_version_code / app_version_at show the LAST app open of each person
-- (last writer wins), not the build at the moment a photo was taken. A web user has code 0; a
-- person who has not opened the app since the version reporter shipped (6 Jul 2026), or whose app
-- cannot read its own version (the reporter silently skips if the @capacitor/app plugin import
-- fails), shows as NEVER REPORTED even if they use the app daily.
-- - The 'reach' groups in S3 section B rest on facts not stored in the database: (a) the Android
-- app runs in live-update mode (capacitor.config.json server.url = https://app.untitledad.in), so
-- every APK already runs the latest banner code - an APK installed in bundled mode would never
-- show the banner; (b) native installApk exists only from build 96014 (CLAUDE.md ~4712-4768) -
-- older builds fall back to a browser download of the APK; (c) the 96019 threshold is a constant
-- in the nxt CTE - edit it if the next release number differs.
-- - SQL cannot see whether the APK FILE that apk_url points at is really 96019. The updater reads
-- only the app_version table; the file is served from the Supabase apk bucket via /api/apk.
-- Publishing the row without uploading the new file (the 96014 problem recorded in CLAUDE.md
-- ~5246-5262) makes the banner offer an old APK that reinstalls the old version. Check by
-- downloading app.untitledad.in/apk on a phone and reading its version.
-- - Column existence was verified against repo SQL files and live frontend use
-- (TeamDashboardV2.jsx:394 selects users.app_version in production). users.app_version_code and
-- users.app_version_at were created in the same ALTER but are not independently proven live; S4
-- section B counts them. If S2 or S3 returns 'column ... does not exist', re-run
-- supabase_phase208_app_version_report.sql.
-- - Photo counts are small (22 users, attach-mode only), so single-day or single-group rows with
-- 1-3 photos are noise; judge by trend across several rows. All queries are read-only SELECTs,
-- date-bounded (10 weeks / 7 weeks / 45 days; S4 section C reads aggregate min/max/count of the
-- small lead_photos table) and return counts, build strings, role names and staff first names only
-- - no phone numbers, emails or photo paths.

-- VERIFY: nothing to verify - read-only file. Expected: every block returns a table or zero rows, never a write.
