-- =====================================================
-- UNTITLED ADFLUX — PHASE 3D: TEAM LEADERBOARD RPC
-- =====================================================
-- RUN THIS ONCE in your Supabase SQL Editor AFTER Phase 3C.
-- Safe to re-run — the function is dropped+recreated on every run.
--
-- WHY THIS EXISTS:
--   Sales reps couldn't see correct leaderboard numbers for
--   other reps because RLS on staff_incentive_profiles and
--   monthly_sales_data limits each user to their own rows.
--   Computing per-rep forecast/earned client-side meant every
--   other rep showed ₹0 in their teammates' views.
--
-- WHAT IT DOES:
--   Returns one row per active sales user with the raw inputs
--   the JS calculateIncentive() needs:
--     • Their incentive profile rates (with settings fallback)
--     • Their monthly_sales_data revenue summed across the
--       requested month_keys
--     • Their open pipeline subtotals (sent/negotiating/draft)
--     • Their won-unsettled subtotals (won + no final approved
--       payment)
--     • Their lifetime won-quote count
--   The JS layer plugs these into calculateIncentive twice
--   (earned + forecast/proposed) so the math stays in one place.
--
-- NOTE ON SCHEMA QUALIFICATION:
--   Every table reference is explicitly prefixed with `public.`.
--   Earlier attempts relied on the function's `SET search_path`
--   attribute, but that only changes the runtime search_path —
--   the parser still uses the SESSION search_path at CREATE
--   time, and Supabase SQL Editor sessions don't always include
--   public. Hard-coding the prefix removes that dependency.
--
-- SECURITY:
--   SECURITY DEFINER bypasses RLS so the aggregates can be read
--   regardless of caller. Only AGGREGATES are returned — no
--   individual quote, payment, or salary rows leak. Profile
--   rates and salary leak indirectly via the proposed-incentive
--   calculation (rep B can infer rep A's rates from the math),
--   which is the same level of transparency the existing
--   settled-revenue leaderboard had.
-- =====================================================

DROP FUNCTION IF EXISTS public.get_team_leaderboard(text[]);

CREATE OR REPLACE FUNCTION public.get_team_leaderboard(p_month_keys text[])
RETURNS TABLE(
  user_id          uuid,
  name             text,
  monthly_salary   numeric,
  sales_multiplier numeric,
  new_client_rate  numeric,
  renewal_rate     numeric,
  flat_bonus       numeric,
  msd_new          numeric,
  msd_renewal      numeric,
  open_new         numeric,
  open_renewal     numeric,
  wu_new           numeric,
  wu_renewal       numeric,
  won_count        bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH s AS (
    SELECT
      default_multiplier,
      new_client_rate    AS s_new_rate,
      renewal_rate       AS s_ren_rate,
      COALESCE(default_flat_bonus, flat_bonus) AS s_flat
    FROM public.incentive_settings
    LIMIT 1
  )
  SELECT
    u.id                                         AS user_id,
    u.name                                       AS name,
    COALESCE(p.monthly_salary, 0)                AS monthly_salary,
    COALESCE(p.sales_multiplier, (SELECT default_multiplier FROM s), 5)        AS sales_multiplier,
    COALESCE(p.new_client_rate,  (SELECT s_new_rate          FROM s), 0.05)    AS new_client_rate,
    COALESCE(p.renewal_rate,     (SELECT s_ren_rate          FROM s), 0.02)    AS renewal_rate,
    COALESCE(p.flat_bonus,       (SELECT s_flat              FROM s), 10000)   AS flat_bonus,
    -- monthly_sales_data summed across the requested period months
    COALESCE((
      SELECT SUM(new_client_revenue)
      FROM public.monthly_sales_data
      WHERE staff_id = u.id
        AND month_year = ANY(p_month_keys)
    ), 0) AS msd_new,
    COALESCE((
      SELECT SUM(renewal_revenue)
      FROM public.monthly_sales_data
      WHERE staff_id = u.id
        AND month_year = ANY(p_month_keys)
    ), 0) AS msd_renewal,
    -- open pipeline = quotes not in lost/won, by revenue_type
    COALESCE((
      SELECT SUM(subtotal) FROM public.quotes
      WHERE created_by = u.id
        AND status NOT IN ('lost','won')
        AND revenue_type = 'new'
    ), 0) AS open_new,
    COALESCE((
      SELECT SUM(subtotal) FROM public.quotes
      WHERE created_by = u.id
        AND status NOT IN ('lost','won')
        AND revenue_type = 'renewal'
    ), 0) AS open_renewal,
    -- won-unsettled = status='won' AND no final approved payment
    COALESCE((
      SELECT SUM(q.subtotal) FROM public.quotes q
      WHERE q.created_by = u.id
        AND q.status = 'won'
        AND q.revenue_type = 'new'
        AND NOT EXISTS (
          SELECT 1 FROM public.payments p2
          WHERE p2.quote_id = q.id
            AND p2.is_final_payment = true
            AND p2.approval_status  = 'approved'
        )
    ), 0) AS wu_new,
    COALESCE((
      SELECT SUM(q.subtotal) FROM public.quotes q
      WHERE q.created_by = u.id
        AND q.status = 'won'
        AND q.revenue_type = 'renewal'
        AND NOT EXISTS (
          SELECT 1 FROM public.payments p2
          WHERE p2.quote_id = q.id
            AND p2.is_final_payment = true
            AND p2.approval_status  = 'approved'
        )
    ), 0) AS wu_renewal,
    -- lifetime won quote count
    COALESCE((
      SELECT COUNT(*) FROM public.quotes
      WHERE created_by = u.id
        AND status = 'won'
    ), 0) AS won_count
  FROM public.users u
  LEFT JOIN public.staff_incentive_profiles p ON p.user_id = u.id
  WHERE u.role = 'sales'
$$;

GRANT EXECUTE ON FUNCTION public.get_team_leaderboard(text[]) TO authenticated;

-- =====================================================
-- DONE. Test in SQL Editor:
--   SELECT * FROM public.get_team_leaderboard(ARRAY['2026-04']);
-- =====================================================
