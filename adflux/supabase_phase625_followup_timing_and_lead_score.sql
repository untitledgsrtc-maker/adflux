-- =============================================================================
-- Phase 625 (19-11-2026, owner-approved): follow-up timing + lead score ring.
-- RUN ORDER (each file is idempotent):
--   1. db/functions/lead_auto_create_followup.sql   new lead: +5 min (rules) + next working day 10:00
--   2. db/functions/spawn_quote_chase_cadence.sql   quote sent: +5 min + next day + day 2..30
--   3. db/functions/auto_create_followup.sql        old 3-day quote reminder only for quotes with no lead
--   4. db/functions/lead_intro_repeat_dispatch.sql  nightly 2-day repeat x5, then Nurture
--   5. db/functions/lead_score_calc.sql             the score formula
--   6. db/functions/recompute_lead_scores.sql       writer + trigger body
--   7. THIS FILE                                    table, RLS, read RPC, triggers, cron, backfill
-- =============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.lead_scores (
  lead_id    uuid PRIMARY KEY REFERENCES public.leads(id) ON DELETE CASCADE,
  score      integer NOT NULL,
  parts      jsonb   NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.lead_scores ENABLE ROW LEVEL SECURITY;
-- Numbers only (no name / phone / money): every signed-in user may read. Keeps the
-- per-page lookup cheap (no per-row leads RLS check, section 45). Writes: definer functions only.
DROP POLICY IF EXISTS lead_scores_read ON public.lead_scores;
CREATE POLICY lead_scores_read ON public.lead_scores FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.lead_scores FROM anon;
GRANT SELECT ON public.lead_scores TO authenticated;

-- Page lookup for the Leads list (POST body, so 500 ids never hit a URL limit).
CREATE OR REPLACE FUNCTION public.lead_scores_for(p_lead_ids uuid[])
 RETURNS TABLE(lead_id uuid, score integer, parts jsonb)
 LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public', 'pg_temp'
AS $$ SELECT s.lead_id, s.score, s.parts FROM public.lead_scores s WHERE s.lead_id = ANY (p_lead_ids) $$;
REVOKE ALL ON FUNCTION public.lead_scores_for(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lead_scores_for(uuid[]) TO authenticated;

-- Recompute one lead when something that feeds the score changes.
DROP TRIGGER IF EXISTS trg_lead_score_on_activity ON public.lead_activities;
CREATE TRIGGER trg_lead_score_on_activity AFTER INSERT ON public.lead_activities
  FOR EACH ROW EXECUTE FUNCTION public.lead_score_touch();
DROP TRIGGER IF EXISTS trg_lead_score_on_followup ON public.follow_ups;
CREATE TRIGGER trg_lead_score_on_followup AFTER INSERT OR UPDATE OF is_done, follow_up_date, lead_id ON public.follow_ups
  FOR EACH ROW WHEN (NEW.lead_id IS NOT NULL) EXECUTE FUNCTION public.lead_score_touch();
-- 625.1 (guardian finding 1): no leads INSERT touch - the new lead's own follow-up
-- INSERT already scores it, so a bulk import pays one recompute per lead, not three.
DROP TRIGGER IF EXISTS trg_lead_score_on_lead_ins ON public.leads;
-- 625.1 (guardian finding 4): supports the ">10 leads in a minute" bulk check.
CREATE INDEX IF NOT EXISTS idx_leads_created_by_created_at ON public.leads (created_by, created_at);
DROP TRIGGER IF EXISTS trg_lead_score_on_lead_upd ON public.leads;
CREATE TRIGGER trg_lead_score_on_lead_upd AFTER UPDATE OF stage, assigned_to, telecaller_id ON public.leads
  FOR EACH ROW WHEN (OLD.stage IS DISTINCT FROM NEW.stage
                  OR OLD.assigned_to IS DISTINCT FROM NEW.assigned_to
                  OR OLD.telecaller_id IS DISTINCT FROM NEW.telecaller_id)
  EXECUTE FUNCTION public.lead_score_touch();

-- Cron: hourly score refresh (the "talked in 7 days" / overdue parts move with time),
-- nightly 2-day repeat at 20:45 IST Mon-Sat (15:15 UTC).
DO $$ BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('lead-score-hourly', 'lead-intro-repeat');
  PERFORM cron.schedule('lead-score-hourly', '7 * * * *', 'SELECT public.recompute_lead_scores(NULL);');
  PERFORM cron.schedule('lead-intro-repeat', '15 15 * * 1-6', 'SELECT public.lead_intro_repeat_dispatch();');
END $$;

-- Backfill every lead once.
SELECT public.recompute_lead_scores(NULL);

COMMIT;
NOTIFY pgrst, 'reload schema';

-- VERIFY:
SELECT (SELECT count(*) FROM public.lead_scores) = (SELECT count(*) FROM public.leads) AS every_lead_scored,         -- t
       (SELECT score FROM public.lead_scores WHERE lead_id = 'c0bb5823-00ab-446d-99b4-795dd935d4b1') AS balar_score,  -- 70 on 19-11-2026
       (SELECT count(*) FROM cron.job WHERE jobname IN ('lead-score-hourly', 'lead-intro-repeat')) AS cron_jobs,        -- 2
       (SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg_lead_score_%') AS score_triggers;                         -- 3
