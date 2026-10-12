-- ============================================================================
-- db/functions/tc_weekly_stats.sql  -  THE CANONICAL HOME (Phase 357, 2026-10-12)
-- ============================================================================
--
-- The TC "This week - TC policy" tiles on /my-performance (TcWeeklyTiles.jsx).
-- DISPLAY-ONLY: nothing in the database calls this function, no pay / score /
-- incentive function reads it (verified 12 Oct 2026). Real pay = compute_monthly_salary.
--
-- WHY THIS FILE EXISTS (section 71/72 - one home per function):
--   tc_weekly_stats was defined in supabase_phase53_tc_weekly_gates.sql and again in
--   supabase_phase149_tc_weekly_quotes_attribution.sql. Both bodies are now pointers.
--   To change the function, EDIT THIS FILE and apply it; never paste it into a new phase file.
--
-- THE BUG THIS FILE FIXES (owner screenshot, 12 Oct 2026, Aayushi on a Monday at 11:18 IST:
--   "Connect rate 0% - No calls yet this week", "Weekly gate is reducing variable salary to 0%"):
--   the week window was built as   (v_week_start::timestamptz AT TIME ZONE 'Asia/Kolkata').
--   The database session runs in UTC, so that expression turned "Monday 00:00" into
--   Monday 05:30 UTC = Monday 11:00 IST. Every Monday the first 11 hours of calls / quotes
--   were left out of "this week" (and counted in the previous week's window). Aayushi had 18
--   calls that morning; the tile counted 9.
--   FIX: (v_week_start::timestamp AT TIME ZONE 'Asia/Kolkata') = "this wall-clock time IN IST",
--   which is 00:00 IST regardless of the session timezone. 14 occurrences, nothing else changed.
--
-- LOCKED CONTRACTS (do not regress): week = ISO Monday..Sunday in IST; quotes counted when the
--   TC CREATED them OR owns the lead (Phase 149, LEFT JOIN); connect % = connected / all calls.
--   Connected-vs-qualified definitions are still the owner's open item (section 68).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tc_weekly_stats(p_user_id uuid, p_week_start date DEFAULT NULL::date)
 RETURNS TABLE(qualified_count integer, qualified_target integer, quotes_count integer, quotes_target integer, connected_count integer, total_calls integer, connect_pct numeric, connect_target_pct integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_week_start date; v_week_end date; v_targets_row record;
BEGIN
  IF p_week_start IS NULL THEN
    v_week_start := (now() AT TIME ZONE 'Asia/Kolkata')::date
                  - ((EXTRACT(ISODOW FROM (now() AT TIME ZONE 'Asia/Kolkata')::date)::int) - 1);
  ELSE v_week_start := p_week_start; END IF;
  v_week_end := v_week_start + 7;

  SELECT COALESCE(t.min_qualified_weekly,5) AS qual_t, COALESCE(t.min_quotes_weekly,2) AS quote_t,
         COALESCE(t.min_connect_pct,30) AS conn_t
  INTO v_targets_row FROM public.daily_targets t WHERE t.user_id = p_user_id
  ORDER BY t.effective_from DESC NULLS LAST LIMIT 1;
  IF v_targets_row IS NULL THEN
    v_targets_row.qual_t:=5; v_targets_row.quote_t:=2; v_targets_row.conn_t:=30; END IF;

  RETURN QUERY SELECT
    (SELECT COUNT(*)::int FROM public.leads l WHERE l.telecaller_id = p_user_id
       AND l.sales_ready_at >= (v_week_start::timestamp AT TIME ZONE 'Asia/Kolkata')
       AND l.sales_ready_at <  (v_week_end::timestamp AT TIME ZONE 'Asia/Kolkata')),
    v_targets_row.qual_t,
    -- Phase 149: TC's own quotes (created_by) OR quotes on the TC's leads.
    (SELECT COUNT(*)::int FROM public.quotes q
       LEFT JOIN public.leads l ON l.id = q.lead_id
      WHERE (q.created_by = p_user_id OR l.telecaller_id = p_user_id)
        AND q.created_at >= (v_week_start::timestamp AT TIME ZONE 'Asia/Kolkata')
        AND q.created_at <  (v_week_end::timestamp AT TIME ZONE 'Asia/Kolkata')),
    v_targets_row.quote_t,
    (SELECT COUNT(*)::int FROM public.call_logs cl WHERE cl.user_id = p_user_id AND cl.outcome='connected'
       AND cl.call_at >= (v_week_start::timestamp AT TIME ZONE 'Asia/Kolkata')
       AND cl.call_at <  (v_week_end::timestamp AT TIME ZONE 'Asia/Kolkata')),
    (SELECT COUNT(*)::int FROM public.call_logs cl WHERE cl.user_id = p_user_id
       AND cl.call_at >= (v_week_start::timestamp AT TIME ZONE 'Asia/Kolkata')
       AND cl.call_at <  (v_week_end::timestamp AT TIME ZONE 'Asia/Kolkata')),
    CASE WHEN (SELECT COUNT(*) FROM public.call_logs cl WHERE cl.user_id = p_user_id
                AND cl.call_at >= (v_week_start::timestamp AT TIME ZONE 'Asia/Kolkata')
                AND cl.call_at <  (v_week_end::timestamp AT TIME ZONE 'Asia/Kolkata'))=0
      THEN 0::numeric
      ELSE ROUND((SELECT COUNT(*) FROM public.call_logs cl WHERE cl.user_id=p_user_id AND cl.outcome='connected'
            AND cl.call_at >= (v_week_start::timestamp AT TIME ZONE 'Asia/Kolkata')
            AND cl.call_at <  (v_week_end::timestamp AT TIME ZONE 'Asia/Kolkata'))::numeric
        / NULLIF((SELECT COUNT(*) FROM public.call_logs cl WHERE cl.user_id=p_user_id
            AND cl.call_at >= (v_week_start::timestamp AT TIME ZONE 'Asia/Kolkata')
            AND cl.call_at <  (v_week_end::timestamp AT TIME ZONE 'Asia/Kolkata'))::numeric,0) * 100, 1)
    END,
    v_targets_row.conn_t;
END $function$;

GRANT EXECUTE ON FUNCTION public.tc_weekly_stats(uuid, date) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY (read-only; all TRUE):
-- SELECT
--   pg_get_functiondef(p.oid) NOT LIKE '%::timestamptz%AT TIME ZONE%'  AS no_utc_window_bug,
--   pg_get_functiondef(p.oid) LIKE '%::timestamp AT TIME ZONE%'        AS ist_window,
--   pg_get_functiondef(p.oid) LIKE '%q.created_by = p_user_id%'        AS has_149_own_quotes
-- FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
-- WHERE n.nspname='public' AND p.proname='tc_weekly_stats';
