-- Phase 423 (owner 2026-10-19): the first-day steps for the government campaigns that were ALREADY running when Phase 422 went live.
-- Creates design / quantity / vendor / report-making tasks (Auto Hood) or design (GSRTC) for Dixita, all due today.
-- Idempotent (the unique (quote, kind) index skips anything that exists). One-time; not part of the ongoing rule.
BEGIN;
CREATE TEMP TABLE run_q AS
  SELECT id FROM public.quotes WHERE status='won' AND segment='GOVERNMENT' AND media_type IN ('AUTO_HOOD','GSRTC_LED')
     AND campaign_end_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date;
SELECT public.work_make_govt_tasks(id, true) FROM run_q;
-- these campaigns are already running: every first-day step is due today (not +1/+2/+3)
UPDATE public.work_task_parts p SET due_date = (now() AT TIME ZONE 'Asia/Kolkata')::date
  FROM public.work_tasks t WHERE t.id = p.task_id AND t.source_quote_id IN (SELECT id FROM run_q)
   AND t.source_kind IN ('design','qty','vendor') AND p.status <> 'finished';
UPDATE public.work_tasks SET due_date = (now() AT TIME ZONE 'Asia/Kolkata')::date
 WHERE source_quote_id IN (SELECT id FROM run_q) AND source_kind IN ('design','qty','vendor') AND status <> 'finished';
SELECT source_kind, count(*) n, min(due_date)::text due FROM public.work_tasks
 WHERE source_quote_id IN (SELECT id FROM run_q) AND source_kind IN ('design','qty','vendor','report') GROUP BY source_kind ORDER BY 1;
COMMIT;
