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

-- tc_weekly_stats function body REMOVED (section 71/72, Phase 357, 2026-10-12).
-- The ONE canonical home is db/functions/tc_weekly_stats.sql. Re-running the old body here
-- would bring back the UTC week-window bug (Monday 00:00 became Monday 11:00 IST).


GRANT EXECUTE ON FUNCTION public.tc_weekly_stats(uuid, date) TO authenticated;

NOTIFY pgrst, 'reload schema';


-- ─── VERIFY — Dhara should now show her 2 quotes ─────────────────────
-- Replace the uuid with Dhara's user id (or run for each active TC).
SELECT 'Phase 149 tc_weekly_stats quote-attribution fix applied' AS status;

-- SELECT quotes_count, quotes_target
--   FROM public.tc_weekly_stats(
--     (SELECT id FROM public.users WHERE name ILIKE '%dhara%' AND role='telecaller' LIMIT 1)
--   );
