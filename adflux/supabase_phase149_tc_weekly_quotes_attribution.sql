-- =====================================================================
-- PHASE 149 — TC "Quotes this week" counts a telecaller's OWN quotes
-- 2026-06-13
--
-- Owner: "Dhara shared 2 quotes today but Performance shows 0."
--
-- ROOT CAUSE (tc_weekly_stats, Phase 53): the weekly quotes counter was
--   SELECT COUNT(*) FROM quotes q JOIN leads l ON l.id = q.lead_id
--    WHERE l.telecaller_id = p_user_id ...
-- It attributes a quote to the TC ONLY via the underlying lead's
-- telecaller_id, through an INNER JOIN. Two ways that misses a real TC
-- quote:
--   1. A TC's DIRECT quote gets a Phase-144 auto-lead with
--      assigned_to=TC but telecaller_id=NULL → the filter misses it.
--   2. An orphan quote (no lead_id) is dropped by the INNER JOIN.
-- So Dhara's 2 direct quotes today counted as 0 → gate looked unmet.
--
-- FIX (this file): count a quote when the TC CREATED it (q.created_by)
-- OR owns the underlying lead (l.telecaller_id), via a LEFT JOIN so
-- orphan quotes still count. Only the quotes-count subquery changes;
-- every other counter (qualified, connected, total, connect%) + the
-- week-window math + targets are byte-identical to Phase 53.
--
-- SAFE: this RPC is DISPLAY-ONLY (the TC weekly gate scales the SHOWN
-- variable figure on /my-performance; real pay reads compute_monthly_
-- salary, which is UNGATED — §49/§115). So this corrects the displayed
-- count + gate, with NO change to actual salary. No new table, no
-- trigger, no RLS change. SECURITY DEFINER + search_path preserved.
-- =====================================================================

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
    -- Qualified handoffs this week (unchanged).
    (SELECT COUNT(*)::int FROM public.leads l
      WHERE l.telecaller_id = p_user_id
        AND l.sales_ready_at >= (v_week_start::timestamptz AT TIME ZONE 'Asia/Kolkata')
        AND l.sales_ready_at <  (v_week_end::timestamptz   AT TIME ZONE 'Asia/Kolkata')),
    v_targets_row.qual_t,

    -- Phase 149 — Quotes this week: count a quote the TC CREATED
    -- (q.created_by) OR a quote on a lead the TC owns (l.telecaller_id).
    -- LEFT JOIN so orphan quotes (lead_id NULL) still count via
    -- created_by. Was an INNER JOIN on l.telecaller_id only, which
    -- missed a TC's direct quotes (auto-lead telecaller_id=NULL).
    (SELECT COUNT(*)::int FROM public.quotes q
      LEFT JOIN public.leads l ON l.id = q.lead_id
      WHERE (q.created_by = p_user_id OR l.telecaller_id = p_user_id)
        AND q.created_at >= (v_week_start::timestamptz AT TIME ZONE 'Asia/Kolkata')
        AND q.created_at <  (v_week_end::timestamptz   AT TIME ZONE 'Asia/Kolkata')),
    v_targets_row.quote_t,

    -- Connected calls this week (unchanged).
    (SELECT COUNT(*)::int FROM public.call_logs cl
      WHERE cl.user_id = p_user_id
        AND cl.outcome = 'connected'
        AND cl.call_at >= (v_week_start::timestamptz AT TIME ZONE 'Asia/Kolkata')
        AND cl.call_at <  (v_week_end::timestamptz   AT TIME ZONE 'Asia/Kolkata')),

    -- Total calls this week (unchanged).
    (SELECT COUNT(*)::int FROM public.call_logs cl
      WHERE cl.user_id = p_user_id
        AND cl.call_at >= (v_week_start::timestamptz AT TIME ZONE 'Asia/Kolkata')
        AND cl.call_at <  (v_week_end::timestamptz   AT TIME ZONE 'Asia/Kolkata')),

    -- Connect % (unchanged, NULL-safe).
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


-- ─── VERIFY — Dhara should now show her 2 quotes ─────────────────────
-- Replace the uuid with Dhara's user id (or run for each active TC).
SELECT 'Phase 149 tc_weekly_stats quote-attribution fix applied' AS status;

-- SELECT quotes_count, quotes_target
--   FROM public.tc_weekly_stats(
--     (SELECT id FROM public.users WHERE name ILIKE '%dhara%' AND role='telecaller' LIMIT 1)
--   );
