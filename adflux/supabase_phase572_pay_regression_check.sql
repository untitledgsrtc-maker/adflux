-- =====================================================================
-- Phase 572 — automatic pay checks (salary, incentive, TA) (17 Nov 2026)
-- =====================================================================
-- Goal: catch a silent pay bug the day it appears, not when staff complain.
-- (1) BASELINE: once a month is fully paid (salary_payouts.is_full_payment),
--     the salary calculation for that person+month is saved in pay_baseline.
--     A paid month should never change. Every morning the calculation is run
--     again; any difference over Rs 1 (or 0.1 score point) is a regression:
--     someone changed a rule or old data.
-- (2) SANITY: for this month and last month, every active person with a pay
--     profile must get a sane result: net pay present and >= 0, TA >= 0,
--     unpaid deduction >= 0, score between 0 and 100.
-- (3) Each run writes pay_check_runs. If anything is wrong, the admin gets ONE
--     push a day ("Pay check: N problems").
-- Uses _compute_monthly_salary_base (STABLE, read-only; it includes TA/DA,
-- incentive, leave and half-day rules), so the check writes no pay data.
-- After an owner-approved rule change that legitimately moves an old month:
--     SELECT public.pay_capture_baseline('2026-09-01', true);
-- Rollback: SELECT cron.unschedule('pay-regression-check'); DROP FUNCTION
-- public.pay_regression_check(), public.pay_capture_baseline(date, boolean);
-- DROP TABLE public.pay_check_runs, public.pay_baseline;
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.pay_baseline (
  user_id          uuid NOT NULL,
  month_start      date NOT NULL,
  net_payable      numeric,
  base             numeric,
  variable         numeric,
  incentive        numeric,
  ta_da            numeric,
  unpaid_deduction numeric,
  score_pct        numeric,
  working_days     numeric,
  late_half_days   numeric,
  captured_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, month_start)
);

CREATE TABLE IF NOT EXISTS public.pay_check_runs (
  id              bigserial PRIMARY KEY,
  at              timestamptz NOT NULL DEFAULT now(),
  baseline_rows   integer NOT NULL,
  mismatches      integer NOT NULL,
  sanity_checked  integer NOT NULL,
  sanity_fails    integer NOT NULL,
  details         jsonb NOT NULL DEFAULT '[]'::jsonb,
  alerted         boolean NOT NULL DEFAULT false
);

ALTER TABLE public.pay_baseline   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pay_check_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pay_baseline_read ON public.pay_baseline;
CREATE POLICY pay_baseline_read ON public.pay_baseline
  FOR SELECT USING (get_my_role() = ANY (ARRAY['admin'::text, 'co_owner'::text, 'accounts'::text]));
DROP POLICY IF EXISTS pay_check_runs_read ON public.pay_check_runs;
CREATE POLICY pay_check_runs_read ON public.pay_check_runs
  FOR SELECT USING (get_my_role() = ANY (ARRAY['admin'::text, 'co_owner'::text, 'accounts'::text]));
REVOKE ALL ON public.pay_baseline, public.pay_check_runs FROM anon, authenticated;
GRANT SELECT ON public.pay_baseline, public.pay_check_runs TO authenticated;

-- save the calculation for every fully paid person in a month
CREATE OR REPLACE FUNCTION public.pay_capture_baseline(p_month_start date, p_replace boolean DEFAULT false)
  RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_u uuid; v_j jsonb; v_n integer := 0;
BEGIN
  FOR v_u IN
    SELECT DISTINCT sp.user_id FROM public.salary_payouts sp
     WHERE sp.month_year = to_char(p_month_start, 'YYYY-MM') AND sp.is_full_payment
  LOOP
    IF NOT p_replace AND EXISTS (SELECT 1 FROM public.pay_baseline b WHERE b.user_id = v_u AND b.month_start = p_month_start) THEN
      CONTINUE;
    END IF;
    v_j := public._compute_monthly_salary_base(v_u, EXTRACT(YEAR FROM p_month_start)::int, EXTRACT(MONTH FROM p_month_start)::int);
    INSERT INTO public.pay_baseline (user_id, month_start, net_payable, base, variable, incentive, ta_da,
                                     unpaid_deduction, score_pct, working_days, late_half_days, captured_at)
    VALUES (v_u, p_month_start, (v_j->>'net_payable')::numeric, (v_j->>'base')::numeric, (v_j->>'variable')::numeric,
            (v_j->>'incentive')::numeric, (v_j->>'ta_da')::numeric, (v_j->>'unpaid_deduction')::numeric,
            (v_j->>'score_pct')::numeric, (v_j->>'working_days')::numeric, (v_j->>'late_half_days')::numeric, now())
    ON CONFLICT (user_id, month_start) DO UPDATE SET
      net_payable = EXCLUDED.net_payable, base = EXCLUDED.base, variable = EXCLUDED.variable,
      incentive = EXCLUDED.incentive, ta_da = EXCLUDED.ta_da, unpaid_deduction = EXCLUDED.unpaid_deduction,
      score_pct = EXCLUDED.score_pct, working_days = EXCLUDED.working_days,
      late_half_days = EXCLUDED.late_half_days, captured_at = now();
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.pay_capture_baseline(date, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pay_regression_check()
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_today   date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_this    date := date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))::date;
  v_m       date;
  b         record;
  v_u       record;
  v_j       jsonb;
  v_diff    jsonb;
  v_details jsonb := '[]'::jsonb;
  v_rows int := 0; v_mis int := 0; v_san int := 0; v_fail int := 0;
  v_alert boolean := false;
  v_admin record;
BEGIN
  -- 1) baseline any fully paid past month not captured yet (last 6 months)
  FOR v_m IN SELECT generate_series(v_this - interval '6 months', v_this - interval '1 month', interval '1 month')::date LOOP
    PERFORM public.pay_capture_baseline(v_m, false);
  END LOOP;

  -- 2) a paid month must not change
  FOR b IN SELECT * FROM public.pay_baseline LOOP
    v_rows := v_rows + 1;
    v_j := public._compute_monthly_salary_base(b.user_id, EXTRACT(YEAR FROM b.month_start)::int, EXTRACT(MONTH FROM b.month_start)::int);
    v_diff := '{}'::jsonb;
    IF abs(COALESCE((v_j->>'net_payable')::numeric,0) - COALESCE(b.net_payable,0)) > 1 THEN v_diff := v_diff || jsonb_build_object('net_payable', jsonb_build_array(b.net_payable, v_j->'net_payable')); END IF;
    IF abs(COALESCE((v_j->>'base')::numeric,0) - COALESCE(b.base,0)) > 1 THEN v_diff := v_diff || jsonb_build_object('base', jsonb_build_array(b.base, v_j->'base')); END IF;
    IF abs(COALESCE((v_j->>'variable')::numeric,0) - COALESCE(b.variable,0)) > 1 THEN v_diff := v_diff || jsonb_build_object('variable', jsonb_build_array(b.variable, v_j->'variable')); END IF;
    IF abs(COALESCE((v_j->>'incentive')::numeric,0) - COALESCE(b.incentive,0)) > 1 THEN v_diff := v_diff || jsonb_build_object('incentive', jsonb_build_array(b.incentive, v_j->'incentive')); END IF;
    IF abs(COALESCE((v_j->>'ta_da')::numeric,0) - COALESCE(b.ta_da,0)) > 1 THEN v_diff := v_diff || jsonb_build_object('ta_da', jsonb_build_array(b.ta_da, v_j->'ta_da')); END IF;
    IF abs(COALESCE((v_j->>'unpaid_deduction')::numeric,0) - COALESCE(b.unpaid_deduction,0)) > 1 THEN v_diff := v_diff || jsonb_build_object('unpaid_deduction', jsonb_build_array(b.unpaid_deduction, v_j->'unpaid_deduction')); END IF;
    IF abs(COALESCE((v_j->>'score_pct')::numeric,0) - COALESCE(b.score_pct,0)) > 0.1 THEN v_diff := v_diff || jsonb_build_object('score_pct', jsonb_build_array(b.score_pct, v_j->'score_pct')); END IF;
    IF v_diff <> '{}'::jsonb THEN
      v_mis := v_mis + 1;
      v_details := v_details || jsonb_build_object('type','paid_month_changed','user_id',b.user_id,
                     'name',(SELECT name FROM public.users WHERE id=b.user_id),'month',to_char(b.month_start,'YYYY-MM'),'was_now',v_diff);
    END IF;
  END LOOP;

  -- 3) sanity for this month and last month
  FOR v_m IN SELECT unnest(ARRAY[v_this, (v_this - interval '1 month')::date]) LOOP
    FOR v_u IN SELECT u.id, u.name FROM public.users u JOIN public.staff_incentive_profiles sip ON sip.user_id = u.id
                WHERE u.is_active LOOP
      v_san := v_san + 1;
      BEGIN
        v_j := public._compute_monthly_salary_base(v_u.id, EXTRACT(YEAR FROM v_m)::int, EXTRACT(MONTH FROM v_m)::int);
        IF v_j IS NULL OR v_j->>'net_payable' IS NULL
           OR (v_j->>'net_payable')::numeric < 0
           OR COALESCE((v_j->>'ta_da')::numeric,0) < 0
           OR COALESCE((v_j->>'unpaid_deduction')::numeric,0) < 0
           OR COALESCE((v_j->>'score_pct')::numeric,0) NOT BETWEEN 0 AND 100 THEN
          v_fail := v_fail + 1;
          v_details := v_details || jsonb_build_object('type','not_sane','user_id',v_u.id,'name',v_u.name,
                         'month',to_char(v_m,'YYYY-MM'),'result',v_j);
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_fail := v_fail + 1;
        v_details := v_details || jsonb_build_object('type','error','user_id',v_u.id,'name',v_u.name,
                       'month',to_char(v_m,'YYYY-MM'),'error',SQLERRM);
      END;
    END LOOP;
  END LOOP;

  -- 4) one push a day to the admin when something is wrong
  IF (v_mis + v_fail) > 0 AND NOT EXISTS (
       SELECT 1 FROM public.pay_check_runs r WHERE r.alerted AND (r.at AT TIME ZONE 'Asia/Kolkata')::date = v_today) THEN
    v_alert := true;
    FOR v_admin IN SELECT id FROM public.users WHERE role = 'admin' AND is_active LOOP
      PERFORM public.enqueue_push(v_admin.id, 'Pay check: ' || (v_mis + v_fail) || ' problem(s)',
        format('%s paid month(s) changed, %s calculation(s) look wrong. Open pay_check_runs for details.', v_mis, v_fail),
        '/people?tab=salary', 'pay-check');
    END LOOP;
  END IF;

  INSERT INTO public.pay_check_runs (baseline_rows, mismatches, sanity_checked, sanity_fails, details, alerted)
  VALUES (v_rows, v_mis, v_san, v_fail, v_details, v_alert);

  RETURN jsonb_build_object('baseline_rows',v_rows,'mismatches',v_mis,'sanity_checked',v_san,'sanity_fails',v_fail,'alerted',v_alert);
END $fn$;
REVOKE EXECUTE ON FUNCTION public.pay_regression_check() FROM PUBLIC, anon, authenticated;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pay-regression-check') THEN
    PERFORM cron.unschedule('pay-regression-check');
  END IF;
  PERFORM cron.schedule('pay-regression-check', '0 2 * * *', 'SELECT public.pay_regression_check();');  -- 07:30 IST
END $$;

NOTIFY pgrst, 'reload schema';

-- VERIFY: cron present, functions closed to app users; first run result.
SELECT
  (SELECT count(*) FROM cron.job WHERE jobname = 'pay-regression-check') AS cron_job,
  has_function_privilege('authenticated', 'public.pay_regression_check()', 'execute') AS fn_auth_exec,
  public.pay_regression_check() AS first_run;
