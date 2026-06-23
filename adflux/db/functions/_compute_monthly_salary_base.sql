-- ============================================================================
-- db/functions/_compute_monthly_salary_base.sql — CANONICAL HOME (Phase 178 / Stage 2)
-- ============================================================================
--
-- ⭐ The ONE place _compute_monthly_salary_base is allowed to live. EDIT THIS FILE
--    to change it; never re-paste it into a new phaseN file (§71). It lived in 2
--    files (phase42.1 hotfix, phase97.2). It is the CORE of compute_monthly_salary
--    (the wrapper in db/functions/compute_monthly_salary.sql calls this).
--
-- 💰 MONEY FUNCTION — computes the monthly NET PAYABLE. A change here moves real
--    payroll. Per §71 rule 3, any future CHANGE needs shadow-compare + owner-verify
--    + a one-command revert, never mid-workday. THIS commit is a CAPTURE, not a
--    change — byte-for-byte the live function (dumped 2026-06-23), zero DB run.
--
-- WHAT IT DOES: returns a jsonb salary breakdown for (user, year, month):
--    base + variable (from monthly_score) + incentive (incentive_payouts) +
--    ta_da (daily_ta) − unpaid-leave deduction. Leave: paid up to the FY quota
--    (salary_policy.paid_quota_days, default 12), the rest unpaid; unpaid_deduction
--    = round(base / unpaid_divisor[26] × unpaid_days); half-days count 0.5.
--
-- 🔒 GUARDS (do NOT remove): _assert_self_or_admin(p_user_id) — blocks cross-user
--    salary reads (42501 for anyone else). STABLE SECURITY DEFINER + pg_temp.
--
-- PROVENANCE: captured byte-for-byte from the LIVE DB 2026-06-23 (the phase97.2
--    version). Single signature (uuid, int, int). Running this file is a NO-OP.
--
-- SUPERSEDES (Phase 178 removed the body from both):
--      supabase_phase42_1_hotfix_base_rpc.sql
--      supabase_phase97_2_rpc_role_gates.sql  (real def + a commented rollback copy)
--
-- LOCKED CONTRACTS (a diff that changes any is owner-sign-off): the net_payable
--    formula (base+variable+incentive+ta_da−unpaid_deduction); paid-quota / unpaid-
--    divisor leave math; half-day 0.5; FY-to-date paid-used carry; the auth gate.
--
-- REVERT: re-run this file. TRIPWIRE: VERIFY block at the bottom.
-- ============================================================================

CREATE OR REPLACE FUNCTION public._compute_monthly_salary_base(p_user_id uuid, p_year integer, p_month integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_month_start    date;
  v_month_end      date;
  v_month_year     text;
  v_fy             text;
  v_paid_quota     numeric;
  v_unpaid_divisor int;
  v_monthly_salary numeric := 0;
  v_base           numeric := 0;
  v_variable       numeric := 0;
  v_score_pct      numeric := 0;
  v_working_days   int     := 0;
  v_incentive      numeric := 0;
  v_ta_da          numeric := 0;
  v_leave_total       numeric := 0;
  v_leave_paid_req    numeric := 0;
  v_leave_unpaid_req  numeric := 0;
  v_paid_used_ytd     numeric := 0;
  v_leave_paid        numeric := 0;
  v_leave_unpaid      numeric := 0;
  v_unpaid_deduction  numeric := 0;
  v_fy_start       date;
  v_net            numeric;
  v_score_row      record;
BEGIN
  PERFORM public._assert_self_or_admin(p_user_id);

  v_month_start := make_date(p_year, p_month, 1);
  v_month_end   := (v_month_start + INTERVAL '1 month' - INTERVAL '1 day')::date;
  v_month_year  := to_char(v_month_start, 'YYYY-MM');
  v_fy          := public.fy_for_date(v_month_start);
  v_fy_start    := CASE WHEN p_month >= 4
                          THEN make_date(p_year, 4, 1)
                          ELSE make_date(p_year - 1, 4, 1) END;

  SELECT paid_quota_days, unpaid_divisor
    INTO v_paid_quota, v_unpaid_divisor
    FROM public.salary_policy WHERE fy = v_fy;
  v_paid_quota     := COALESCE(v_paid_quota, 12);
  v_unpaid_divisor := COALESCE(v_unpaid_divisor, 26);

  SELECT * INTO v_score_row
    FROM public.monthly_score(p_user_id, v_month_start)
    LIMIT 1;
  v_monthly_salary := COALESCE(v_score_row.monthly_salary, 0);
  v_base           := COALESCE(v_score_row.base_amount, 0);
  v_variable       := COALESCE(v_score_row.variable_earned, 0);
  v_score_pct      := COALESCE(v_score_row.avg_score_pct, 0);
  v_working_days   := COALESCE(v_score_row.working_days, 0);

  SELECT COALESCE(SUM(amount_paid), 0) INTO v_incentive
    FROM public.incentive_payouts
   WHERE staff_id = p_user_id
     AND month_year = v_month_year;

  SELECT COALESCE(SUM(total_amount), 0) INTO v_ta_da
    FROM public.daily_ta
   WHERE user_id = p_user_id
     AND ta_date BETWEEN v_month_start AND v_month_end;

  SELECT
    COALESCE(SUM(CASE WHEN is_paid_request AND is_half_day  THEN 0.5
                      WHEN is_paid_request                  THEN 1
                      ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN NOT is_paid_request AND is_half_day THEN 0.5
                      WHEN NOT is_paid_request                  THEN 1
                      ELSE 0 END), 0)
  INTO v_leave_paid_req, v_leave_unpaid_req
    FROM public.leaves
   WHERE user_id = p_user_id
     AND status = 'approved'
     AND leave_date BETWEEN v_month_start AND v_month_end;

  v_leave_total := v_leave_paid_req + v_leave_unpaid_req;

  SELECT COALESCE(SUM(CASE WHEN is_half_day THEN 0.5 ELSE 1 END), 0)
    INTO v_paid_used_ytd
    FROM public.leaves
   WHERE user_id = p_user_id
     AND status = 'approved'
     AND is_paid_request = true
     AND leave_date >= v_fy_start
     AND leave_date <  v_month_start;

  v_leave_paid := LEAST(v_leave_paid_req,
                        GREATEST(0, v_paid_quota - v_paid_used_ytd));
  v_leave_unpaid := v_leave_unpaid_req + (v_leave_paid_req - v_leave_paid);

  IF v_base > 0 AND v_unpaid_divisor > 0 THEN
    v_unpaid_deduction := round((v_base / v_unpaid_divisor) * v_leave_unpaid);
  ELSE
    v_unpaid_deduction := 0;
  END IF;

  v_net := round(v_base + v_variable + v_incentive + v_ta_da - v_unpaid_deduction);

  RETURN jsonb_build_object(
    'user_id',            p_user_id,
    'year',               p_year,
    'month',              p_month,
    'fy',                 v_fy,
    'monthly_salary',     v_monthly_salary,
    'base',               round(v_base),
    'variable',           round(v_variable),
    'score_pct',          round(v_score_pct, 1),
    'working_days',       v_working_days,
    'incentive',          v_incentive,
    'ta_da',              v_ta_da,
    'leave_days_total',   v_leave_total,
    'leave_days_paid',    v_leave_paid,
    'leave_days_unpaid',  v_leave_unpaid,
    'leave_paid_req',     v_leave_paid_req,
    'leave_unpaid_req',   v_leave_unpaid_req,
    'paid_quota',         v_paid_quota,
    'paid_used_ytd',      v_paid_used_ytd,
    'unpaid_divisor',     v_unpaid_divisor,
    'unpaid_deduction',   v_unpaid_deduction,
    'net_payable',        v_net
  );
END $function$;

GRANT EXECUTE ON FUNCTION public._compute_monthly_salary_base(uuid, integer, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY / TRIPWIRE — read-only, run any time. All six must be TRUE.
-- ============================================================================
-- SELECT
--   pg_get_functiondef(p.oid) LIKE '%_assert_self_or_admin%'   AS auth_gate,
--   pg_get_functiondef(p.oid) LIKE '%monthly_score%'           AS reads_score,
--   pg_get_functiondef(p.oid) LIKE '%unpaid_divisor%'          AS unpaid_divisor_logic,
--   pg_get_functiondef(p.oid) LIKE '%unpaid_deduction%'        AS unpaid_deduction,
--   pg_get_functiondef(p.oid) LIKE '%is_half_day%'             AS half_day_aware,
--   pg_get_functiondef(p.oid) LIKE '%net_payable%'             AS returns_net
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = '_compute_monthly_salary_base';
