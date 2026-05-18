-- supabase_phase53_tc_weekly_gates.sql
-- Phase 53 — TC weekly score gates + observability.
-- 18 May 2026
--
-- Owner triage of TC perf-page audit:
--   Q3 yes → fold qualified-weekly into score math
--   Q4 yes → surface min_quotes for TC + score gate
--   Q2 no  → connect rate is observability only (no score math)
--   Q1 ok  → compensation 70/30 slab unchanged
--
-- This file:
--   1. Adds `daily_targets.min_quotes_weekly` (NEW) with default 2.
--      (Phase 49 already shipped `min_calls`, `min_connect_pct`,
--      `min_qualified_weekly`.)
--   2. Backfills the row for any TC missing a daily_targets row.
--   3. New helper RPC `tc_weekly_stats(p_user_id, p_week_start)`
--      returns the 3 TC weekly counters (qualified, quotes_sent,
--      connected_calls) + their targets. UI reads it once per page
--      to surface the tile strip + the variable-unlock gate.
--   4. Backfills `staff_incentive_profiles` for existing TCs that
--      were created before Phase 50.2 (Dhara + Rima visible without
--      a profile row on /my-performance).
--
-- Variable-unlock gate is computed UI-side initially (cheaper +
-- reversible). When owner is satisfied with the gate's behaviour
-- a follow-up SQL can move the gate into the salary RPC.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, ON CONFLICT DO NOTHING.


-- ─── 1. min_quotes_weekly column ─────────────────────────────────
ALTER TABLE public.daily_targets
  ADD COLUMN IF NOT EXISTS min_quotes_weekly int NOT NULL DEFAULT 2;

ALTER TABLE public.daily_targets
  DROP CONSTRAINT IF EXISTS daily_targets_quotes_weekly_check;
ALTER TABLE public.daily_targets
  ADD CONSTRAINT daily_targets_quotes_weekly_check
  CHECK (min_quotes_weekly >= 0);


-- ─── 2. Backfill staff_incentive_profiles for legacy TCs ─────────
-- HR wizard (Phase 50.2) creates the row for new TCs. Dhara + Rima
-- predate that — their /my-performance shows
-- "No incentive plan configured" + Variable ₹0/₹6,000 chip.
-- Pull defaults from the Telecaller designation row.
INSERT INTO public.staff_incentive_profiles (
  user_id, monthly_salary, is_active
)
SELECT
  u.id,
  COALESCE(d.default_monthly_salary, 20000),
  true
FROM public.users u
LEFT JOIN public.designations d ON d.name = 'Telecaller'
WHERE u.role = 'telecaller'
  AND u.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM public.staff_incentive_profiles p
    WHERE p.user_id = u.id
  );


-- ─── 3. Backfill daily_targets row for legacy TCs ────────────────
-- Same problem: new TCs from the wizard get a row; legacy TCs may
-- be missing one, which leaves the score RPC's default of 50 calls
-- working but min_qualified_weekly / min_quotes_weekly columns
-- carry no per-rep override.
INSERT INTO public.daily_targets (
  user_id, min_calls, min_quotes, min_followups,
  min_connect_pct, min_qualified_weekly, min_quotes_weekly,
  effective_from
)
SELECT
  u.id, 50, 0, 0,
  30, 5, 2,
  (date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata'))::date
FROM public.users u
WHERE u.role = 'telecaller'
  AND u.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM public.daily_targets t WHERE t.user_id = u.id
  );


-- ─── 4. Helper RPC: tc_weekly_stats ──────────────────────────────
-- Returns one row with the rep's 3 weekly counters + their targets.
-- Week starts Monday IST (matches TelecallerV2's weekStartISO calc).
-- All counts honour IST date boundary (matches compute_daily_score).
CREATE OR REPLACE FUNCTION public.tc_weekly_stats(
  p_user_id     uuid,
  p_week_start  date DEFAULT NULL
)
RETURNS TABLE (
  qualified_count      int,
  qualified_target     int,
  quotes_count         int,
  quotes_target        int,
  connected_count      int,
  total_calls          int,
  connect_pct          numeric,
  connect_target_pct   int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_week_start  date;
  v_week_end    date;
  v_targets_row record;
BEGIN
  -- Default: this calendar week (Monday → today) in IST.
  IF p_week_start IS NULL THEN
    v_week_start := (now() AT TIME ZONE 'Asia/Kolkata')::date
                  - ((EXTRACT(ISODOW FROM (now() AT TIME ZONE 'Asia/Kolkata')::date)::int) - 1);
  ELSE
    v_week_start := p_week_start;
  END IF;
  v_week_end := v_week_start + 7;

  -- Pull this rep's daily_targets row. Fall back to TC defaults.
  SELECT
    COALESCE(t.min_qualified_weekly, 5)  AS qual_t,
    COALESCE(t.min_quotes_weekly,    2)  AS quote_t,
    COALESCE(t.min_connect_pct,      30) AS conn_t
  INTO v_targets_row
  FROM public.daily_targets t
  WHERE t.user_id = p_user_id
  ORDER BY t.effective_from DESC NULLS LAST
  LIMIT 1;

  -- Defensive defaults if no row.
  IF v_targets_row IS NULL THEN
    v_targets_row.qual_t  := 5;
    v_targets_row.quote_t := 2;
    v_targets_row.conn_t  := 30;
  END IF;

  RETURN QUERY
  SELECT
    -- Qualified handoffs this week: leads this TC moved to
    -- sales_ready_at within the week window.
    (SELECT COUNT(*)::int FROM public.leads l
      WHERE l.telecaller_id = p_user_id
        AND l.sales_ready_at >= (v_week_start::timestamptz AT TIME ZONE 'Asia/Kolkata')
        AND l.sales_ready_at <  (v_week_end::timestamptz   AT TIME ZONE 'Asia/Kolkata')),
    v_targets_row.qual_t,

    -- Quotes sent this week. Phase 14 wired quotes.lead_id; the
    -- TC's leads → quotes are attributable via that FK. We count
    -- distinct quotes whose underlying lead carries this TC.
    (SELECT COUNT(*)::int FROM public.quotes q
      JOIN public.leads l ON l.id = q.lead_id
      WHERE l.telecaller_id = p_user_id
        AND q.created_at >= (v_week_start::timestamptz AT TIME ZONE 'Asia/Kolkata')
        AND q.created_at <  (v_week_end::timestamptz   AT TIME ZONE 'Asia/Kolkata')),
    v_targets_row.quote_t,

    -- Connected calls this week (call_logs.outcome='connected').
    (SELECT COUNT(*)::int FROM public.call_logs cl
      WHERE cl.user_id = p_user_id
        AND cl.outcome = 'connected'
        AND cl.call_at >= (v_week_start::timestamptz AT TIME ZONE 'Asia/Kolkata')
        AND cl.call_at <  (v_week_end::timestamptz   AT TIME ZONE 'Asia/Kolkata')),

    -- Total calls this week (any outcome) — for the connect-rate %.
    (SELECT COUNT(*)::int FROM public.call_logs cl
      WHERE cl.user_id = p_user_id
        AND cl.call_at >= (v_week_start::timestamptz AT TIME ZONE 'Asia/Kolkata')
        AND cl.call_at <  (v_week_end::timestamptz   AT TIME ZONE 'Asia/Kolkata')),

    -- Connect % (NULL-safe).
    CASE
      WHEN (SELECT COUNT(*) FROM public.call_logs cl
              WHERE cl.user_id = p_user_id
                AND cl.call_at >= (v_week_start::timestamptz AT TIME ZONE 'Asia/Kolkata')
                AND cl.call_at <  (v_week_end::timestamptz   AT TIME ZONE 'Asia/Kolkata')) = 0
      THEN 0::numeric
      ELSE ROUND(
        (SELECT COUNT(*) FROM public.call_logs cl
          WHERE cl.user_id = p_user_id AND cl.outcome = 'connected'
            AND cl.call_at >= (v_week_start::timestamptz AT TIME ZONE 'Asia/Kolkata')
            AND cl.call_at <  (v_week_end::timestamptz   AT TIME ZONE 'Asia/Kolkata'))::numeric
        / NULLIF((SELECT COUNT(*) FROM public.call_logs cl
          WHERE cl.user_id = p_user_id
            AND cl.call_at >= (v_week_start::timestamptz AT TIME ZONE 'Asia/Kolkata')
            AND cl.call_at <  (v_week_end::timestamptz   AT TIME ZONE 'Asia/Kolkata'))::numeric, 0)
        * 100, 1)
    END,
    v_targets_row.conn_t;
END $$;

GRANT EXECUTE ON FUNCTION public.tc_weekly_stats(uuid, date) TO authenticated;


NOTIFY pgrst, 'reload schema';


-- ─── VERIFY ──────────────────────────────────────────────────────
-- Expected:
--   col_added             = 1
--   tc_profiles_present   ≥ 1   (Dhara + Rima + Renuka backfilled)
--   tc_targets_present    ≥ 1   (daily_targets rows for active TCs)
--   rpc_present           = 1
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='daily_targets'
      AND column_name='min_quotes_weekly')                                AS col_added,
  (SELECT count(*) FROM public.staff_incentive_profiles p
    JOIN public.users u ON u.id = p.user_id
    WHERE u.role = 'telecaller' AND u.is_active = true)                   AS tc_profiles_present,
  (SELECT count(*) FROM public.daily_targets t
    JOIN public.users u ON u.id = t.user_id
    WHERE u.role = 'telecaller' AND u.is_active = true)                   AS tc_targets_present,
  (SELECT count(*) FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'tc_weekly_stats')         AS rpc_present;
