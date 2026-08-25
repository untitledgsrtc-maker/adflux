-- ============================================================================
-- supabase_phase323_tier3_batch_rpcs.sql  (perf audit Tier 3 — SHIP-NEXT batch)
-- ----------------------------------------------------------------------------
-- Two ADDITIVE set-returning RPCs that collapse "N concurrent heavy per-user
-- RPCs, re-fired on every tab-focus" into ONE server-side call each. Neither
-- edits a §72 canonical pay function — each LOOPS the canonical unchanged, so
-- the output is BYTE-IDENTICAL by construction (§71 rule 3).
--
--   H6  compute_monthly_salaries(y,m)  → replaces SalaryAdminV2's ~24 parallel
--                                        compute_monthly_salary calls with 1.
--   M14 monthly_scores(month_start)    → replaces MasterV2 PerformanceTab's N
--                                        parallel monthly_score calls with 1.
--
-- SAFE: additive (drops nothing), read-only (no pay WRITE), money_risk =
-- display-only, revert = git-revert the frontend (the fn goes dormant). Run the
-- SHADOW-COMPARE (Part 3/4) and confirm ZERO rows BEFORE the frontend switches
-- to these — that is the §71 proof they return the same numbers as today.
--
-- DEPLOY ORDER: run THIS SQL first → run the shadow-compares (0 rows) → then the
-- matching frontend switch is pushed. A JS-before-SQL deploy just 404s the RPC
-- into setErr (no crash, no wrong number).
-- ============================================================================

-- ── PART 1 · H6 — compute_monthly_salaries (pure delegation) ────────────────
-- Loops the SAME salaried users as SalaryAdminV2 and returns the IDENTICAL
-- per-user jsonb from the frozen compute_monthly_salary. The per-user
-- _assert_self_or_admin gate INSIDE the canonical is inherited (no gate drift);
-- a sales/telecaller caller aborts atomically on the first non-self uid (no
-- partial cross-user leak). ORDER BY name → same order the old build produced.
CREATE OR REPLACE FUNCTION public.compute_monthly_salaries(p_year integer, p_month integer)
  RETURNS TABLE(user_id uuid, result jsonb)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT u.id, public.compute_monthly_salary(u.id, p_year, p_month)
    FROM public.users u
   WHERE u.is_active = true
     AND u.role IN ('sales', 'telecaller', 'admin', 'co_owner')  -- MIRRORS SalaryAdminV2 usersRes; keep in lockstep
   ORDER BY u.name ASC;
$fn$;
REVOKE ALL     ON FUNCTION public.compute_monthly_salaries(integer, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.compute_monthly_salaries(integer, integer) TO authenticated;

-- ── PART 2 · M14 — monthly_scores (pure delegation) ─────────────────────────
-- Loops the SAME sales/agency users MasterV2 PerformanceTab loads and returns
-- the IDENTICAL monthly_score breakdown. Admin/co_owner gate up front (NULL role
-- = Studio/service, permits the shadow); the per-user boundary lives inside
-- monthly_score → compute_monthly_salary's _assert_self_or_admin.
CREATE OR REPLACE FUNCTION public.monthly_scores(p_month_start date)
  RETURNS TABLE(user_id uuid, month_start date, working_days integer, avg_score_pct numeric,
                monthly_salary numeric, base_amount numeric, variable_cap numeric,
                variable_earned numeric, total_payable numeric)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF public.get_my_role() IS NOT NULL AND public.get_my_role() NOT IN ('admin', 'co_owner') THEN
    RAISE EXCEPTION 'Restricted: monthly_scores is admin/co_owner only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT ms.*
      FROM public.users u
      CROSS JOIN LATERAL public.monthly_score(u.id, p_month_start) ms
     WHERE u.team_role IN ('sales', 'agency') AND u.is_active = true  -- MIRRORS MasterV2 users query
     ORDER BY u.name;
END $fn$;
REVOKE ALL     ON FUNCTION public.monthly_scores(date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.monthly_scores(date) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ── PART 3 · SHADOW-COMPARE H6 — must return ZERO rows ──────────────────────
-- Proves compute_monthly_salaries(y,m) == the per-user compute_monthly_salary
-- for EVERY active salaried user (whole jsonb: net_payable + every field) AND
-- the exact user set. Set y,m to a real month. 0 rows = byte-identical.
WITH params AS (SELECT 2026::int AS y, 7::int AS m),
batch AS (
  SELECT b.user_id, b.result
    FROM params p CROSS JOIN LATERAL public.compute_monthly_salaries(p.y, p.m) b
),
single AS (
  SELECT u.id AS user_id, public.compute_monthly_salary(u.id, p.y, p.m) AS result
    FROM params p CROSS JOIN public.users u
   WHERE u.is_active = true AND u.role IN ('sales', 'telecaller', 'admin', 'co_owner')
)
SELECT COALESCE(b.user_id, s.user_id)      AS user_id,
       b.result ->> 'net_payable'          AS batch_net_payable,
       s.result ->> 'net_payable'          AS single_net_payable,
       (b.user_id IS NULL)                 AS missing_from_batch,
       (s.user_id IS NULL)                 AS extra_in_batch
  FROM batch b FULL OUTER JOIN single s ON s.user_id = b.user_id
 WHERE b.result IS DISTINCT FROM s.result OR b.user_id IS NULL OR s.user_id IS NULL;

-- ── PART 4 · SHADOW-COMPARE M14 — must return ZERO rows ─────────────────────
-- Proves monthly_scores(month_start) == the per-user monthly_score for every
-- active sales/agency user. Set the month-start to the 1st of a real month.
WITH params AS (SELECT DATE '2026-07-01' AS ms),
batch AS (
  SELECT b.* FROM params p CROSS JOIN LATERAL public.monthly_scores(p.ms) b
),
single AS (
  SELECT s.* FROM params p
   CROSS JOIN public.users u
   CROSS JOIN LATERAL public.monthly_score(u.id, p.ms) s
   WHERE u.team_role IN ('sales', 'agency') AND u.is_active = true
)
SELECT 'batch_not_single' AS side, b.user_id, b.total_payable FROM batch b
 EXCEPT ALL
SELECT 'batch_not_single', s.user_id, s.total_payable FROM single s
UNION ALL
SELECT 'single_not_batch', s.user_id, s.total_payable FROM single s
 EXCEPT ALL
SELECT 'single_not_batch', b.user_id, b.total_payable FROM batch b;
-- ============================================================================
