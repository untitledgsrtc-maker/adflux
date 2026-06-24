-- ============================================================================
-- db/functions/lead_auto_heat_from_outcome.sql — CANONICAL HOME (Phase 178 / Stage 2)
-- ============================================================================
-- ⭐ The ONE place lead_auto_heat_from_outcome lives (§71). Was in phase47_4 + phase88_4.
-- WHAT: trigger on lead_activities. Auto-sets the lead's heat from a call/meeting
--   outcome: positive → hot, negative → cold. Neutral/null → no change.
-- 🔒 LOCKED (§47.4): only on a real outcome (NULL skip; UPDATE skip when outcome
--   unchanged); SKIP closed leads (stage IN Won/Lost); SKIP when heat already = target
--   (no churn). positive→hot, negative→cold only.
-- PROVENANCE: live dump 2026-06-24 (phase88_4 body). Trigger wiring in phase files.
-- SUPERSEDES: supabase_phase47_4_auto_heat_from_outcome.sql · supabase_phase88_4_trigger_consolidation.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lead_auto_heat_from_outcome()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_target_heat text;
  v_current     record;
BEGIN
  IF NEW.outcome IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.outcome IS NOT DISTINCT FROM NEW.outcome THEN
    RETURN NEW;
  END IF;
  IF NEW.outcome = 'positive' THEN
    v_target_heat := 'hot';
  ELSIF NEW.outcome = 'negative' THEN
    v_target_heat := 'cold';
  ELSE
    RETURN NEW;
  END IF;
  SELECT stage, heat INTO v_current
    FROM public.leads
   WHERE id = NEW.lead_id;
  IF v_current.stage IN ('Won', 'Lost') THEN
    RETURN NEW;
  END IF;
  IF v_current.heat = v_target_heat THEN
    RETURN NEW;
  END IF;
  UPDATE public.leads
     SET heat       = v_target_heat,
         updated_at = now()
   WHERE id = NEW.lead_id;
  RETURN NEW;
END;
$function$;

NOTIFY pgrst, 'reload schema';
-- VERIFY: LIKE '%positive%' '%hot%' '%negative%' '%cold%' AND '%Won%' '%Lost%' (closed skip).
