-- supabase_phase47_4_auto_heat_from_outcome.sql
-- Phase 47.4 — auto-update lead.heat from call outcome.
-- 18 May 2026
--
-- Owner directive: when rep saves call outcome, lead heat should
-- auto-adjust. Saves a manual click per call.
--
-- Mapping:
--   outcome='positive' (Good)        → heat='hot'
--   outcome='negative' (Lost)        → heat='cold'
--   outcome='neutral' (Maybe)        → no change
--   outcome='callback' (Call later)  → no change
--
-- Why no change on neutral/callback:
--   - Maybe = uncertain, don't over-react.
--   - Callback = customer wants to talk, but heat hasn't risen
--     to 'hot' yet (no expressed buying intent).
--
-- Trigger fires on lead_activities INSERT or UPDATE when the
-- outcome is not null AND has changed. Skipped silently if heat
-- already matches the target value (no redundant writes).
--
-- Skipped on closed leads (stage='Won' / 'Lost') so post-deal
-- activity logs don't reopen the heat scoring.
--
-- Idempotent.


-- ─── 1. Function ─────────────────────────────────────────────────
-- -------------------------------------------------------------------------
-- lead_auto_heat_from_outcome REMOVED from this file (Phase 178). Canonical: db/functions/lead_auto_heat_from_outcome.sql
-- Do NOT re-add (§71). Trigger wiring stays.
-- -------------------------------------------------------------------------


-- ─── 2. Trigger ──────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_lead_auto_heat_from_outcome
  ON public.lead_activities;

CREATE TRIGGER trg_lead_auto_heat_from_outcome
AFTER INSERT OR UPDATE OF outcome ON public.lead_activities
FOR EACH ROW
EXECUTE FUNCTION public.lead_auto_heat_from_outcome();


NOTIFY pgrst, 'reload schema';


-- ─── VERIFY ──────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM pg_proc
    WHERE proname = 'lead_auto_heat_from_outcome'
      AND pronamespace='public'::regnamespace)             AS fn_present,
  (SELECT count(*) FROM pg_trigger
    WHERE tgname = 'trg_lead_auto_heat_from_outcome')      AS trigger_present;

-- Expected:
--   fn_present       = 1
--   trigger_present  = 1


-- ─── Smoke test (optional) ───────────────────────────────────────
-- 1. Find a Working lead with heat='warm':
--      SELECT id, name, stage, heat FROM public.leads
--      WHERE stage='Working' AND heat='warm' LIMIT 1;
-- 2. Insert a positive call activity:
--      INSERT INTO public.lead_activities
--        (lead_id, activity_type, outcome, notes, created_by)
--      VALUES ('<lead_id>', 'call', 'positive', 'smoke 47.4', auth.uid());
-- 3. Re-read lead — heat should now be 'hot':
--      SELECT heat FROM public.leads WHERE id = '<lead_id>';
