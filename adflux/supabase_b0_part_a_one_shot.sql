-- supabase_b0_part_a_one_shot.sql
--
-- B0 diagnostics, PART A in ONE paste. READ-ONLY - changes nothing, safe to run any time.
--
-- HOW TO RUN (Supabase Studio -> SQL Editor):
--   1. Clear the editor, paste this WHOLE file, click Run. One run, one result table.
--   2. You get 14 rows: block | what | result. The 'result' cell is the answer of that block as text.
--   3. Click the result column header / select all cells, copy, paste back to Claude. If the grid cuts a
--      long cell short, click the cell and copy it from the expanded view, or run the block alone from
--      supabase_b0_diagnostics_2026_10_02.sql (same block id).
--   4. If you see an ERROR instead of a table: copy the whole error text (it names the line) and send it.
--      Do not retry.
--
-- Same 14 queries as Part A of supabase_b0_diagnostics_2026_10_02.sql, each wrapped so all answers come
-- back together. No phone numbers, emails, bank / PAN / Aadhaar details are printed.

SELECT 'SAL1'::text AS block,
       'Is the old designation-to-salary auto-sync really gone, and which triggers are live on the salary tables?'::text AS what,
       (SELECT COALESCE(json_agg(t), '[]'::json) FROM (
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
ORDER BY 1, 2, 3
       ) t)::text AS result
UNION ALL
SELECT 'SAL8'::text AS block,
       'URGENT: people on zero salary who still earn incentive inside Net since September 2026'::text AS what,
       (SELECT COALESCE(json_agg(t), '[]'::json) FROM (
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
ORDER BY 1, 7 DESC, 10 DESC NULLS LAST, 2
       ) t)::text AS result
UNION ALL
SELECT 'SAL9'::text AS block,
       'Active people with no salary profile, or a profile at 0, grouped by role'::text AS what,
       (SELECT COALESCE(json_agg(t), '[]'::json) FROM (
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
ORDER BY 1, 2
       ) t)::text AS result
UNION ALL
SELECT 'OS2'::text AS block,
       'Salary sheet: which roles does the live ''list everyone'' function include, and does it include operations staff?'::text AS what,
       (SELECT COALESCE(json_agg(t), '[]'::json) FROM (
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
                  WHERE t.l ~* 'not in[[:space:]]*[(]'), '(function not found)')
       ) t)::text AS result
UNION ALL
SELECT 'OS8'::text AS block,
       'Test or placeholder accounts that could become payable'::text AS what,
       (SELECT COALESCE(json_agg(t), '[]'::json) FROM (
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
LIMIT 60
       ) t)::text AS result
UNION ALL
SELECT 'OS9'::text AS block,
       'Preview of the people the Salary sheet would newly list (every active role except the 4 now shown and agency)'::text AS what,
       (SELECT COALESCE(json_agg(t), '[]'::json) FROM (
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
LIMIT 60
       ) t)::text AS result
UNION ALL
SELECT 'OS6'::text AS block,
       'Operations pay readiness for this month and last month: stations owned, measured days, and what the 70/30 formula gives today'::text AS what,
       (SELECT COALESCE(json_agg(t), '[]'::json) FROM (
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
ORDER BY x.name, x.ms DESC
       ) t)::text AS result
UNION ALL
SELECT 'CALLS-1'::text AS block,
       'Who is on the website (WEB) and who is on the phone app (APK), and how recently each person opened the app'::text AS what,
       (SELECT COALESCE(json_agg(t), '[]'::json) FROM (
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
 ORDER BY channel_at_last_open, u.role, u.name
       ) t)::text AS result
UNION ALL
SELECT 'CALLS-5'::text AS block,
       'Calls with no lead attached that SHOULD be on a lead: counts per rep only (last 14 days)'::text AS what,
       (SELECT COALESCE(json_agg(t), '[]'::json) FROM (
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
 ORDER BY GROUPING(u.id), unlinked_calls_14d DESC
       ) t)::text AS result
UNION ALL
SELECT 'CALLS-7'::text AS block,
       'The ''five definitions of calls'': the same rep and the same day, side by side (today IST)'::text AS what,
       (SELECT COALESCE(json_agg(t), '[]'::json) FROM (
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
 ORDER BY x.role, x.def1_all_call_log_rows DESC, x.rep
       ) t)::text AS result
UNION ALL
SELECT 'HR2'::text AS block,
       'What the candidate''s public offer page can actually see (live function shape and permissions)'::text AS what,
       (SELECT COALESCE(json_agg(t), '[]'::json) FROM (
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
order by p.proname, p.pronargs
       ) t)::text AS result
UNION ALL
SELECT 'HR3'::text AS block,
       'Accepted and converted offers grouped by role, with the letter each should have had'::text AS what,
       (SELECT COALESCE(json_agg(t), '[]'::json) FROM (
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
order by 1, 2, 3
       ) t)::text AS result
UNION ALL
SELECT 'S4'::text AS block,
       'RUN THIS FIRST - can the card-reader result even be saved on a rep''s photo? (permissions, columns, newest photo)'::text AS what,
       (SELECT COALESCE(json_agg(t), '[]'::json) FROM (
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
LIMIT 60
       ) t)::text AS result
UNION ALL
SELECT 'S3'::text AS block,
       'Which app build is each active person on, can the next build (96019) reach them, and what the in-app updater is offering'::text AS what,
       (SELECT COALESCE(json_agg(t), '[]'::json) FROM (
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
LIMIT 60
       ) t)::text AS result
;

-- VERIFY: expect exactly 14 rows (SAL1 SAL8 SAL9 OS2 OS8 OS9 OS6 CALLS-1 CALLS-5 CALLS-7 HR2 HR3 S4 S3).
