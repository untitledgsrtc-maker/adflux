-- supabase_phase45_2_lead_first_engagement.sql
-- Phase 45.2 — auto-advance lead stage on first engagement.
-- 18 May 2026
--
-- Owner directive:
--   "when new lead in lead section, in dashboard we find that lead
--    and called them but status still 'new' not 'follow up'"
--
-- Fix: trigger on lead_activities AFTER INSERT. When a 'call',
-- 'meeting', or 'site_visit' activity is logged on a lead that's
-- still stage='New', flip the lead to stage='Working' (the
-- "follow-up" state in the §28 enum). All other stages unchanged.
--
-- Why these activity types:
--   • 'call'       — rep dialed the lead. Engaged.
--   • 'meeting'    — rep met the lead. Engaged.
--   • 'site_visit' — rep went to site. Engaged.
--   • NOT 'note'     — internal log, no contact made.
--   • NOT 'whatsapp' — one-way send, lead may not respond.
--
-- Single source of truth: works for sales / telecaller / agency /
-- admin / sales_manager. No frontend change needed.
--
-- Idempotent. Safe to re-run.


-- ─── 1. Function ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lead_first_engagement_advance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_current_stage text;
BEGIN
  -- Only consider engagement activity types.
  IF NEW.activity_type NOT IN ('call', 'meeting', 'site_visit') THEN
    RETURN NEW;
  END IF;

  -- Read current stage of the parent lead.
  SELECT stage INTO v_current_stage
    FROM public.leads
   WHERE id = NEW.lead_id;

  -- Only flip when stage is exactly 'New'. Working / QuoteSent /
  -- Won / Lost / Nurture all left alone.
  IF v_current_stage = 'New' THEN
    UPDATE public.leads
       SET stage      = 'Working',
           updated_at = now()
     WHERE id = NEW.lead_id;
  END IF;

  RETURN NEW;
END;
$$;


-- ─── 2. Trigger ──────────────────────────────────────────────────
-- AFTER INSERT so the activity row exists when the lead update
-- runs (no FK race). DROP first so re-running this file replaces
-- cleanly.
DROP TRIGGER IF EXISTS trg_lead_first_engagement_advance
  ON public.lead_activities;

CREATE TRIGGER trg_lead_first_engagement_advance
AFTER INSERT ON public.lead_activities
FOR EACH ROW
EXECUTE FUNCTION public.lead_first_engagement_advance();


NOTIFY pgrst, 'reload schema';


-- ─── VERIFY ──────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM pg_proc
    WHERE proname = 'lead_first_engagement_advance'
      AND pronamespace = 'public'::regnamespace)              AS fn_present,
  (SELECT count(*) FROM pg_trigger
    WHERE tgname = 'trg_lead_first_engagement_advance')       AS trigger_present;

-- Expected:
--   fn_present       = 1
--   trigger_present  = 1


-- ─── Smoke test (optional, run manually) ─────────────────────────
-- 1. Find a New lead:
--      SELECT id, name, stage FROM public.leads WHERE stage='New' LIMIT 1;
-- 2. Insert a call activity on it:
--      INSERT INTO public.lead_activities (lead_id, activity_type, notes, created_by)
--      VALUES ('<lead_id>', 'call', 'smoke test', auth.uid());
-- 3. Re-read the lead — stage should be 'Working':
--      SELECT stage FROM public.leads WHERE id = '<lead_id>';
