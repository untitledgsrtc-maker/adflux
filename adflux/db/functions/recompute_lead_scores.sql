-- ============================================================================
-- db/functions/recompute_lead_scores.sql - CANONICAL HOME (section 71)
-- ============================================================================
-- Phase 625. Writes lead_score_calc() into public.lead_scores (only rows whose score
-- or parts changed). p_ids NULL = every lead (hourly cron 'lead-score-hourly').
-- lead_score_touch() = the trigger body on lead_activities / follow_ups / leads; it
-- recomputes ONE lead and never fails the parent write (EXCEPTION-wrapped, section 45).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.recompute_lead_scores(p_ids uuid[] DEFAULT NULL)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_n int;
BEGIN
  -- Phase 630: when a lead becomes Won/Lost, keep the last LIVE score in final_score
  -- ("was X when lost"). Already-frozen values are kept; leaving Won/Lost clears them.
  INSERT INTO public.lead_scores (lead_id, score, parts, updated_at)
  SELECT c.lead_id, c.score, c.parts, now() FROM public.lead_score_calc(p_ids) c
  ON CONFLICT (lead_id) DO UPDATE
     SET score = EXCLUDED.score, parts = EXCLUDED.parts, updated_at = now(),
         final_score = CASE
           WHEN EXCLUDED.parts->>'lead_stage' IN ('Won', 'Lost') THEN
             COALESCE(public.lead_scores.final_score,
                      CASE WHEN public.lead_scores.parts->>'lead_stage' IN ('New', 'Working', 'QuoteSent', 'Nurture')
                           THEN public.lead_scores.score END)
           ELSE NULL END,
         final_at = CASE
           WHEN EXCLUDED.parts->>'lead_stage' IN ('Won', 'Lost') THEN
             COALESCE(public.lead_scores.final_at,
                      CASE WHEN public.lead_scores.parts->>'lead_stage' IN ('New', 'Working', 'QuoteSent', 'Nurture') THEN now() END)
           ELSE NULL END,
         final_estimated = CASE
           WHEN EXCLUDED.parts->>'lead_stage' IN ('Won', 'Lost') THEN
             CASE WHEN public.lead_scores.final_score IS NOT NULL THEN public.lead_scores.final_estimated ELSE false END
           ELSE false END
   WHERE public.lead_scores.score IS DISTINCT FROM EXCLUDED.score
      OR public.lead_scores.parts IS DISTINCT FROM EXCLUDED.parts;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $function$;

CREATE OR REPLACE FUNCTION public.lead_score_touch()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_id uuid;
BEGIN
  BEGIN
    -- IF, not CASE: plpgsql resolves every NEW.field in an expression, and leads has no lead_id.
    IF TG_TABLE_NAME = 'leads' THEN v_id := NEW.id; ELSE v_id := NEW.lead_id; END IF;
    IF v_id IS NOT NULL THEN
      PERFORM public.recompute_lead_scores(ARRAY[v_id]);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'lead_score_touch skipped for lead %: %', v_id, SQLERRM;
  END;
  RETURN NULL;
END $function$;

REVOKE ALL ON FUNCTION public.recompute_lead_scores(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lead_score_touch() FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';

-- VERIFY: SELECT to_regprocedure('public.recompute_lead_scores(uuid[])') IS NOT NULL AND to_regprocedure('public.lead_score_touch()') IS NOT NULL;  -- t
