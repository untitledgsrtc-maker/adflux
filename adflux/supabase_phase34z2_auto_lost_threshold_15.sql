-- =====================================================================
-- Phase 34Z.2 — bump auto-Lost suggestion threshold 3 → 15 attempts
-- 13 May 2026
--
-- WHY
--
-- Phase 34B replaced the hard auto-Lost flip with a soft suggestion
-- that fires when `contact_attempts_count >= 3`. Owner audit (13 May
-- 2026): "I want more than 15 attempts then ask for lost." Three is
-- too aggressive — real B2B deals routinely take 6-10 touches before
-- the buyer comes around, and the suggestion was firing on warm
-- leads that were still progressing. Raising to 15 keeps the safety
-- net for genuinely dormant rows without harassing the rep mid-cycle.
--
-- WHAT THIS DOES
--
-- Re-creates `lead_activity_after_insert()` with the same logic as
-- Phase 34B, only the threshold constant changes from 3 → 15.
-- Pre-existing `auto_lost_suggested = true` rows are NOT cleared —
-- if a lead has already had 3 dismissed-as-noise attempts and the
-- suggestion was set, owner can either dismiss it (Phase 34B RPC)
-- or wait for the next activity to leave it alone (won't re-fire
-- because v_suggested IS NOT TRUE check stays).
--
-- Idempotent — re-running is a no-op (CREATE OR REPLACE).
-- =====================================================================

-- -------------------------------------------------------------------------
-- lead_activity_after_insert REMOVED from this file (Phase 178).
-- Canonical: db/functions/lead_activity_after_insert.sql
-- Do NOT re-add it here. Edit the canonical file only (§71). Trigger wiring
-- (trg_lead_activity_after_insert) stays in phase12 (+ idempotent re-creates).
-- -------------------------------------------------------------------------

-- Re-bind for safety on fresh DBs.
DROP TRIGGER IF EXISTS trg_lead_activity_after_insert ON public.lead_activities;
CREATE TRIGGER trg_lead_activity_after_insert
  AFTER INSERT ON public.lead_activities
  FOR EACH ROW
  EXECUTE FUNCTION public.lead_activity_after_insert();


NOTIFY pgrst, 'reload schema';


-- ─── VERIFY ──────────────────────────────────────────────────────────
-- Confirm trigger function body now contains '>= 15' (not '>= 3').
SELECT
  (regexp_count(pg_get_functiondef(p.oid), '>= 15')) AS has_15_threshold,
  (regexp_count(pg_get_functiondef(p.oid), '>= 3'))  AS legacy_3_threshold_count
  FROM pg_proc p
 WHERE p.proname = 'lead_activity_after_insert';
