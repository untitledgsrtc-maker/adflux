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

CREATE OR REPLACE FUNCTION public.lead_activity_after_insert()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_attempts int;
  v_suggested boolean;
BEGIN
  IF NEW.activity_type IN ('call','whatsapp','email','meeting','site_visit') THEN
    UPDATE public.leads
       SET contact_attempts_count = contact_attempts_count + 1,
           last_contact_at        = COALESCE(NEW.created_at, now()),
           updated_at             = now()
     WHERE id = NEW.lead_id
     RETURNING contact_attempts_count, auto_lost_suggested
       INTO v_attempts, v_suggested;

    -- Phase 34Z.2 — threshold bumped 3 → 15. Owner: real B2B deals
    -- need 6-10 touches before they convert; 3 was firing on still-
    -- warm leads. 15 keeps the dormant-lead safety net.
    IF v_attempts >= 15
       AND (NEW.outcome IS NULL OR NEW.outcome IN ('neutral','negative'))
       AND v_suggested IS NOT TRUE THEN
      UPDATE public.leads
         SET auto_lost_suggested    = true,
             auto_lost_suggested_at = now(),
             updated_at             = now()
       WHERE id = NEW.lead_id
         AND stage NOT IN ('Won','Lost','Nurture');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

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
