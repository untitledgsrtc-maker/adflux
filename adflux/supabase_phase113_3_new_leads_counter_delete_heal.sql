-- supabase_phase113_3_new_leads_counter_delete_heal.sql
-- Phase 113.3 (2026-06-05) — new_leads counter drift fix (counter > real
-- leads). EXACT mirror of Phase 103.E.1 (the meeting-counter delete-heal),
-- applied to the new_leads counter that Phase 103.E.1 explicitly FLAGGED
-- as the next time-bomb (its line 41: "calls / new_leads counters — same
-- latent delete-drift exists but is out of scope... Flagged.").
--
-- BUG (5 Jun, kirti): admin team card showed LEADS 6, but after the
-- duplicate-lead cleanup she has fewer real leads today. daily_counters
-- .new_leads is HIGHER than reality.
--
-- ROOT CAUSE (identical to the meeting counter before 103.E.1):
--   trg_lead_after_insert_bump_counter (phase12) is an AFTER INSERT
--   trigger: every lead insert does new_leads + 1. There is NO decrement
--   on DELETE. So:
--       create lead  -> new_leads + 1
--       delete lead  -> new_leads UNCHANGED   <-- orphan +1 left behind
--   The Phase 113.2 ghost-click bug created 5 dup leads (new_leads +5);
--   deleting 4 of them left +4 stuck. The counter drifts above the true
--   count. (The SCORE is unaffected — compute_daily_score counts leads/
--   activities LIVE, not from this stored counter. This is a DISPLAY
--   counter only: the admin team card + the /work hero "Leads today".)
--
-- WHAT THIS DOES (3 parts, all idempotent — same shape as 103.E.1):
--   1. recompute_daily_new_leads(user, date) — SETs new_leads to the TRUE
--      count of that rep's leads created on that IST date. It can only
--      make the counter MATCH reality; it cannot inflate.
--   2. AFTER DELETE trigger on leads — recomputes the creator's new_leads
--      whenever a lead is deleted, so the counter self-heals forever.
--   3. One-time heal of the last 7 days' sessions — fixes kirti's current
--      drift + any other rep/day affected by today's cleanup.
--
-- WHAT THIS DOES NOT TOUCH:
--   - The INSERT bump (lead_after_insert_bump_counter) — correct on insert
--     once the Phase 113.2 latch stops ghost-click dups. Left byte-as-is.
--   - The score path (compute_daily_score) — separate, live-count, already
--     correct. No score change here.
--   - The meetings delete-heal (103.E.1) — untouched; this is its sibling.
--   - The calls counter — the SAME latent drift still exists there (also
--     flagged by 103.E.1). Left for a follow-up once its qualified-vs-all
--     count semantics are confirmed, to avoid a wrong recompute. Flagged.
--
-- §45 — additive only. No existing flow, RLS, or hot-path query changed.
-- The new trigger fires only on a leads DELETE (a rare admin/cleanup
-- action), never on the rep insert/save hot path.

-- ── 1. Recompute helper (cannot inflate — counts real rows) ──────────
-- Phase 330: the body of recompute_daily_new_leads(uuid,date) MOVED to the canonical file
--   db/functions/recompute_daily_new_leads.sql  (CLAUDE.md §72 - one home per function).
--   It now ignores self-imports (lead_is_self_import). Do NOT re-create it here: re-running this
--   old file must never revert that. The function must already exist when this file runs
--   (it does on the live DB); the trigger function + trigger + heal below still call it.

-- ── 2. Self-heal on DELETE ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lead_new_leads_recount_on_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  PERFORM public.recompute_daily_new_leads(OLD.created_by, OLD.created_at::date);
  RETURN OLD;
END
$function$;

DROP TRIGGER IF EXISTS trg_lead_new_leads_recount_del ON public.leads;
CREATE TRIGGER trg_lead_new_leads_recount_del
  AFTER DELETE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.lead_new_leads_recount_on_delete();

-- ── 3. One-time heal: last 7 days of sessions ────────────────────────
DO $heal$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT user_id, work_date
      FROM public.work_sessions
     WHERE work_date >= CURRENT_DATE - 6
  LOOP
    PERFORM public.recompute_daily_new_leads(r.user_id, r.work_date);
  END LOOP;
END
$heal$;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- VERIFY
-- =====================================================================
-- V1: kirti's counter now equals her real leads-today (was 6).
SELECT
  (ws.daily_counters->>'new_leads')                                  AS counter_now,
  (SELECT count(*) FROM public.leads l
     WHERE l.created_by = ws.user_id
       AND l.created_at::date = ws.work_date)                        AS real_leads
FROM public.work_sessions ws
JOIN public.users u ON u.id = ws.user_id
WHERE u.name ILIKE 'kirti%'
  AND ws.work_date = CURRENT_DATE;
-- Expected: counter_now = real_leads.

-- V2: the delete-heal trigger exists.
SELECT tgname FROM pg_trigger
 WHERE tgrelid = 'public.leads'::regclass
   AND tgname  = 'trg_lead_new_leads_recount_del';
-- Expected: one row.

-- V3 (manual smoke): create a lead (new_leads +1), delete it
-- (new_leads returns to prior value — no orphan +1).
