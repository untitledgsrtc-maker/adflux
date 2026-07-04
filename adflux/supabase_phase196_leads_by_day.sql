-- ============================================================================
-- Phase 196 — leads_collected_by_day(): server-side per-day lead counts
-- ============================================================================
-- The /leads "Leads Collected" chart pulled raw lead rows and bucketed them in
-- the browser. Its .limit(20000) is ignored — PostgREST caps the response at the
-- project's ~1000-row max — so a 30-day window with >1000 leads returned only
-- ~1000 rows (oldest-first), starving the recent days: 3 Jul had 200 leads but
-- the chart showed 7; today had 8 and showed 0. (§66 1000-row-cap; Phase 151/152
-- fixed the leads list + quotes but this chart had its own uncapped query.)
--
-- Fix: count on the SERVER. This returns one row per IST day with the count —
-- no row cap, fast, and SECURITY INVOKER so RLS still scopes it per role (admin
-- sees all, a rep sees their own). Same IST-day bucketing + segment/source
-- filters the chart used. Additive; nothing else reads it. §45-safe.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.leads_collected_by_day(
  p_from    date,
  p_to      date,
  p_segment text DEFAULT 'all',
  p_source  text DEFAULT 'all'
)
 RETURNS TABLE(ist_day date, cnt bigint)
 LANGUAGE sql
 STABLE SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
  SELECT (l.created_at AT TIME ZONE 'Asia/Kolkata')::date AS ist_day,
         count(*)::bigint AS cnt
  FROM public.leads l
  WHERE l.created_at >= ((p_from)::timestamp        AT TIME ZONE 'Asia/Kolkata')
    AND l.created_at <  ((p_to + 1)::timestamp      AT TIME ZONE 'Asia/Kolkata')
    AND (
      p_segment = 'all'
      OR (p_segment = 'private' AND (l.segment = 'PRIVATE' OR l.segment IS NULL))
      OR (p_segment NOT IN ('all', 'private') AND l.segment = upper(p_segment))
    )
    AND (p_source = 'all' OR l.source = p_source)
  GROUP BY 1
$function$;

GRANT EXECUTE ON FUNCTION public.leads_collected_by_day(date, date, text, text)
  TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY (as admin — should match a raw GROUP BY over the same window):
-- SELECT * FROM public.leads_collected_by_day(
--   (CURRENT_DATE - 29), CURRENT_DATE, 'all', 'all') ORDER BY ist_day DESC;
