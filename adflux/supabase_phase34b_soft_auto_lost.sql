-- =====================================================================
-- Phase 34B — Soften auto-Lost on 3 attempts
-- 13 May 2026
--
-- WHAT WAS BROKEN
--
-- Phase 12 §8.2 trigger lead_activity_after_insert() auto-flips a lead
-- to stage='Lost' / lost_reason='NoResponse' the moment
-- contact_attempts_count crosses 3 with no positive outcome. Audit
-- finding (item 10 of the May 13 sales-module review): this kills
-- warm leads that just need a different time-of-day or channel — rep
-- tries 3 times, system gives up on rep's behalf, lead disappears
-- from the queue.
--
-- WHAT THIS MIGRATION DOES
--
-- Replaces the hard auto-flip with a soft signal:
--
--   * The bump-attempts and last-contact-at part stays — that's
--     useful and non-destructive.
--   * After 3 non-positive attempts the trigger now sets a new
--     boolean column `leads.auto_lost_suggested = true` and a
--     timestamptz `leads.auto_lost_suggested_at = now()` — INSTEAD
--     of changing stage.
--   * The /leads UI can show a "System suggests Lost — confirm?"
--     chip on these rows; rep clicks confirm to actually mark Lost,
--     or clicks dismiss to clear the suggestion and keep working.
--
-- After the dismiss, attempts counter keeps incrementing on
-- subsequent activities but the suggestion does not re-fire until
-- the rep explicitly resets via clearing both columns.
--
-- Idempotent — safe to re-run.
-- =====================================================================

-- ─── 1. New suggestion columns on leads ──────────────────────────────
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS auto_lost_suggested      boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_lost_suggested_at   timestamptz;

CREATE INDEX IF NOT EXISTS idx_leads_auto_lost_suggested
  ON public.leads (auto_lost_suggested)
  WHERE auto_lost_suggested = true;


-- ─── 2. Rewrite trigger to signal, not act ───────────────────────────
-- -------------------------------------------------------------------------
-- lead_activity_after_insert REMOVED from this file (Phase 178).
-- Canonical: db/functions/lead_activity_after_insert.sql
-- Do NOT re-add it here. Edit the canonical file only (§71). Trigger wiring
-- (trg_lead_activity_after_insert) stays in phase12 (+ idempotent re-creates).
-- -------------------------------------------------------------------------

-- Trigger row stays bound to this function — CREATE OR REPLACE
-- swaps the body in place. Re-bind for safety on fresh DBs.
DROP TRIGGER IF EXISTS trg_lead_activity_after_insert ON public.lead_activities;
CREATE TRIGGER trg_lead_activity_after_insert
  AFTER INSERT ON public.lead_activities
  FOR EACH ROW
  EXECUTE FUNCTION public.lead_activity_after_insert();


-- ─── 3. RPC: rep dismisses the suggestion ────────────────────────────
-- Clears the boolean + timestamp. Rep can keep working the lead.
CREATE OR REPLACE FUNCTION public.dismiss_auto_lost_suggestion(p_lead_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  UPDATE public.leads
     SET auto_lost_suggested    = false,
         auto_lost_suggested_at = NULL,
         updated_at             = now()
   WHERE id = p_lead_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.dismiss_auto_lost_suggestion(uuid) TO authenticated;


NOTIFY pgrst, 'reload schema';


-- ─── VERIFY ──────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name='leads' AND column_name='auto_lost_suggested') AS suggested_col_exists,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name='leads' AND column_name='auto_lost_suggested_at') AS suggested_at_col_exists,
  (SELECT count(*) FROM pg_proc WHERE proname='dismiss_auto_lost_suggestion') AS dismiss_rpc_exists,
  (SELECT count(*) FROM pg_trigger WHERE tgname='trg_lead_activity_after_insert') AS activity_trigger_exists;
