-- ============================================================================
-- db/functions/qr_board_stats.sql — CANONICAL HOME (Phase 274, 2026-07-28)
-- ============================================================================
--
-- ⭐ The ONE place qr_board_stats lives. EDIT THIS FILE to change it (§71).
--
-- WHY: the QR & Locations page (CampaignQrV2) computed per-board Scans /
--   Messaged / Leads / Quotes by loading the raw rows client-side and counting
--   them. PostgREST caps an unpaginated .select() at ~1000 rows, so once
--   qr_scans crossed 1000 the "Total scans" counter FROZE at exactly 1000 and
--   per-board scans under-counted (§66/§85/§151 — the recurring 1000-row-cap
--   disease). This does the counts SERVER-side with GROUP BY → accurate at any
--   volume, and never loads the rows at all (fast).
--
-- SECURITY INVOKER on purpose (§153): it runs with the CALLER's RLS, so it
--   exposes nothing the caller couldn't already read via the client queries it
--   replaces. The QR page is admin/co_owner-only; admin RLS covers all four
--   tables → correct full counts. No privilege elevation.
--
-- RETURNS one row per requested board id (LEFT JOIN over unnest, so a board
--   with zero of anything still returns 0s, matching the old client behaviour).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.qr_board_stats(p_board_ids uuid[])
RETURNS TABLE(location_id uuid, scans bigint, messaged bigint, leads bigint, quotes bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH s AS (
    SELECT qs.location_id AS lid, count(*) AS c
      FROM public.qr_scans qs
     WHERE qs.location_id = ANY(p_board_ids)
     GROUP BY qs.location_id),
  m AS (
    SELECT wc.location_id AS lid, count(*) AS c
      FROM public.whatsapp_conversations wc
     WHERE wc.location_id = ANY(p_board_ids)
     GROUP BY wc.location_id),
  l AS (
    SELECT ld.location_id AS lid, count(*) AS c
      FROM public.leads ld
     WHERE ld.location_id = ANY(p_board_ids)
     GROUP BY ld.location_id),
  q AS (
    SELECT ld.location_id AS lid, count(*) AS c
      FROM public.quotes qq
      JOIN public.leads ld ON ld.id = qq.lead_id
     WHERE ld.location_id = ANY(p_board_ids)
     GROUP BY ld.location_id)
  SELECT b AS location_id,
         COALESCE(s.c, 0) AS scans,
         COALESCE(m.c, 0) AS messaged,
         COALESCE(l.c, 0) AS leads,
         COALESCE(q.c, 0) AS quotes
    FROM unnest(p_board_ids) AS b
    LEFT JOIN s ON s.lid = b
    LEFT JOIN m ON m.lid = b
    LEFT JOIN l ON l.lid = b
    LEFT JOIN q ON q.lid = b;
$function$;

GRANT EXECUTE ON FUNCTION public.qr_board_stats(uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY (read-only) ──────────────────────────────────────────────────────
-- SELECT sum(scans) AS total_scans, sum(messaged) AS total_messaged,
--        sum(leads) AS total_leads, sum(quotes) AS total_quotes
--   FROM public.qr_board_stats(
--     ARRAY(SELECT id FROM public.campaign_locations WHERE client_name IS NULL));
-- total_scans should now exceed 1000 (the true count), not freeze at 1000.
