-- =============================================================================
-- Phase 630 (19-11-2026, owner-approved): a Won/Lost lead's ring stays 100 / 0, but
-- the card also shows the score it had WHEN it was won / lost ("was 25 when lost").
-- RUN ORDER: this file part 1 (columns) -> db/functions/lead_score_calc.sql ->
-- db/functions/recompute_lead_scores.sql -> this file part 2 (backfill + refresh).
-- Backfill (already Won/Lost leads, final_estimated = true): the same formula as
-- lead_score_calc, evaluated AS OF the stage-log date of the win / loss, with the
-- stage BEFORE it (log old_stage, else Quote sent if a quote existed by then, else
-- Working if any activity, else New). Follow-ups that the loss itself closed count as
-- overdue at that moment (they were open and late).
-- =============================================================================
-- part 1
ALTER TABLE public.lead_scores ADD COLUMN IF NOT EXISTS final_score integer;
ALTER TABLE public.lead_scores ADD COLUMN IF NOT EXISTS final_at timestamptz;
ALTER TABLE public.lead_scores ADD COLUMN IF NOT EXISTS final_estimated boolean NOT NULL DEFAULT false;
DROP FUNCTION IF EXISTS public.lead_scores_for(uuid[]);
CREATE OR REPLACE FUNCTION public.lead_scores_for(p_lead_ids uuid[])
 RETURNS TABLE(lead_id uuid, score integer, parts jsonb, final_score integer, final_estimated boolean)
 LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public', 'pg_temp'
AS $$ SELECT s.lead_id, s.score, s.parts, s.final_score, s.final_estimated FROM public.lead_scores s WHERE s.lead_id = ANY (p_lead_ids) $$;
REVOKE ALL ON FUNCTION public.lead_scores_for(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lead_scores_for(uuid[]) TO authenticated;
NOTIFY pgrst, 'reload schema';
