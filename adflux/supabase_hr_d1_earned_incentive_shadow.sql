-- HR D1 (§290) · earned-incentive helper + SHADOW-COMPARE (read-only preview).
--
-- WHY: net_payable's `incentive` term currently = SUM(incentive_payouts.amount_paid)
-- (incentive ALREADY PAID), not earned. To consolidate to ONE Salary payout we must
-- flip that term to EARNED. This file is STEP 1 — 100% SAFE + INERT:
--   • creates an additive helper `earned_incentive_for()` that NOTHING calls yet, and
--   • runs a read-only preview of how each rep's net would move.
-- It changes NO pay. The engine flip (_compute_monthly_salary_base.sql: v_incentive :=
-- earned_incentive_for(...)) ships ONLY after you eyeball these numbers (§71 rule 3).
--
-- The helper mirrors src/utils/incentiveCalc.js calculateIncentive() EXACTLY:
--   target=salary*mult(5) · threshold=salary*2 · total=new+renewal revenue
--   below threshold → 0 ; else new*ncr(0.05) + ren*rr(0.02) + (total>target ? flatBonus(10000):0)
-- Sources match the app call sites (per-profile override → incentive_settings → default).

CREATE OR REPLACE FUNCTION public.earned_incentive_for(p_user_id uuid, p_month_year text)
RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  s          record;
  sip        record;
  v_new      numeric := 0;
  v_ren      numeric := 0;
  v_mult     numeric;
  v_ncr      numeric;
  v_rr       numeric;
  v_fb       numeric;
  v_salary   numeric;
  v_total    numeric;
  v_target   numeric;
  v_threshold numeric;
BEGIN
  SELECT * INTO sip FROM public.staff_incentive_profiles WHERE user_id = p_user_id;
  IF sip.user_id IS NULL THEN RETURN 0; END IF;          -- no profile → no incentive
  SELECT * INTO s FROM public.incentive_settings LIMIT 1;

  SELECT COALESCE(new_client_revenue, 0), COALESCE(renewal_revenue, 0)
    INTO v_new, v_ren
    FROM public.monthly_sales_data
   WHERE staff_id = p_user_id AND month_year = p_month_year;
  v_new := COALESCE(v_new, 0);
  v_ren := COALESCE(v_ren, 0);

  v_salary := COALESCE(sip.monthly_salary, 0);
  v_mult   := COALESCE(NULLIF(sip.sales_multiplier, 0), s.default_multiplier, 5);  -- JS `||`
  v_ncr    := COALESCE(sip.new_client_rate, s.new_client_rate, 0.05);              -- JS `??`
  v_rr     := COALESCE(sip.renewal_rate,    s.renewal_rate,    0.02);              -- JS `??`
  v_fb     := COALESCE(sip.flat_bonus,      s.default_flat_bonus, 10000);          -- JS `??`

  v_total     := v_new + v_ren;
  v_threshold := v_salary * 2;
  v_target    := v_salary * v_mult;

  IF v_total < v_threshold THEN
    RETURN 0;                                            -- slab not reached
  END IF;

  -- unrounded, exactly like calculateIncentive; net_payable's outer round() handles it
  RETURN v_new * v_ncr + v_ren * v_rr
       + CASE WHEN v_total > v_target THEN v_fb ELSE 0 END;
END $$;

-- Internal helper only — the (already-gated) salary RPC calls it as owner; no rep may
-- call it directly (would expose another rep's earned figure).
REVOKE ALL ON FUNCTION public.earned_incentive_for(uuid, text) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- SHADOW-COMPARE (read-only — RUN THIS, eyeball the numbers; it changes nothing).
-- Per active sales/telecaller rep, for the CURRENT IST month:
--   incentive_now_paid  = what net_payable uses TODAY (SUM incentive_payouts)
--   incentive_earned    = what it WOULD use after the flip
--   net_delta           = how much each rep's net_payable moves (earned − paid)
-- To preview a DIFFERENT month, replace the my value with e.g. '2026-08'.
-- ============================================================================
WITH p AS (SELECT to_char((now() AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM') AS my)
SELECT
  u.name,
  u.role,
  sip.monthly_salary                                  AS salary,
  COALESCE(md.new_client_revenue, 0)                  AS new_rev,
  COALESCE(md.renewal_revenue, 0)                     AS ren_rev,
  pay.paid                                            AS incentive_now_paid,
  round(e.earned)                                     AS incentive_earned,
  round(e.earned) - pay.paid                          AS net_delta
FROM public.users u
JOIN public.staff_incentive_profiles sip ON sip.user_id = u.id
CROSS JOIN p
LEFT JOIN public.monthly_sales_data md ON md.staff_id = u.id AND md.month_year = p.my
LEFT JOIN LATERAL (SELECT public.earned_incentive_for(u.id, p.my) AS earned) e ON true
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(amount_paid), 0) AS paid
    FROM public.incentive_payouts ip
   WHERE ip.staff_id = u.id AND ip.month_year = p.my
) pay ON true
WHERE u.role IN ('sales', 'telecaller') AND u.is_active
ORDER BY net_delta DESC;
