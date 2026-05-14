-- =====================================================================
-- Phase 34Z.17 — clear stale auto_lost_suggested rows after threshold bump
-- 14 May 2026
--
-- WHY
--
-- Phase 34Z.2 bumped the soft auto-Lost threshold from 3 → 15 attempts.
-- But the SQL only changed the TRIGGER body; pre-existing leads whose
-- `auto_lost_suggested = true` was set when the threshold was still 3
-- continued to surface the banner on the lead-detail page. Owner
-- reported (14 May 2026): "3+ attempts to 15 attempts we bumped it
-- before, still why is it coming?"
--
-- Root cause: the flag is sticky. Once set, only an explicit dismiss
-- or moving to Won/Lost/Nurture clears it. The threshold change
-- doesn't retroactively re-evaluate.
--
-- WHAT THIS DOES
--
-- 1. Clears auto_lost_suggested on every lead whose contact_attempts_
--    count is still below the new threshold (15). Those rows shouldn't
--    have been flagged under the new rules.
-- 2. Re-runs the Phase 34Z.2 function definition just to be safe — if
--    Phase 34Z.2 was never applied in production this fixes it too.
-- 3. The JSX banner (LeadDetailV2.jsx) was hard-coded to render any
--    row whose flag was set; Phase 34Z.17 adds a >=15 guard on the
--    JSX side as belt + braces, so even if a stale flag survives a
--    backfill, the banner won't fire on warm leads.
--
-- Idempotent. Re-runnable.
-- =====================================================================

-- 1. Clear stale flags.
UPDATE public.leads
   SET auto_lost_suggested    = false,
       auto_lost_suggested_at = NULL,
       updated_at             = now()
 WHERE auto_lost_suggested = true
   AND COALESCE(contact_attempts_count, 0) < 15;

-- 2. Ensure trigger is on the new threshold (re-creates from Phase 34Z.2).
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

    -- Threshold = 15 (Phase 34Z.2 / 34Z.17).
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

DROP TRIGGER IF EXISTS trg_lead_activity_after_insert ON public.lead_activities;
CREATE TRIGGER trg_lead_activity_after_insert
  AFTER INSERT ON public.lead_activities
  FOR EACH ROW
  EXECUTE FUNCTION public.lead_activity_after_insert();

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ──────────────────────────────────────────────────────────
-- After the run:
--   • flag_remaining_below_threshold should be 0
--   • has_15_threshold should be 1
--   • legacy_3_threshold should be 0
SELECT
  (SELECT count(*) FROM public.leads
    WHERE auto_lost_suggested = true
      AND COALESCE(contact_attempts_count, 0) < 15) AS flag_remaining_below_threshold,
  (SELECT regexp_count(pg_get_functiondef(p.oid), '>= 15')
     FROM pg_proc p WHERE p.proname='lead_activity_after_insert') AS has_15_threshold,
  (SELECT regexp_count(pg_get_functiondef(p.oid), '>= 3 ')
     FROM pg_proc p WHERE p.proname='lead_activity_after_insert') AS legacy_3_threshold;
