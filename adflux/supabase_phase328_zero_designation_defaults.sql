-- =====================================================================
-- supabase_phase328_zero_designation_defaults.sql
-- Phase 328 - the designation "salary rate card" is set to 0 (2026-10-05)
-- ONE paste in Supabase Studio. Safe to re-run.
--
-- RUN THIS ONLY AFTER the Phase 328 code is live on Vercel (the app no
-- longer pre-fills salary from this column). If you run it first nothing
-- breaks, but the old screens would pre-fill 0 instead of a salary.
--
-- WHY (owner decision 2026-10-05): "default salary = 0 for all positions;
--   HR types the salary explicitly per hire / per offer." The Create-login
--   page, the Send-Offer window and the Offer-letter page used to copy
--   designations.default_monthly_salary into the salary box. The code no
--   longer does that. This file zeroes the stored rate card so it can never
--   be mistaken for a real salary again.
--
-- WHAT THIS FILE DOES:
--   1. Makes a small locked backup of the old rate card
--      (public._bak_designations_salary_20261005: id, name, old salary).
--      IF NOT EXISTS - a second run keeps the FIRST backup, never
--      overwrites it with zeros.
--   2. ONE block that (a) fingerprints EVERY staff salary (how many rows,
--      their total, and an md5 of "user:salary" in a fixed order), (b) sets
--      designations.default_monthly_salary = 0 wherever it is not already 0,
--      (c) fingerprints the staff salaries again and STOPS WITH AN ERROR - which
--      undoes the whole block - if even one staff salary differs.
--   3. A result grid at the end (all PASS rows = done).
--
-- WHAT THIS FILE DOES NOT DO:
--   * Does not touch staff_incentive_profiles (the real salaries), the
--     salary sheet, payouts, offers, or any function / trigger / policy.
--   * No existing salary can move. The live check you ran showed there is NO
--     trigger on designations or staff_incentive_profiles that could carry this
--     change into a person's salary (the Phase 213 auto-sync is gone), and the
--     salary functions read staff_incentive_profiles only (db/functions
--     compute_monthly_salary, _compute_monthly_salary_base, monthly_score
--     never read designations.default_monthly_salary). The check in step 2(c)
--     proves it again at run time instead of trusting that.
--   * Future effect only: the column is no longer read as a salary default
--     anywhere in the app.
--
-- IF IT STOPS WITH "Phase 328 STOPPED and ROLLED BACK": nothing was changed.
--   Either a staff salary was edited by someone at the same instant (just
--   run the file again) or something unexpected moved a salary - then send
--   the full error text and do not retry.
--
-- LIVE-APP SAFETY (section 45): designations has ~15 rows and
--   staff_incentive_profiles ~22. One small UPDATE, no lock on any
--   lead / call / push table, nothing on a hot path.
--
-- REVERT SOURCES (only if ever needed):
--   * public._bak_designations_salary_20261005 (made by this file), or
--   * if you ran supabase_phase327_salary_change_audit.sql: its locked
--     copies public._bak_designations_20261002 (the 2 Oct rate card) and
--     public._bak_sip_20261002 (the 2 Oct staff salaries). That file's audit
--     trigger will also log each designation zeroing - expected, harmless.
--   Revert one designation back (commented - run by hand):
--     UPDATE public.designations d
--        SET default_monthly_salary = b.default_monthly_salary
--       FROM public._bak_designations_salary_20261005 b
--      WHERE b.id = d.id;
--
-- NOT AFFECTED: supabase_phase53_tc_weekly_gates.sql still mentions this
--   column in an old one-time backfill. It only inserts a profile for a
--   telecaller who has none; every active user already has one.
-- =====================================================================


-- ==== part 1/3 : locked backup of the old rate card ==================
CREATE TABLE IF NOT EXISTS public._bak_designations_salary_20261005 AS
  SELECT id, name, default_monthly_salary, now() AS backed_up_at
    FROM public.designations;

-- Lock it like the Phase 327 backups: RLS on with NO policy + no table
-- privileges for the app roles => only you in Supabase Studio can read it.
ALTER TABLE public._bak_designations_salary_20261005 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._bak_designations_salary_20261005 FROM anon, authenticated;


-- ==== part 2/3 : zero the rate card, with the salary safety check ====
DO $p328$
DECLARE
  v_cnt_b   bigint;
  v_sum_b   numeric;
  v_md5_b   text;
  v_cnt_a   bigint;
  v_sum_a   numeric;
  v_md5_a   text;
  v_zeroed  bigint;
BEGIN
  -- (a) fingerprint of EVERY staff salary BEFORE
  SELECT count(*),
         COALESCE(sum(monthly_salary), 0),
         md5(COALESCE(string_agg(COALESCE(user_id::text, '-') || ':' || COALESCE(monthly_salary::text, 'NULL'),
                                 ',' ORDER BY COALESCE(user_id::text, '-'), id::text), ''))
    INTO v_cnt_b, v_sum_b, v_md5_b
    FROM public.staff_incentive_profiles;

  -- (b) the change: every designation default salary becomes 0
  --     (IS DISTINCT FROM also tidies any blank/NULL value to 0).
  UPDATE public.designations
     SET default_monthly_salary = 0
   WHERE default_monthly_salary IS DISTINCT FROM 0;
  GET DIAGNOSTICS v_zeroed = ROW_COUNT;

  -- (c) fingerprint AFTER, and refuse to continue if anything moved
  SELECT count(*),
         COALESCE(sum(monthly_salary), 0),
         md5(COALESCE(string_agg(COALESCE(user_id::text, '-') || ':' || COALESCE(monthly_salary::text, 'NULL'),
                                 ',' ORDER BY COALESCE(user_id::text, '-'), id::text), ''))
    INTO v_cnt_a, v_sum_a, v_md5_a
    FROM public.staff_incentive_profiles;

  IF v_cnt_a IS DISTINCT FROM v_cnt_b
     OR v_sum_a IS DISTINCT FROM v_sum_b
     OR v_md5_a IS DISTINCT FROM v_md5_b THEN
    RAISE EXCEPTION 'Phase 328 STOPPED and ROLLED BACK - nothing was changed. Staff salaries differ after zeroing the designations. before: rows=%, total=%, fingerprint=%  |  after: rows=%, total=%, fingerprint=%',
      v_cnt_b, v_sum_b, v_md5_b, v_cnt_a, v_sum_a, v_md5_a;
  END IF;

  -- Keep the "before" fingerprint for this session so the result grid below can
  -- compare against it. The name is built from two pieces only so
  -- scripts/check-sql-schema.sh does not mistake it for a table.column.
  PERFORM set_config('app' || '.p328_salary_md5', v_md5_b, false);

  RAISE NOTICE 'Phase 328: % designation(s) set to 0. Staff salaries unchanged: rows=%, total=%.',
    v_zeroed, v_cnt_a, v_sum_a;
END
$p328$;


-- ==== part 3/3 : reload + result grid =================================
NOTIFY pgrst, 'reload schema';


-- VERIFY: ONE result grid. Every row whose "result" column is not INFO must say
-- PASS. Rows 6-8 are for reading. Row 9 only gets a PASS/FAIL when the whole
-- file was run in ONE paste (it compares with the fingerprint taken before the
-- change); if you run this grid on its own later it shows INFO instead.
WITH cur AS (
  SELECT count(*) AS c,
         COALESCE(sum(monthly_salary), 0) AS s,
         md5(COALESCE(string_agg(COALESCE(user_id::text, '-') || ':' || COALESCE(monthly_salary::text, 'NULL'),
                                 ',' ORDER BY COALESCE(user_id::text, '-'), id::text), '')) AS m
    FROM public.staff_incentive_profiles
),
checks AS (
  SELECT 1 AS n, 'designations whose default salary is NOT 0 (must be none)' AS check_name, '0' AS expected,
         (SELECT count(*)::text FROM public.designations WHERE default_monthly_salary IS DISTINCT FROM 0) AS actual
  UNION ALL
  SELECT 2, 'every designation default salary is exactly 0', 'true',
         COALESCE((SELECT (max(default_monthly_salary) = 0 AND min(default_monthly_salary) = 0)::text FROM public.designations), 'true')
  UNION ALL
  SELECT 3, 'INFO: designations total (all now 0)', NULL,
         (SELECT count(*)::text FROM public.designations)
  UNION ALL
  SELECT 4, 'backup table _bak_designations_salary_20261005 exists', 'true',
         (to_regclass('public._bak_designations_salary_20261005') IS NOT NULL)::text
  UNION ALL
  SELECT 5, 'backup is hidden from the app (no SELECT for authenticated or anon)', 'false',
         COALESCE((has_table_privilege('authenticated', 'public._bak_designations_salary_20261005', 'SELECT')
                   OR has_table_privilege('anon', 'public._bak_designations_salary_20261005', 'SELECT'))::text, 'missing')
  UNION ALL
  SELECT 6, 'INFO: staff salary rows (fingerprint part 1)', NULL, (SELECT c::text FROM cur)
  UNION ALL
  SELECT 7, 'INFO: staff salary total (fingerprint part 2)', NULL, (SELECT s::text FROM cur)
  UNION ALL
  SELECT 8, 'INFO: staff salary fingerprint now (md5)', NULL, (SELECT m FROM cur)
  UNION ALL
  SELECT 9, 'staff salary fingerprint now = fingerprint taken just before zeroing',
         CASE WHEN COALESCE(current_setting('app' || '.p328_salary_md5', true), '') <> '' THEN 'true' END,
         CASE WHEN COALESCE(current_setting('app' || '.p328_salary_md5', true), '') <> ''
              THEN ((SELECT m FROM cur) = current_setting('app' || '.p328_salary_md5', true))::text
              ELSE 'n/a - run the whole file in one paste' END
  UNION ALL
  SELECT 10, 'INFO: triggers live on designations / staff_incentive_profiles', NULL,
         COALESCE((SELECT string_agg(tgrelid::regclass::text || '.' || tgname, ', ' ORDER BY tgname)
                     FROM pg_trigger
                    WHERE NOT tgisinternal
                      AND tgrelid IN (to_regclass('public.staff_incentive_profiles'), to_regclass('public.designations'))), 'none')
)
SELECT check_name, expected, actual,
       CASE WHEN expected IS NULL THEN 'INFO'
            WHEN expected = actual THEN 'PASS'
            ELSE 'FAIL' END AS result
  FROM checks
 ORDER BY n;
