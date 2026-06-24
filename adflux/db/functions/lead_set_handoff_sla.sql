-- ============================================================================
-- db/functions/lead_set_handoff_sla.sql — CANONICAL HOME (Phase 178 / Stage 2)
-- ============================================================================
-- ⭐ The ONE place lead_set_handoff_sla lives (§71). Was in phase12 + phase34.
-- WHAT: BEFORE-UPDATE trigger on leads. On the first New/Working transition, stamps
--   sales_ready_at (the handoff-acknowledged time) + handoff_sla_due_at (24 business
--   hours later via next_business_moment). Always bumps updated_at.
-- 🔒 LOCKED: fires only when NEW.stage='Working' AND OLD.stage IS DISTINCT FROM
--   'Working' (the first-handoff edge); sales_ready_at is COALESCE-preserved (never
--   re-stamped); SLA = next_business_moment(sales_ready_at + 24h).
--   NOTE: sales_ready_at is ALSO read by compute_daily_score/§68/§115 as "first
--   contact" — do not repurpose the column.
-- PROVENANCE: live dump 2026-06-24 (phase34 body). Trigger wiring in phase files.
-- SUPERSEDES: supabase_phase12_m1_m7_foundation.sql · supabase_phase34_followup_consolidation.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lead_set_handoff_sla()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Stamp the handoff timestamp + SLA when a lead first starts being
  -- worked. We treat sales_ready_at as the historical name for "rep
  -- acknowledged the handoff" so the column keeps its meaning.
  IF NEW.stage = 'Working' AND (OLD.stage IS DISTINCT FROM 'Working') THEN
    NEW.sales_ready_at     := COALESCE(NEW.sales_ready_at, now());
    NEW.handoff_sla_due_at :=
      public.next_business_moment(NEW.sales_ready_at + interval '24 hours');
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

NOTIFY pgrst, 'reload schema';
-- VERIFY: LIKE '%stage = ''Working''%' AND '%next_business_moment%' AND '%24 hours%'.
