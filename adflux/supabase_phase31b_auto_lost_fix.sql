-- supabase_phase31b_auto_lost_fix.sql
--
-- Phase 31B — fix the auto-Lost regression introduced by Phase 30C
-- rev2's tap-to-log Call / WhatsApp / Email buttons.
--
-- Owner reported (9 May 2026): "when I changed status it's going
-- Lost". Lead ended up Lost without explicit user action.
--
-- Root cause: the Phase 12 trigger lead_activity_after_insert()
-- auto-Lost any lead after 3 contact attempts whose outcome is
-- 'null' or in ('neutral','negative'). Phase 30C rev2 added fast-path
-- buttons that fire-and-forget activity inserts with outcome=null
-- (rep clicked the action; we have no info on how the conversation
-- went). Three clicks → lead Lost. Bad.
--
-- Fix: only count explicit NEGATIVE outcomes toward the auto-Lost
-- threshold AND raise the bar from 3 to 5. Null / neutral outcomes
-- no longer drag the lead toward Lost — they only bump the
-- contact_attempts_count for tracking.
--
-- Side effect kept: contact_attempts_count and last_contact_at still
-- update on every call/whatsapp/email/meeting/site_visit insert
-- (rep stats remain accurate; only the Lost auto-flip changes).
--
-- Idempotent — replaces the existing function in place.

CREATE OR REPLACE FUNCTION public.lead_activity_after_insert()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_attempts        int;
  v_negative_count  int;
BEGIN
  IF NEW.activity_type IN ('call','whatsapp','email','meeting','site_visit') THEN
    UPDATE public.leads
       SET contact_attempts_count = contact_attempts_count + 1,
           last_contact_at        = COALESCE(NEW.created_at, now()),
           updated_at             = now()
     WHERE id = NEW.lead_id
     RETURNING contact_attempts_count INTO v_attempts;

    -- Phase 31B — only count EXPLICIT negative outcomes. Auto-log
    -- clicks (Phase 30C rev2) have outcome=null because the rep
    -- hasn't classified the conversation yet — those should NOT push
    -- the lead toward Lost. Threshold also raised 3 → 5 so even
    -- repeated genuine "no answer" attempts give the rep more runway
    -- before the system forces closure.
    SELECT COUNT(*) INTO v_negative_count
      FROM public.lead_activities
     WHERE lead_id = NEW.lead_id
       AND outcome = 'negative';

    IF v_negative_count >= 5 THEN
      UPDATE public.leads
         SET stage       = 'Lost',
             lost_reason = COALESCE(lost_reason, 'NoResponse'),
             updated_at  = now()
       WHERE id = NEW.lead_id
         AND stage NOT IN ('Won','Lost');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- VERIFY:
-- The trigger is unchanged structurally (still AFTER INSERT on
-- lead_activities); we just replaced the function body. Existing
-- contact_attempts_count values stay as-is — only future inserts
-- use the new logic.
--
-- To check: SELECT pg_get_functiondef('public.lead_activity_after_insert'::regproc);
--   should show v_negative_count + the new threshold.
