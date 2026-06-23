-- ============================================================================
-- db/functions/compute_monthly_salary.sql — CANONICAL HOME (Phase 178 / Stage 2)
-- ============================================================================
--
-- ⭐ The ONE place compute_monthly_salary is allowed to live. EDIT THIS FILE to
--    change it; never re-paste it into a new phaseN file (§71). It was the MOST
--    duplicated function in the codebase — 9 files (phase36, 36.4, 36.5, 36.7,
--    36.8, 36.10, 42, 97.2, 101.a1). Every salary tweak re-pasted the whole thing.
--
-- 💰 MONEY FUNCTION — THE payroll RPC. This is what SalaryAdminV2 / TotalPayableCard
--    / RepPerformanceCard read to show + pay net salary. A change here moves real
--    payroll. Per §71 rule 3, any future CHANGE needs shadow-compare + owner-verify
--    + a one-command revert, never mid-workday. THIS commit is a CAPTURE, not a
--    change — byte-for-byte the live function (dumped 2026-06-23), zero DB run.
--
-- WHAT IT DOES: the wrapper around _compute_monthly_salary_base. (a) auth gate;
--    (b) AGENCY short-circuit — agency role is commission-only → returns the full
--    key set zeroed with ok=false; (c) calls the base for everyone else; (d)
--    sales_manager OVERRIDE — if the user is a manager with incentive_override_pct,
--    adds round(team_revenue × pct/100) to incentive + net_payable.
--
-- ⚠ DEPENDS ON db/functions/_compute_monthly_salary_base.sql — on a FRESH install
--    run the base FIRST, then this. On the live DB both already exist.
--
-- 🔒 GUARDS (do NOT remove): _assert_self_or_admin(p_user_id) FIRST (blocks
--    cross-user salary reads, 42501). STABLE SECURITY DEFINER + pg_temp.
--
-- PROVENANCE: captured byte-for-byte from the LIVE DB 2026-06-23 (the phase101.a1
--    agency-split version). Single signature (uuid, int, int). Running = NO-OP.
--
-- SUPERSEDES (Phase 178 removed the body from each):
--      supabase_phase36_salary_policy.sql
--      supabase_phase36_4_salary_include_claims.sql
--      supabase_phase36_5_salary_incentive_columns.sql
--      supabase_phase36_7_claim_kinds_hotel_other.sql
--      supabase_phase36_8_merge_claims_into_daily_ta.sql
--      supabase_phase36_10_paid_leave_tenure.sql
--      supabase_phase42_sales_manager.sql
--      supabase_phase97_2_rpc_role_gates.sql  (real def + a commented rollback copy)
--      supabase_phase101_a1_agency_split.sql  (the live body)
--
-- LOCKED CONTRACTS (a diff that changes any is owner-sign-off): the auth gate;
--    the agency short-circuit (commission-only, zeros, ok=false); the sales_manager
--    incentive_override_pct × team_revenue add to incentive + net_payable; calling
--    the base for the core breakdown.
--
-- REVERT: re-run this file (after the base). TRIPWIRE: VERIFY block at the bottom.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.compute_monthly_salary(p_user_id uuid, p_year integer, p_month integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role             text;
  v_result           jsonb;
  v_is_manager       boolean;
  v_override_pct     numeric;
  v_team_revenue     numeric;
  v_override_amount  numeric := 0;
  v_month_year       text := lpad(p_year::text, 4, '0') || '-' || lpad(p_month::text, 2, '0');
  v_fy               text;
BEGIN
  -- (a) Auth gate FIRST. Blocks cross-user reads. Self / admin /
  --     co_owner reach the next line; everyone else 42501.
  PERFORM public._assert_self_or_admin(p_user_id);

  -- (b) Fetch target role under the gate.
  SELECT role INTO v_role FROM public.users WHERE id = p_user_id;

  -- (c) Phase 101.A1 agency short-circuit. Returns the full
  --     consumer-snake_case key set with zeros. `ok=false` lets
  --     future code discriminate; legacy code reading individual
  --     fields with `|| 0` defaults degrades cleanly.
  IF v_role = 'agency' THEN
    v_fy := public.fy_for_date(make_date(p_year, p_month, 1));
    RETURN jsonb_build_object(
      'ok',                false,
      'reason',            'agency role — commission-only, no salary',
      'user_id',           p_user_id,
      'year',              p_year,
      'month',             p_month,
      'fy',                v_fy,
      'monthly_salary',    0,
      'base',              0,
      'variable',          0,
      'score_pct',         0,
      'working_days',      0,
      'incentive',         0,
      'ta_da',             0,
      'ta_from_pings',     0,
      'ta_from_claims',    0,
      'leave_days_total',  0,
      'leave_days_paid',   0,
      'leave_days_unpaid', 0,
      'paid_quota',        0,
      'paid_used_ytd',     0,
      'unpaid_divisor',    26,
      'unpaid_deduction',  0,
      'net_payable',       0
    );
  END IF;

  -- (d) Non-agency path — verbatim from
  --     supabase_phase97_2_rpc_role_gates.sql:343-374.
  SELECT (team_role = 'sales_manager') INTO v_is_manager
    FROM public.users WHERE id = p_user_id;
  v_is_manager := COALESCE(v_is_manager, false);

  SELECT public._compute_monthly_salary_base(p_user_id, p_year, p_month) INTO v_result;

  IF v_is_manager THEN
    SELECT incentive_override_pct INTO v_override_pct
      FROM public.staff_incentive_profiles
     WHERE user_id = p_user_id;

    IF v_override_pct IS NOT NULL AND v_override_pct > 0 THEN
      SELECT COALESCE(SUM(COALESCE(new_client_revenue, 0) + COALESCE(renewal_revenue, 0)), 0)
        INTO v_team_revenue
        FROM public.monthly_sales_data
       WHERE staff_id IN (SELECT id FROM public.users WHERE manager_id = p_user_id)
         AND month_year = v_month_year;

      v_override_amount := round(v_team_revenue * (v_override_pct / 100.0));

      v_result := v_result
        || jsonb_build_object(
             'team_revenue',     v_team_revenue,
             'override_pct',     v_override_pct,
             'override_amount',  v_override_amount,
             'incentive',        (COALESCE((v_result->>'incentive')::numeric, 0) + v_override_amount),
             'net_payable',      (COALESCE((v_result->>'net_payable')::numeric, 0) + v_override_amount)
           );
    END IF;
  END IF;

  RETURN v_result;
END $function$;

GRANT EXECUTE ON FUNCTION public.compute_monthly_salary(uuid, integer, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY / TRIPWIRE — read-only, run any time. All six must be TRUE.
-- ============================================================================
-- SELECT
--   pg_get_functiondef(p.oid) LIKE '%_assert_self_or_admin%'           AS auth_gate,
--   pg_get_functiondef(p.oid) LIKE '%commission-only%'                 AS agency_shortcircuit,
--   pg_get_functiondef(p.oid) LIKE '%_compute_monthly_salary_base%'    AS calls_base,
--   pg_get_functiondef(p.oid) LIKE '%sales_manager%'                   AS manager_check,
--   pg_get_functiondef(p.oid) LIKE '%incentive_override_pct%'          AS manager_override,
--   pg_get_functiondef(p.oid) LIKE '%override_amount%'                 AS override_add
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = 'compute_monthly_salary';
